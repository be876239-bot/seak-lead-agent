// @vitest-environment-options {"url": "https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaaaaaaaaaa"}
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRequest, RequestSchema, SnapshotPayload } from '../../src/messaging/protocol';
import { XhsSessionManager } from '../../src/xhs/session';
import { AppError } from '../../src/domain/errors';
import type { ClassificationInput, ProfileInput } from '../../src/privacy/ai-payload';
import type { ProductSourceBlock } from '../../src/domain/schemas';
import { SeekLeadDb } from '../../src/storage/db';
import { Repositories } from '../../src/storage/repositories';
import { LOCK_NAME, TaskLockManager } from '../../src/analysis/lock';
import { retryCommentsJob, runCommentsJob, runProfileGeneration, type RunnerDeps } from '../../src/analysis/runner';
import { MockProvider } from '../../src/ai/mock';
import {buildCommentMessages} from '../../src/ai/prompts';

const NOTE_ID = 'a'.repeat(24);
const NOTE_KEY = `xhs:${NOTE_ID}`;

const blocks: ProductSourceBlock[] = [{
  id: 'b001', url: 'https://example.com/product',
  text: '备考题库：在线刷题与模拟考试平台，覆盖考研 408。邀请码注册，站内查看价格。',
  fetchedAt: '2026-10-15T00:00:00Z',
}];

const profileScript = (_input: ProfileInput) => ({
  schemaVersion: 1,
  name: { value: '备考题库', status: 'observed', evidence: [{ sourceId: 'b001', quote: '备考题库' }] },
  category: { value: '在线刷题平台', status: 'inferred', evidence: [] },
  summary: { value: '考研题库类网站', status: 'inferred', evidence: [] },
  capabilities: [], targetAudience: [], needsServed: [], exclusions: [],
  accessMethod: { value: '邀请码注册', status: 'observed', evidence: [{ sourceId: 'b001', quote: '邀请码注册' }] },
  price: { value: null, status: 'unknown', evidence: [] },
  purchaseChannel: { value: null, status: 'unknown', evidence: [] },
  searchSuggestions: [],
});

const goldClassification = (input: ClassificationInput) => ({
  results: input.items.map((it) => ({
    commentId: it.commentId,
    relevance: 'direct', need: 'explicit', purchaseIntent: 'explicit_buy',
    speakerRole: 'seeker', intentTarget: 'our_product', productFit: 'supported',
    needSummary: '模拟：明确询价',
    evidence: [{ sourceId: `${it.commentId}:text`, quote: it.text.slice(0, Math.min(12, it.text.length)) }],
    reason: '模拟脚本判定', uncertainty: null,
  })),
});

let db: SeekLeadDb;
let repos: Repositories;
let lock: TaskLockManager;
let session: XhsSessionManager;

function deps(provider: MockProvider): RunnerDeps {
  return { repos, provider, lock, providerName: 'mock', modelId: 'mock-model', retryDelayMs: 0 };
}

beforeEach(() => {
  db = new SeekLeadDb(`e2e-${crypto.randomUUID()}`);
  repos = new Repositories(db);
  lock = new TaskLockManager(repos);
  document.body.innerHTML = readFileSync('tests/fixtures/xhs/note-detail-expanded.html', 'utf8');
  history.replaceState({}, '', `/explore/${NOTE_ID}`);
  session = new XhsSessionManager(() => document);
});

afterEach(() => {
  session.dispose();
  db.close();
});

async function captureFromFixture(): Promise<SnapshotPayload> {
  const req = RequestSchema.parse(buildRequest('XHS_START_SESSION', { expectedNoteKey: NOTE_KEY }));
  const snap = SnapshotPayload.parse(await session.handle(req));
  await repos.putNote(snap.note!);
  await repos.putComments(snap.comments);
  return snap;
}

async function makeProduct(provider: MockProvider) {
  return runProfileGeneration(deps(provider), {
    inputUrl: 'https://example.com/product', finalUrl: 'https://example.com/product', blocks,
  });
}

describe('G2 mock 端到端闭环（产品→当前页→分析→保存→再运行去重）', () => {
  it('未关联回复可分析，AI获知上下文缺失且本地判断明确标注不确定性', async()=>{
    const provider=new MockProvider({profile:profileScript,classification:input=>{
      expect(input.items[0]).toMatchObject({parent:null,replyContext:'parent_unavailable'});
      const sent=JSON.parse(buildCommentMessages(input).at(-1)!.content);
      expect(sent.items[0].contextNotice).toContain('不得猜测父评论');
      expect(sent.items[0].parent).toBeNull();
      return goldClassification(input);
    }});
    const product=await makeProduct(provider);const snap=await captureFromFixture();
    const comment={...snap.comments[0]!,isReply:true,parentKey:null};await repos.putComments([comment]);
    const job=await runCommentsJob(deps(provider),{productId:product.id,note:snap.note!,comments:[comment]});
    expect(job.status).toBe('completed');
    expect((await db.analyses.toArray())[0]?.decision.uncertainty).toContain('缺少父评论上下文');
  });
  it('未知父上下文结果可缓存；补关联后使用新上下文重新分析',async()=>{
    let calls=0;
    const provider=new MockProvider({profile:profileScript,classification:input=>{calls++;return goldClassification(input);}});
    const product=await makeProduct(provider);const snap=await captureFromFixture();
    const reply={...snap.comments[0]!,isReply:true,parentKey:null};
    await runCommentsJob(deps(provider),{productId:product.id,note:snap.note!,comments:[reply]});
    await runCommentsJob(deps(provider),{productId:product.id,note:snap.note!,comments:[reply]});
    expect(calls).toBe(1);
    const parent={...snap.comments[1]!,text:'父评论上下文'};
    await runCommentsJob(deps(provider),{productId:product.id,note:snap.note!,comments:[{...reply,parentKey:parent.commentKey},parent]});
    expect(calls).toBe(2);
    const rows=(await db.analyses.toArray()).filter(a=>a.commentKey===reply.commentKey);
    expect(rows).toHaveLength(2);expect(rows[0]!.contextHash).not.toBe(rows[1]!.contextHash);
  });
  it.each(['recover', 'invalid-json', 'invalid-schema'] as const)('Provider JSON 解析失败共享一次修复预算：%s', async (mode) => {
    const provider = new MockProvider({ profile: profileScript });
    const product = await makeProduct(provider);
    const snap = await captureFromFixture();
    let calls = 0;
    provider.classifyComments = async (input, _signal, repair) => {
      calls += 1;
      if (calls === 1 || mode === 'invalid-json') throw new AppError('AI_INVALID_OUTPUT', '模型输出无法解析为 JSON');
      expect(repair).toEqual({ errorSummary: '模型输出无法解析为 JSON', badOutput: '' });
      return { value: mode === 'invalid-schema' ? {} : goldClassification(input), model: 'mock-model', usage: { inputTokens: null, outputTokens: null } };
    };
    // 单批，避免其他批次消耗调用序列。
    const comments = snap.comments.slice(0, 7);
    const job = await runCommentsJob(deps(provider), { productId: product.id, note: snap.note!, comments });
    expect(calls).toBe(2);
    expect(job.status).toBe(mode === 'recover' ? 'completed' : 'failed');
    expect((await db.analyses.toArray()).length).toBe(mode === 'recover' ? 7 : 0);
    expect((await db.usage.toArray()).filter(u => u.jobId === job.id)).toHaveLength(2);
    expect((await db.comments.toArray()).length).toBe(snap.comments.length);
  });

  it('评论引文不匹配时，使用引文专用修复提示纠正后完成批次', async () => {
    const provider = new MockProvider({ profile: profileScript });
    const product = await makeProduct(provider);
    const snap = await captureFromFixture();
    let calls = 0;
    provider.classifyComments = async (input, _signal, repair) => {
      calls += 1;
      const good = goldClassification(input);
      if (!repair) {
        const bad = structuredClone(good);
        bad.results[0]!.evidence[0]!.quote = '这是一段原文中不存在的改写引文';
        return { value: bad, model: 'mock-model', usage: { inputTokens: 10, outputTokens: 5 } };
      }
      expect(repair.errorSummary).toContain('引文不是原文连续段');
      expect(repair.errorSummary).not.toContain('这是一段原文中不存在的改写引文');
      expect(repair.badOutput).toContain('这是一段原文中不存在的改写引文');
      return { value: good, model: 'mock-model', usage: { inputTokens: 12, outputTokens: 5 } };
    };

    const comments = snap.comments.slice(0, 7);
    const job = await runCommentsJob(deps(provider), { productId: product.id, note: snap.note!, comments });
    expect(calls).toBe(2);
    expect(job.status).toBe('completed');
    expect((await db.analyses.toArray())).toHaveLength(7);
    const usage = (await db.usage.toArray()).filter((u) => u.jobId === job.id);
    expect(usage).toHaveLength(2);
    expect(usage.some((u) => u.status === 'unknown')).toBe(true);
    expect(usage.some((u) => u.status === 'success')).toBe(true);
    expect((await db.comments.toArray()).length).toBe(snap.comments.length);
  });

  it.each(['profile', 'model', 'comment', 'legacy', 'lock'] as const)('重试守卫拒绝 %s 变化，保留原批次且不调用模型', async (change) => {
    const setup = new MockProvider({ profile: profileScript, classification: () => { throw new AppError('AI_TIMEOUT', '模拟失败'); } });
    const product = await makeProduct(setup);
    const snap = await captureFromFixture();
    const job = await runCommentsJob(deps(setup), { productId: product.id, note: snap.note!, comments: snap.comments });
    const rows = await repos.batchesForJob(job.id);
    let calls = 0;
    const provider = new MockProvider({ classification: (input) => { calls += 1; return goldClassification(input); } });
    const retryDeps = deps(provider);
    const other = new TaskLockManager(repos);
    let blocker;
    if (change === 'profile') await repos.replaceProfile(product.id, product.profile);
    if (change === 'model') retryDeps.modelId = 'changed-model';
    if (change === 'comment') await repos.putComments([{ ...snap.comments[0]!, text: '现在不需要了' }]);
    if (change === 'legacy') await repos.updateBatch(rows[0]!.id, { inputHash: 'legacy-hash' });
    if (change === 'lock') blocker = await other.acquire(LOCK_NAME, crypto.randomUUID());
    const before = await repos.batchesForJob(job.id);
    try {
      await expect(retryCommentsJob(retryDeps, job.id)).rejects.toMatchObject({ code: change === 'lock' ? 'LOCK_HELD' : 'PAGE_CHANGED' });
      expect(calls).toBe(0);
      expect(await repos.batchesForJob(job.id)).toEqual(before);
      expect((await repos.getJob(job.id))?.status).toBe('failed');
    } finally {
      if (blocker) await other.release(blocker);
    }
  });

  it('产品来源与模型输出在请求及落库边界脱敏', async () => {
    const provider = new MockProvider({
      profile: (input) => {
        expect(JSON.stringify(input)).not.toContain('13812345678');
        return { ...profileScript(input), summary: { value: '联系 buyer@example.com', status: 'inferred', evidence: [] } };
      },
      classification: (input) => ({ results: goldClassification(input).results.map((r) => ({
        ...r, reason: '联系 buyer@example.com', needSummary: '联系 13812345678', uncertainty: 'QQ 123456789',
      })) }),
    });
    const product = await runProfileGeneration(deps(provider), {
      inputUrl: 'https://example.com', finalUrl: 'https://example.com',
      blocks: blocks.map((b) => ({ ...b, text: b.text + ' 电话 13812345678' })),
    });
    expect(JSON.stringify(product)).not.toContain('13812345678');
    expect(JSON.stringify(product)).not.toContain('buyer@example.com');
    const snap = await captureFromFixture();
    const job = await runCommentsJob(deps(provider), { productId: product.id, note: snap.note!, comments: snap.comments });
    expect(job.status).toBe('completed');
    const saved = JSON.stringify(await db.analyses.toArray());
    for (const text of ['13812345678', 'buyer@example.com', '123456789']) expect(saved).not.toContain(text);
  });

  it('取消后模型仍返回有效结果：丢弃迟到批次，保留真实用量，不写 Lead', async () => {
    const provider = new MockProvider({ profile: profileScript });
    const product = await makeProduct(provider);
    const snap = await captureFromFixture();
    const jobId = crypto.randomUUID();
    provider.classifyComments = async (input) => {
      await lock.cancel(lock.findHandleByJob(jobId)!);
      return { value: goldClassification(input), model: 'mock-model', usage: { inputTokens: 12, outputTokens: 8 } };
    };
    const job = await runCommentsJob(deps(provider), { jobId, productId: product.id, note: snap.note!, comments: snap.comments });
    expect(job.status).toBe('cancelled');
    expect(await db.analyses.count()).toBe(0);
    expect((await repos.batchesForJob(jobId)).every((b) => b.status === 'interrupted')).toBe(true);
    expect(await db.usage.where('jobId').equals(jobId).toArray()).toMatchObject([
      { inputTokens: 12, outputTokens: 8 },
    ]);
  });

  it('模型返回前租约被接管：旧 owner 不提交，任务中断且可重试', async () => {
    const provider = new MockProvider({ profile: profileScript });
    const product = await makeProduct(provider);
    const snap = await captureFromFixture();
    provider.classifyComments = async (input) => {
      await db.locks.update(LOCK_NAME, { ownerId: 'replacement-owner', generation: 999 });
      return { value: goldClassification(input), model: 'mock-model', usage: { inputTokens: 12, outputTokens: 8 } };
    };
    const job = await runCommentsJob(deps(provider), { productId: product.id, note: snap.note!, comments: snap.comments });
    expect(job.status).toBe('interrupted');
    expect(job.errorCode).toBe('LOCK_HELD');
    expect(await db.analyses.count()).toBe(0);
  });

  it('画像生成取消后仍返回：不创建产品也不覆盖已有画像', async () => {
    const provider = new MockProvider({ profile: profileScript });
    const product = await makeProduct(provider);
    for (const existingProductId of [undefined, product.id]) {
      const jobId = crypto.randomUUID();
      provider.generateProfile = async (input) => {
        await lock.cancel(lock.findHandleByJob(jobId)!);
        return { value: profileScript(input), model: 'mock-model', usage: { inputTokens: 10, outputTokens: 5 } };
      };
      await expect(runProfileGeneration(deps(provider), {
        jobId, existingProductId, inputUrl: 'https://example.com', finalUrl: 'https://example.com', blocks,
      })).rejects.toMatchObject({ code: 'CANCELLED' });
      expect((await repos.getJob(jobId))?.status).toBe('cancelled');
    }
    expect(await db.products.count()).toBe(1);
    expect((await repos.getProduct(product.id))?.profileVersion).toBe(1);
  });

  it('画像生成 + 真实 fixture 评论全量分析入库，重跑不再调用 AI', async () => {
    let classifyCalls = 0;
    const provider = new MockProvider({
      profile: profileScript,
      classification: (input) => { classifyCalls += 1; return goldClassification(input); },
    });
    const product = await makeProduct(provider);
    expect(product.profileVersion).toBe(1);
    expect((await repos.getProduct(product.id))?.profile.name.value).toBe('备考题库');

    const snap = await captureFromFixture();
    expect(snap.comments.length).toBe(28);

    const before = classifyCalls;
    const job = await runCommentsJob(deps(provider), { productId: product.id, note: snap.note!, comments: snap.comments });
    expect(job.status).toBe('completed');
    expect(job.totalItems).toBe(28);
    expect(job.completedItems).toBe(28);
    expect(classifyCalls - before).toBe(2); // 15 + 13 两批

    const analyses = await db.analyses.toArray();
    expect(analyses.length).toBe(28);
    for (const a of analyses) {
      expect(a.group).toBe('high_intent');
      expect(a.commentKey.startsWith(NOTE_KEY)).toBe(true);
    }
    const usage = await db.usage.toArray();
    expect(usage.filter((u) => u.status === 'success').length).toBe(3); // 2 评论批 + 1 画像
    expect(usage.every((u) => u.estimatedCny === null && u.priceVerifiedAt === null)).toBe(true);
    expect(usage.some((u) => u.inputTokens === null)).toBe(true);
    expect(usage.filter((u) => u.status === 'success' && u.providerRequestId?.startsWith('mock-')).length).toBe(3);

    // 再次运行：无新评论 → 不调用 AI
    const before2 = classifyCalls;
    const job2 = await runCommentsJob(deps(provider), { productId: product.id, note: snap.note!, comments: snap.comments });
    expect(job2.status).toBe('completed');
    expect(job2.totalItems).toBe(0);
    expect(classifyCalls).toBe(before2);
  });

  it('第 1 批成功后第 2 批超时：partial 可见；手动重试只重跑第 2 批', async () => {
    let n = 0;
    const failing = new MockProvider({
      profile: profileScript,
      classification: (input) => {
        n += 1;
        if (n === 2 || n === 3) throw new AppError('AI_TIMEOUT', '模拟超时', true);
        return goldClassification(input);
      },
    });
    const product = await makeProduct(failing);
    const snap = await captureFromFixture();
    const job = await runCommentsJob(deps(failing), { productId: product.id, note: snap.note!, comments: snap.comments });
    expect(job.status).toBe('partial');
    expect(job.completedItems).toBe(15);
    expect(job.failedItems).toBe(13);
    expect((await db.analyses.toArray()).length).toBe(15);
    const rows = await repos.batchesForJob(job.id);
    expect(rows.map((r) => r.status)).toEqual(['completed', 'failed']);
    expect(rows[1]?.errorCode).toBe('AI_TIMEOUT');
    // 超时尝试的用量已落库（可能已计费，unknown）
    expect((await db.usage.toArray()).some((u) => u.status === 'unknown')).toBe(true);

    const retryInputs: number[] = [];
    const fixed = new MockProvider({
      classification: (input) => { retryInputs.push(input.items.length); return goldClassification(input); },
    });
    const retried = await retryCommentsJob(deps(fixed), job.id);
    expect(retried.status).toBe('completed');
    expect(retryInputs).toEqual([13]); // 第 1 批绝不重跑
    expect((await db.analyses.toArray()).length).toBe(28);
  });

  it('取消：已完成结果保留，运行中批次标 interrupted，可重试收尾', async () => {
    let n = 0;
    const provider = new MockProvider({
      profile: profileScript,
      classification: (input) => {
        n += 1;
        if (n === 2) throw new AppError('CANCELLED', '模拟用户取消');
        return goldClassification(input);
      },
    });
    const product = await makeProduct(provider);
    const snap = await captureFromFixture();
    const job = await runCommentsJob(deps(provider), { productId: product.id, note: snap.note!, comments: snap.comments });
    expect(job.status).toBe('cancelled');
    expect((await db.analyses.toArray()).length).toBe(15);
    const rows = await repos.batchesForJob(job.id);
    expect(rows.map((r) => r.status)).toEqual(['completed', 'interrupted']);

    const gold2 = new MockProvider({ classification: goldClassification });
    const retried = await retryCommentsJob(deps(gold2), job.id);
    expect(retried.status).toBe('completed');
    expect((await db.analyses.toArray()).length).toBe(28);
  });

  it('并发互斥：另一面板持锁时新任务报 LOCK_HELD，Job 行留痕为 failed', async () => {
    const provider = new MockProvider({ profile: profileScript, classification: goldClassification });
    const product = await makeProduct(provider);
    const snap = await captureFromFixture();
    const other = new TaskLockManager(repos);
    const blocker = await other.acquire(LOCK_NAME, crypto.randomUUID());
    await expect(runCommentsJob(deps(provider), { productId: product.id, note: snap.note!, comments: snap.comments }))
      .rejects.toMatchObject({ code: 'LOCK_HELD' });
    const allJobs = await db.jobs.toArray();
    expect(allJobs.length).toBe(2); // 画像任务 + 本次留痕的失败任务
    const blocked = allJobs.find((j) => j.kind === 'comments')!;
    expect(blocked.status).toBe('failed');
    expect(blocked.errorCode).toBe('LOCK_HELD');
    await other.release(blocker);
    const ok = await runCommentsJob(deps(provider), { productId: product.id, note: snap.note!, comments: snap.comments });
    expect(ok.status).toBe('completed');
  });

  it('换帖守卫：评论与笔记不匹配时拒绝写入（旧快照不进新帖）', async () => {
    const provider = new MockProvider({ profile: profileScript, classification: goldClassification });
    const product = await makeProduct(provider);
    const snap = await captureFromFixture();
    const foreign = { ...snap.comments[0]!, noteKey: 'xhs:b'.repeat(24) };
    await expect(runCommentsJob(deps(provider), {
      productId: product.id, note: snap.note!, comments: [foreign, ...snap.comments.slice(1)],
    })).rejects.toMatchObject({ code: 'PAGE_CHANGED' });
  });

  it('画像版本变化 → 缓存失效重新分析', async () => {
    const counter = { c: 0 };
    const mk = () => new MockProvider({
      profile: profileScript,
      classification: (input) => { counter.c += 1; return goldClassification(input); },
    });
    const provider = mk();
    const product = await makeProduct(provider);
    const snap = await captureFromFixture();
    await runCommentsJob(deps(provider), { productId: product.id, note: snap.note!, comments: snap.comments });
    expect(counter.c).toBe(2);
    await runCommentsJob(deps(provider), { productId: product.id, note: snap.note!, comments: snap.comments });
    expect(counter.c).toBe(2); // 全部命中缓存

    const v2 = await runProfileGeneration(deps(provider), {
      inputUrl: 'https://example.com/product', finalUrl: 'https://example.com/product', blocks, existingProductId: product.id,
    });
    expect(v2.profileVersion).toBe(2);
    const job = await runCommentsJob(deps(provider), { productId: product.id, note: snap.note!, comments: snap.comments });
    expect(counter.c).toBe(4);
    expect(job.totalItems).toBe(28);
    expect((await db.analyses.toArray()).length).toBe(56);
  });

  it('画像输出无效 → 修复一次；仍无效则失败且不留产品', async () => {
    let n = 0;
    const repairable = new MockProvider({
      profile: (input) => {
        n += 1;
        if (n === 1) {
          const good = profileScript(input) as Record<string, unknown>;
          return { ...good, name: { value: '不存在的产品', status: 'observed', evidence: [{ sourceId: 'b999', quote: '不存在的产品' }] } };
        }
        return profileScript(input);
      },
    });
    const product = await makeProduct(repairable);
    expect(product.profile.name.value).toBe('备考题库');
    expect(n).toBe(2);
    expect((await db.usage.toArray()).some((u) => u.status === 'unknown')).toBe(true);

    const alwaysBad = new MockProvider({ profile: () => ({ nope: 1 }) });
    await expect(makeProduct(alwaysBad)).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' });
    expect((await db.products.toArray()).length).toBe(1);
    const failedJob = (await db.jobs.toArray()).find((j) => j.kind === 'product' && j.status === 'failed');
    expect(failedJob?.errorCode).toBe('AI_INVALID_OUTPUT');
  });

  it('重启恢复：遗留 running 任务标 interrupted 后可手动重试', async () => {
    const provider = new MockProvider({ profile: profileScript, classification: goldClassification });
    const product = await makeProduct(provider);
    const snap = await captureFromFixture();
    // 使用真实 runner 生成有效快照和缓存键，再模拟后台退出遗留状态。
    const failing = new MockProvider({ classification: () => { throw new AppError('AI_TIMEOUT', '模拟中断'); } });
    const job = await runCommentsJob(deps(failing), { productId: product.id, note: snap.note!, comments: snap.comments.slice(0, 13) });
    const jobId = job.id;
    await repos.updateJob(jobId, { status: 'analyzing' });
    for (const row of await repos.batchesForJob(jobId)) await repos.updateBatch(row.id, { status: 'running' });
    const recovered = await lock.recoverInterrupted();
    expect(recovered).toEqual([jobId]);
    let seen = 0;
    const p2 = new MockProvider({ classification: (input) => { seen = input.items.length; return goldClassification(input); } });
    const done = await retryCommentsJob(deps(p2), jobId);
    expect(done.status).toBe('completed');
    expect(seen).toBe(13);
    expect((await db.analyses.toArray()).length).toBe(13);
  });
});

it('外部寻找任务signal取消分析：迟到模型结果不能写Lead，已存在数据保留',async()=>{
 const provider=new MockProvider({profile:profileScript});const product=await makeProduct(provider);const snap=await captureFromFixture();const ac=new AbortController();
 provider.classifyComments=async input=>{ac.abort();return {value:goldClassification(input),model:'mock-model',usage:{inputTokens:12,outputTokens:8}};};
 const job=await runCommentsJob(deps(provider),{productId:product.id,note:snap.note!,comments:snap.comments,signal:ac.signal});
 expect(job.status).toBe('cancelled');expect(await db.analyses.count()).toBe(0);expect(await db.comments.count()).toBe(28);
});
