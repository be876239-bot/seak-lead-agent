import Dexie, { type Table } from 'dexie';
import type {
  Analysis, Batch, Comment, Feedback, Job, LeadState, Lock, Note, Product, Usage,
} from '../domain/schemas';

export class SeekLeadDb extends Dexie {
  products!: Table<Product, string>;
  notes!: Table<Note, string>;
  comments!: Table<Comment, string>;
  analyses!: Table<Analysis, string>;
  leadStates!: Table<LeadState, string>;
  feedback!: Table<Feedback, string>;
  jobs!: Table<Job, string>;
  batches!: Table<Batch, string>;
  usage!: Table<Usage, string>;
  locks!: Table<Lock, string>;

  constructor(name = 'seeklead-agent') {
    super(name);
    this.version(1).stores({
      products: 'id, updatedAt',
      notes: 'noteKey, capturedAt',
      comments: 'commentKey, noteKey, capturedAt',
      analyses: 'id, &cacheKey, [productId+commentKey], group, createdAt',
      leadStates: 'id, productId, commentKey',
      feedback: 'id, analysisId, createdAt',
      jobs: 'id, status, updatedAt',
      batches: 'id, jobId, status',
      usage: 'id, jobId, createdAt',
      locks: 'name',
    });
  }
}

export const DB_SCHEMA_VERSION = 1;

let shared: SeekLeadDb | null = null;
export function getDb(): SeekLeadDb {
  shared ??= new SeekLeadDb();
  return shared;
}
