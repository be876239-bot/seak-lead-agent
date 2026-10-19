# SeekLead Agent 新手引导适配契约

## 设计目标

新手引导流程、教程文案、持久化进度与具体 UI 分离。更换整个 Side Panel 视觉设计时，优先只修改 UI 适配器和展示组件，不改流程状态机或步骤内容。

## 分层

- `src/onboarding/flow.ts`：纯状态机，负责步骤顺序、进度、暂停、恢复与完成状态。
- `src/onboarding/catalog.ts`：教程步骤的标题、说明、逻辑目的地和语义目标 ID；不包含 CSS 类名、DOM 结构或路由。
- `src/onboarding/storage.ts`：扩展本地存储。
- `src/onboarding/useOnboardingController.ts`：把状态机、存储与产品/AI 配置就绪状态连接起来；UI 不需要自己管理状态迁移。
- `src/onboarding/uiAdapter.ts`：定义 UI 与教程之间的稳定契约。
- `entrypoints/sidepanel/onboardingAdapter.ts`：当前 Side Panel 的目的地、页面标签与 DOM 目标映射。
- `src/ui/OnboardingGuide.tsx` 和同名 CSS：当前教程卡片的展示层，可以独立重做。

## 现有语义 ID

### 逻辑目的地

- `ai-settings`
- `product-setup`
- `search-workflow`
- `lead-review`

### 操作目标

- `model-save`
- `product-url`
- `search-keyword`
- `discovery-start`
- `lead-list`

当前 UI 通过 `data-onboarding-target="<ID>"` 暴露目标。新 UI 若保留这些属性，目标定位通常无需修改；若 DOM 或路由变化，只修改 `entrypoints/sidepanel/onboardingAdapter.ts` 中的映射。

## 更换 UI 时的最小修改清单

1. 让新 UI 继续提供相同的逻辑目的地映射，或仅更新 `onboardingAdapter.ts`。
2. 在新 UI 的关键控件上保留相同的 `data-onboarding-target` ID；如果无法保留，就更新适配器中的选择器。
3. 如果教程卡片视觉也要重做，只替换 `OnboardingGuide.tsx` 与 `OnboardingGuide.css`，不要把步骤状态逻辑搬回组件。
4. 保留真实完成事件：搜索确认完成 `search-keyword`，任务成功启动完成 `start-task`。不能只因为用户打开页面或点击了按钮就提前标记完成。
5. 运行 `npm run typecheck`、`npm test`、`npm run lint`、`npm run build:edge`。

## 安全与降级

- 定位目标时滚动到可见区域并短暂高亮；对于非焦点元素（例如整块搜索说明或线索容器），视觉高亮负责指明区域，不强行将焦点移到不适合的元素。
- 目标不存在时只显示可理解的提示，不进行猜测点击或坐标点击。
- 不自动替用户向小红书提交搜索。
- 只有任务启动请求成功后才完成“启动第一次任务”。
- API Key 不显示在教程中，也不会被复制进教程状态；教程只检查是否存在配置及相应权限。
- 进度只保存在浏览器扩展本地存储中。

## 验证记录（2026-10-19）

- `npm run typecheck`：PASS。
- `npm test`：41 个测试文件、494 个测试通过。
- `npm run lint`：PASS。
- `npm run build:edge`：PASS，Edge MV3 构建成功。
- 真实 Edge Side Panel 中的逐步操作、首次安装体验与暂停/恢复流程：尚未完成人工验收（NOT VERIFIED）。
