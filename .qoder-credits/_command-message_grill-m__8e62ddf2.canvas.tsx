import {
  BarChart,
  Callout,
  ChartComparisonGrid,
  ChartContainer,
  H1,
  LineChart,
  MetricsGrid,
  PieChart,
  ReportSection,
  ReportShell,
  Stack,
  Table,
  Text,
  type MetricItem,
} from "qoder/canvas";

// —— 报告数据契约（由 scripts/lib/breakdown.mjs 产出，plugin 注入）——
interface CatRow {
  key: string;
  label: string;
  tokens: number;
  share: number;
}
interface ToolRow {
  tool: string;
  tokens: number;
  calls: number;
  /** 平均每次调用带来的重发 token；无调用记录时 null（不给 0） */
  perCall?: number | null;
  share: number;
}
interface FileRow {
  attr: string;
  label: string;
  kind: string;
  tool: string | null;
  selfTokens: number;
  reads: number;
  trips: number;
  billed: number;
  /** 单次读取的总代价（含此后每一程重发）；reads=0 时 null */
  perRead?: number | null;
  share: number;
}
interface ReqRow {
  index: number;
  time: string | null;
  ratio: number;
  inputTokens: number;
  /** 代理或转录任一有真值即非 null；两者都没则 null（不写 0） */
  outputTokens?: number | null;
  /** proxy=代理实测 / transcript-tokens=转录 input_tokens / transcript-ratio=转录 ratio×window */
  usageSource?: "proxy" | "transcript-tokens" | "transcript-ratio" | "transcript";
  credits: number;
  originalCredits: number;
  afterCompact: boolean;
}
interface CatChild {
  tool: string | null;
  label: string;
  kind: string | null;
  tokens: number;
  share: number;
  catShare: number;
  trips: number;
}
interface CatDetail {
  key: string;
  label: string;
  tokens: number;
  share: number;
  children: CatChild[];
}
interface SubagentRow {
  agentId: string;
  agentType: string | null;
  description: string | null;
  toolUseId: string | null;
  roundTrips: number;
  billedInputTokens: number;
  peakContextRatio: number;
  credits: number;
  originalCredits: number;
  error: string | null;
}
interface SubagentTotals {
  roundTrips: number;
  billedInputTokens: number;
  credits: number;
  originalCredits: number;
}
interface Subagents {
  scanned: boolean;
  dir: string | null;
  /** 试过的候选目录；用于区分「真没子代理」与「路径没找对」。 */
  probedPaths?: string[];
  /** ok=已汇总 / no-dir=无子代理目录 / dir-empty=目录在但无 agent 文件 / no-usage=有文件但转录无 usage / error=读取抛错 */
  reason?: string;
  count: number;
  items: SubagentRow[];
  totals: SubagentTotals;
  combined: SubagentTotals;
}
/** 逐项可用性：报告里每个数字到底是模型上报的真值、按真值推导、回退默认、手工录入，还是本地根本没有。
 *  v2 旧报告没这个对象，故全部字段可选，读取时一律走默认值（旧报告只可能来自桌面端富转录）。 */
type Avail = "measured" | "derived" | "fallback" | "manual" | "unavailable";
interface Availability {
  credits?: Avail;
  roundTrips?: Avail;
  contextRatio?: Avail;
  tokens?: Avail;
  /** 输出 token：代理或转录 output_tokens 任一有真值即 measured */
  outputTokens?: Avail;
  /** 缓存命中 token：代理或转录 cache_read_input_tokens 任一有真值即 measured */
  cachedTokens?: Avail;
  categoryShare?: Avail;
  toolShare?: Avail;
  fileShare?: Avail;
  systemPrompt?: Avail;
  contextWindow?: Avail;
  compactions?: Avail;
  compactionCost?: Avail;
  model?: Avail;
  title?: Avail;
  toolCalls?: Avail;
  fileReads?: Avail;
  userTurns?: Avail;
  /** 用户压缩阈值：manual 覆盖 → manual；默认 200K → fallback */
  userContextLimit?: Avail;
}
/** 官方 UI 真值（手工录入，来自 .qoder-credits/overrides/<sessionId>.json）。
 *  IDE 端转录不含 usage，本地算不出 Credits，这是唯一的真值通道；绝不覆盖 totals，只并列展示。 */
interface ManualTruth {
  file?: string;
  credits: number | null;
  originalCredits: number | null;
  model: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMin: number | null;
  note: string | null;
  /** 手工锁定模型窗口（如 qwen3-max=1000000），优先于 runtime-config / 反推 / fallback */
  contextWindow?: number | null;
  /** 手工指定 Qoder 压缩触发阈值（默认 200000），驱动 peakUserAdvice */
  userContextLimit?: number | null;
  /** 本地 credits ÷ 官方真值。有子代理时拿 combined 比（官方 UI 扣费 = 主链 + 子代理），
   *  否则覆盖率会被系统性低估（实测 ca2f7834：主链比 0.46、combined 比 0.89）。 */
  localCoverage?: number | null;
  /** main=只比主链 / combined=比主链+子代理 */
  localScope?: "main" | "combined";
  /** 参与对账的本地 credits（按 localScope 取 totals.credits 或 subagents.combined.credits） */
  localCredits?: number | null;
}
/** 峰值占比的「该不该压」结论。阈值算在数据层（breakdown.mjs peakAdvice），
 *  这里只管展示——否则 Canvas 与终端各持一套阈值迟早走偏。tone 直接喂 Callout。 */
interface PeakAdvice {
  level: "low" | "mid" | "sweet" | "high" | "over";
  tone: "info" | "success" | "warning" | "danger";
  text: string;
}
/** 一次压缩 = 一笔普通模型调用（整份上下文当 prompt、摘要当 completion），是会话里单笔最贵的开销。
 *  pre/post 是客户端自估口径；proxy 是能在代理日志里唯一对上时回填的供应商实测值，对不上就 null。 */
interface CompactionEvent {
  index: number;
  at: string | null;
  trigger: string | null;
  preTokens: number | null;
  postTokens: number | null;
  messagesSummarized: number | null;
  /** 压缩后首轮的往返序号与实测输入 = 压缩把上下文压到的地板 */
  nextRequestIndex: number | null;
  nextInputTokens: number | null;
  savedTokens: number | null;
  /** 数据层归一后的生效值：有代理实测就用实测，否则是客户端自估。
   *  渲染端直接取这两个，别自己按 proxy 分支——否则会与合计的口径分叉。 */
  effectiveInputTokens?: number | null;
  effectiveOutputTokens?: number | null;
  proxy?: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number | null;
    ms: number | null;
    matchedBy: string;
  } | null;
}
interface CompactionCost {
  count: number;
  items: CompactionEvent[];
  /** measured = items 里有几笔拿到了供应商实测（其余为客户端自估） */
  totals: { preTokens: number; postTokens: number; savedTokens: number; measured?: number };
}
/** 链路健康度：代理覆盖率 + 最近记录时间 + 最近若干笔的三方归因计数。
 *  逐笔明细属于排障（CLI --request-log），报告只给一行结论。 */
interface LinkHealth {
  matched: number;
  requests: number;
  coverage: number;
  /** proxy / transcript-tokens / transcript-ratio / mixed / transcript（v3 旧报告）/ null */
  usageSource?: "proxy" | "transcript-tokens" | "transcript-ratio" | "mixed" | "transcript" | null;
  /** 三档拆分：代理实测 / 转录 input_tokens / 转录 ratio×window */
  breakdown?: { proxy: number; transcriptTokens: number; transcriptRatio: number };
  logRecords?: number;
  lastRecordAt?: string | null;
  /** 参与归因的最近笔数；0 = 运行中的代理是旧版或还没记到诊断 */
  recentRequests?: number;
  proxyErrors?: number | null;
  upstreamRejected?: number | null;
  aborted?: number | null;
  truncated?: number | null;
  noUsage?: number | null;
  slowestMs?: number | null;
  /** 被更新流量推翻的那条陈旧拉起失败记录；null = 没有 */
  supersededFailure?: { error: string; port?: number; at?: string | null } | null;
}
interface Report {
  schemaVersion: number;
  generatedAt: string;
  pluginVersion?: string;
  /** 转录来自哪一代客户端：桌面端富转录有 usage 真值，IDE 端精简转录没有。v2 旧报告无此字段。 */
  source?: "desktop-rich" | "ide-lite" | "unknown";
  /** usage 数字的来源：proxy=代理实测 / transcript-tokens=转录 input_tokens 真值 /
   *  transcript-ratio=转录 ratio×window 推导 / mixed=多档混合 / transcript=v3 旧报告兼容。无 usage 时 null。 */
  usageSource?: "proxy" | "transcript-tokens" | "transcript-ratio" | "mixed" | "transcript" | null;
  /** 可直接粘贴执行的插件入口命令（generate.mjs 用 proxy.mjs 的 selfCmd() 注入）。
   *  Windows 上是插件自带启动器的绝对路径，不要求用户装 Node；模板是静态文本，拿不到就只能硬编码。 */
  selfCmd?: string | null;
  /** 链路健康度一行结论（逐笔明细留给 CLI --request-log） */
  linkHealth?: LinkHealth | null;
  /** 代理 join 诊断（lib/proxylog.mjs）+ 配置/状态（generate.mjs 注入） */
  proxy?: {
    matched: number;
    requests: number;
    /** 三档拆分：代理实测 / 转录 input_tokens / 转录 ratio×window */
    breakdown?: { proxy: number; transcriptTokens: number; transcriptRatio: number };
    logPath?: string;
    logExists?: boolean;
    logRecords?: number;
    /** config.json 里 upstream 合法 = 用户已配置代理 */
    configured?: boolean;
    enabled?: boolean;
    port?: number;
    /** 最近一条代理记录的时间；null = 从无流量 */
    lastRecordAt?: string | null;
    /** 已配置但长期零流量（多半已改回官方模型）——软提示可 --stop-proxy */
    dormant?: boolean;
    /** 最近一次自动拉起失败（如端口被占）；ok 时为 null */
    status?: { error: string; port?: number; at?: string | null } | null;
    /** status 那条失败记录是否已被更新的流量推翻（代理在它之后还记到了流量）。
     *  status.json 只写不清，陈旧失败会把用户推去改本来正确的 Base URL，故必须判掉。 */
    statusSuperseded?: boolean;
  };
  availability?: Availability;
  manual?: ManualTruth | null;
  session: {
    id: string | null;
    title: string | null;
    /** custom-title / first-user / session-id —— 令产物文件名可解释 */
    titleSource?: string;
    model: string | null;
    /** runtime-config / manual / unavailable */
    modelSource?: string;
    cwd: string | null;
    turns: number;
    roundTrips: number;
    compactions: number;
    startedAt: string | null;
    endedAt: string | null;
  };
  context: {
    contextWindow: number;
    /** runtime-config=实测 / derived-from-usage=从 usage 反推 / manual=ManualTruth 手工锁定 /
     *  fallback=读不到静默回退 200000 / caller=调用方传入（旧枚举，兼容）。
     *  报告里每个 token 数字都要乘它，回退时必须标出来。 */
    contextWindowSource?: string;
    systemPromptTokens: number;
    netContextTokens: number;
    /** 峰值 = 当前窗口口径：自最近一次压缩起算，压缩边界处归零重新累积 */
    peakContextTokens: number;
    peakContextRatio: number;
    /** 本场历史峰值（跨压缩）；整场没压缩过时与上面相等 */
    peakSessionTokens?: number;
    peakSessionRatio?: number;
    /** 历史峰值是否值得单独交代（与当前窗口峰值相差 ≥1 个百分点），渲染端直接取用不再自判 */
    peakSessionNotable?: boolean;
    /** 峰值占比的「该不该压」结论（对模型窗口）；无有效占比时 null */
    peakAdvice?: PeakAdvice | null;
    /** 用户压缩阈值（Qoder 自动触发点），与模型窗口独立。默认 200000，ManualTruth 可覆盖 */
    userContextLimit?: number;
    /** default=内置 200K / manual=overrides 手写 / config=插件配置 / derived=实测反推 */
    userContextLimitSource?: "default" | "manual" | "config" | "derived";
    /** peakContextTokens ÷ userContextLimit */
    peakUserRatio?: number;
    /** 对用户阈值的「快自动压缩了吗」结论；与 peakAdvice 可矛盾（模型窗口未满但用户阈值已超） */
    peakUserAdvice?: PeakAdvice | null;
    /** v3.2 当前占用头条口径：段内单调递增 ⇒ 峰值≡当前，故以 netContextTokens 作头条，peak 退灰字 */
    currentContextTokens?: number;
    netUserRatio?: number;
    netUserAdvice?: PeakAdvice | null;
    netWindowRatio?: number;
    /** v3.2 自动压缩自校准：本场 trigger=auto 的实际触发点（无需外部配置）与「阈值是否被强制」判定 */
    observedAutoCompactions?: number;
    observedAutoTriggerTokens?: number | null;
    autoTriggerRatio?: number | null;
    thresholdNotEnforced?: boolean;
  };
  totals: {
    billedInputTokens: number;
    netContextTokens: number;
    peakContextTokens: number;
    amplification: number;
    attributedTokens: number;
    coverage: number;
    credits: number;
    originalCredits: number;
    /** 输出 token 总量：仅代理路径有真值，否则 0 且 availability.outputTokens=unavailable */
    outputTokens?: number;
    /** 供应商上下文缓存命中的那部分 prompt：仅代理路径有真值 */
    cachedTokens?: number;
    cachedTrips?: number;
    /** 缓存命中 ÷ 计费输入总量（全局实测约 91.5%：重复叠加的前缀正是缓存的命中对象） */
    cachedShare?: number;
    /** 两个不依赖 usage 的计数，IDE 端占比全缺时仍有可展示的真值 */
    toolCalls?: number;
    fileReads?: number;
  };
  /** credits 的分子到底覆盖了多少：与计费输入总量并排展示时，部分覆盖不说就等于把局部真值当全量。 */
  creditsCoverage?: {
    /** 真正累加进 totals.credits 的往返数 */
    trips: number;
    roundTrips: number;
    /** 这些往返的计费输入之和 */
    tokens: number;
    tokenShare: number;
    /** trips === roundTrips：全覆盖时不必再啰嗦覆盖范围 */
    full: boolean;
  };
  /** 压缩单笔成本（此前只显示「压缩 N 次」，而它是会话里单笔最贵的调用） */
  compactionCost?: CompactionCost;
  byCategory: CatRow[];
  byCategoryDetail: CatDetail[];
  byTool: ToolRow[];
  byFile: FileRow[];
  byRequest: ReqRow[];
  subagents?: Subagents;
  identity: { sumAttributed: number; billedInputTokens: number; absDiff: number; ok: boolean | null };
}

// 注入点：下一行的 REPORT 初值会被 render-canvas.mjs 按整行替换为真实报告 JSON。
const REPORT = {"schemaVersion":3.2,"generatedAt":"2026-11-27T06:43:31.157Z","source":"desktop-rich","usageSource":"transcript-ratio","availability":{"credits":"measured","roundTrips":"measured","contextRatio":"measured","tokens":"derived","outputTokens":"unavailable","cachedTokens":"unavailable","categoryShare":"derived","toolShare":"derived","fileShare":"derived","systemPrompt":"derived","contextWindow":"fallback","compactions":"measured","compactionCost":"measured","model":"measured","title":"measured","toolCalls":"measured","fileReads":"measured","userTurns":"measured","userContextLimit":"fallback"},"session":{"id":"8e62ddf2-306d-44ea-ba1f-5c0ca64c3696","title":"<command-message>grill-m","titleSource":"first-user","model":"hmodel","modelSource":"runtime-config","cwd":"C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo","turns":13,"roundTrips":520,"compactions":0,"startedAt":"2026-11-27T03:36:12.003Z","endedAt":"2026-11-27T06:43:30.866Z"},"context":{"contextWindow":200000,"contextWindowSource":"fallback","systemPromptTokens":0,"netContextTokens":87667,"peakContextTokens":87667,"peakContextRatio":0.438336,"peakSessionTokens":87667,"peakSessionRatio":0.438336,"peakSessionNotable":false,"peakAdvice":{"level":"mid","tone":"info","text":"已过盈亏线（39%）但还没进性价比区间，压缩有净收益但不大；不急着压"},"userContextLimit":200000,"userContextLimitSource":"default","peakUserRatio":0.438336,"peakUserAdvice":{"level":"mid","tone":"info","text":"已过盈亏线（39%）但还没进性价比区间，压缩有净收益但不大；不急着压"},"currentContextTokens":87667,"netUserRatio":0.438335,"netUserAdvice":{"level":"mid","tone":"info","text":"已过盈亏线（39%）但还没进性价比区间，压缩有净收益但不大；不急着压"},"netWindowRatio":0.438335,"observedAutoCompactions":0,"observedAutoTriggerTokens":null,"autoTriggerRatio":null,"thresholdNotEnforced":false},"totals":{"billedInputTokens":26436748,"netContextTokens":87667,"peakContextTokens":87667,"amplification":301.56,"attributedTokens":26436748,"coverage":1,"credits":5059.08,"originalCredits":5059.08,"outputTokens":0,"cachedTokens":0,"cachedTrips":0,"cachedShare":0,"toolCalls":568,"fileReads":322},"creditsCoverage":{"trips":520,"roundTrips":520,"tokens":26436748,"tokenShare":1.000000007565227,"full":true},"compactionCost":{"count":0,"items":[],"totals":{"preTokens":0,"postTokens":0,"savedTokens":0,"measured":0}},"proxy":{"matched":0,"requests":520,"breakdown":{"proxy":0,"transcriptTokens":0,"transcriptRatio":520},"logPath":"C:\\Users\\World\\.qoder-credits-proxy\\usage.jsonl","logExists":false,"logRecords":0,"configured":false,"enabled":true,"port":49787,"lastRecordAt":null,"dormant":false,"status":null,"statusSuperseded":false},"byCategory":[{"key":"tool_result","label":"工具返回","tokens":10907997,"share":0.41260737789208785},{"key":"assistant_thinking","label":"模型思考","tokens":2503344,"share":0.09469181276049918},{"key":"assistant_tool_use","label":"工具调用","tokens":7954567,"share":0.30089053444999836},{"key":"assistant_text","label":"模型回复","tokens":1030638,"share":0.038985044178122936},{"key":"user_input","label":"用户输入","tokens":643068,"share":0.024324774446308643},{"key":"attachment","label":"附件/技能","tokens":3397134,"share":0.12850046383818378}],"byCategoryDetail":[{"key":"tool_result","label":"工具返回","tokens":10907997,"share":0.41260737789208785,"children":[{"tool":"Bash","label":"（无路径）","kind":"shell","tokens":3198402,"share":0.12098320162359802,"catShare":0.29321628285386503,"trips":24483},{"tool":"WebFetch","label":"（无路径）","kind":"other","tokens":2041007,"share":0.07720339583997063,"catShare":0.1871110406081061,"trips":981},{"tool":"Grep","label":"C:/Users/World/source/Github/HestiaLab/Atlas/src/Atlas.Core","kind":"search","tokens":469889,"share":0.017774074761706487,"catShare":0.0430774525955158,"trips":812},{"tool":"Grep","label":"C:/Users/World/.nuget/packages/bunit/2.15.2/lib/net10.0/bunit.xml","kind":"search","tokens":420195,"share":0.01589435501822774,"catShare":0.03852174214486466,"trips":810},{"tool":"Grep","label":"C:/Users/World/.nuget/packages/atlas.blazor/0.4.0/lib/net10.0/Atlas.Blazor.xml","kind":"search","tokens":402106,"share":0.015210114143100903,"catShare":0.03686340806799367,"trips":413},{"tool":"AskUserQuestion","label":"（无路径）","kind":"other","tokens":354576,"share":0.013412221143729941,"catShare":0.032506013858137395,"trips":30059},{"tool":"Read","label":"C:/Users/World/.qoder-cn/tmp/C--Users-World-source-Github-HestiaLab-Loveevo/tool-outputs/session-8e62ddf2-306d-44ea-ba1f-5c0ca64c3696/webfetch-7f63938c-0840-46f9-b0c0-caeba30e0d63.md","kind":"read","tokens":321491,"share":0.012160753848861172,"catShare":0.02947294328809036,"trips":880},{"tool":"Read","label":"C:/Users/World/.agents/skills/blazor-development/references/state-driven-component-architecture.md","kind":"read","tokens":235830,"share":0.008920524040010844,"catShare":0.021619884951121483,"trips":450},{"tool":"Grep","label":"C:/Users/World/source/Github/HestiaLab/Atlas/src/Atlas.Core/Operations","kind":"search","tokens":232605,"share":0.008798559616292714,"catShare":0.021324290567082065,"trips":408},{"tool":"Read","label":"C:/Users/World/source/Github/HestiaLab/Atlas/samples/Atlas.Showcase/Components/ShowcaseWorkspace.razor.cs","kind":"read","tokens":212619,"share":0.008042541909842743,"catShare":0.01949199733395501,"trips":410},{"tool":"Read","label":"C:/Users/World/source/Github/HestiaLab/Atlas/samples/Atlas.Showcase/Components/ShowcaseWorkspaceDefinition.cs","kind":"read","tokens":203003,"share":0.0076788088586438276,"catShare":0.018610449715836447,"trips":410},{"tool":"mcp_list","label":"（无路径）","kind":"other","tokens":190121,"share":0.007191558408344424,"catShare":0.01742954390463004,"trips":1068},{"tool":"mcp_get","label":"（无路径）","kind":"other","tokens":182894,"share":0.0069181712701779,"catShare":0.01676695968337061,"trips":1807},{"tool":"Read","label":"C:/Users/World/source/Github/HestiaLab/Atlas/src/Atlas.Core/Model/Items/DockItem.cs","kind":"read","tokens":163916,"share":0.0062003013634926605,"catShare":0.015027121897743353,"trips":410},{"tool":"Read","label":"C:/Users/World/.agents/skills/blazor-development/references/ui-extension-patterns.md","kind":"read","tokens":144228,"share":0.005455588947288511,"catShare":0.013222228296449291,"trips":450},{"tool":null,"label":"其他 148 项","kind":null,"tokens":2135117,"share":0.08076320709883124,"catShare":0.19573864023331597,"trips":85225}]},{"key":"assistant_thinking","label":"模型思考","tokens":2503344,"share":0.09469181276049918,"children":[]},{"key":"assistant_tool_use","label":"工具调用","tokens":7954567,"share":0.30089053444999836,"children":[{"tool":"AskUserQuestion","label":"（无路径）","kind":"other","tokens":1483665,"share":0.05612131186798022,"catShare":0.1865173724077598,"trips":30059},{"tool":"Write","label":"src/Loveevo.App/wwwroot/css/app.css","kind":"write","tokens":643476,"share":0.02434020006012485,"catShare":0.0808938709375375,"trips":319},{"tool":"Bash","label":"（无路径）","kind":"shell","tokens":378515,"share":0.014317765070104451,"catShare":0.04758463105619483,"trips":24483},{"tool":"Write","label":"src/Loveevo.App/Services/LoveevoState.cs","kind":"write","tokens":336587,"share":0.012731774948123909,"catShare":0.04231364396821749,"trips":604},{"tool":"Write","label":"src/Loveevo.App/wwwroot/js/loveevo.js","kind":"write","tokens":304001,"share":0.01149916806459617,"catShare":0.038217114691280155,"trips":422},{"tool":"Write","label":"src/Loveevo.App/Components/EventEditor.razor","kind":"write","tokens":270559,"share":0.010234210349620323,"catShare":0.03401306846799806,"trips":394},{"tool":"Write","label":"src/Loveevo.Core/Services/BackupService.cs","kind":"write","tokens":241478,"share":0.00913419466944095,"catShare":0.030357201784820056,"trips":427},{"tool":"Write","label":"src/Loveevo.App/Components/SettingsPanel.razor","kind":"write","tokens":224363,"share":0.008486776631348584,"catShare":0.028205528787609326,"trips":378},{"tool":"Write","label":"src/Loveevo.App/Components/LoveevoWorkspace.razor","kind":"write","tokens":213558,"share":0.00807805822937787,"catShare":0.026847166342882322,"trips":377},{"tool":"Write","label":"src/Loveevo.App/Components/Timeline.razor","kind":"write","tokens":166704,"share":0.0063057857179034775,"catShare":0.020957075733305814,"trips":383},{"tool":"Edit","label":"src/Loveevo.Core/Services/BackupService.cs","kind":"write","tokens":157658,"share":0.0059636104916630395,"catShare":0.019819867389859903,"trips":2743},{"tool":"Write","label":"src/Loveevo.App/Components/PhotoGallery.razor","kind":"write","tokens":135824,"share":0.005137679967558567,"catShare":0.017074913895014338,"trips":396},{"tool":"Write","label":"tests/Loveevo.Browser/tests/loveevo.spec.cjs","kind":"write","tokens":134704,"share":0.005095338266153611,"catShare":0.016934192614159318,"trips":497},{"tool":"Edit","label":"src/Loveevo.App/Components/EventEditor.razor","kind":"write","tokens":123575,"share":0.004674375323817252,"catShare":0.015535135833905851,"trips":5044},{"tool":"Write","label":"src/Loveevo.App/Components/StagePanel.razor","kind":"write","tokens":121673,"share":0.004602425363587871,"catShare":0.015296012458486616,"trips":382},{"tool":null,"label":"其他 148 项","kind":null,"tokens":3018227,"share":0.11416785942858951,"catShare":0.37943320363094307,"trips":82168}]},{"key":"assistant_text","label":"模型回复","tokens":1030638,"share":0.038985044178122936,"children":[]},{"key":"user_input","label":"用户输入","tokens":643068,"share":0.024324774446308643,"children":[]},{"key":"attachment","label":"附件/技能","tokens":3397134,"share":0.12850046383818378,"children":[]}],"byTool":[{"tool":"Write","tokens":4531199,"calls":57,"perCall":79495,"share":0.1713977457221328},{"tool":"Bash","tokens":3576918,"calls":122,"perCall":29319,"share":0.13530096669370337},{"tool":"Read","tokens":2371583,"calls":55,"perCall":43120,"share":0.08970783334333472},{"tool":"WebFetch","tokens":2058680,"calls":3,"perCall":686227,"share":0.07787191470010692},{"tool":"Grep","tokens":1948282,"calls":22,"perCall":88558,"share":0.07369599669111107},{"tool":"AskUserQuestion","tokens":1838240,"calls":62,"perCall":29649,"share":0.0695335330117107},{"tool":"Edit","tokens":1752073,"calls":182,"perCall":9627,"share":0.06627413663149002},{"tool":"mcp_list","tokens":194623,"calls":3,"perCall":64874,"share":0.007361852188135645},{"tool":"mcp_get","tokens":187223,"calls":5,"perCall":37445,"share":0.007081907200590761},{"tool":"mcp_call","tokens":175615,"calls":11,"perCall":15965,"share":0.006642855158702015},{"tool":"TaskCreate","tokens":64549,"calls":6,"perCall":10758,"share":0.002441647663971428},{"tool":"Skill","tokens":43094,"calls":6,"perCall":7182,"share":0.0016300704720806094},{"tool":"TaskStop","tokens":37250,"calls":16,"perCall":2328,"share":0.0014090169671124538},{"tool":"Agent","tokens":28062,"calls":2,"perCall":14031,"share":0.0010614843384118067},{"tool":"ImageGen","tokens":25576,"calls":1,"perCall":25576,"share":0.0009674242799175691},{"tool":"Glob","tokens":24053,"calls":6,"perCall":4009,"share":0.0009098242266301167},{"tool":"TaskUpdate","tokens":5544,"calls":9,"perCall":616,"share":0.00020970305296911558}],"byFile":[{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\wwwroot\\css\\app.css","label":"src/Loveevo.App/wwwroot/css/app.css","kind":"write","tool":"Write","selfTokens":11359,"reads":6,"trips":2516,"billed":716587,"perRead":119431,"share":0.027105709773696793},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.Core\\Services\\BackupService.cs","label":"src/Loveevo.Core/Services/BackupService.cs","kind":"write","tool":"Write","selfTokens":10078,"reads":17,"trips":6866,"billed":496102,"perRead":29182,"share":0.01876561031198439},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Atlas\\src\\Atlas.Core","label":"C:/Users/World/source/Github/HestiaLab/Atlas/src/Atlas.Core","kind":"search","tool":"Grep","selfTokens":5605,"reads":4,"trips":3242,"billed":491467,"perRead":122867,"share":0.01859030429385332},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Components\\EventEditor.razor","label":"src/Loveevo.App/Components/EventEditor.razor","kind":"write","tool":"Write","selfTokens":6668,"reads":22,"trips":11170,"billed":457633,"perRead":20801,"share":0.017310476923895503},{"attr":"file:C:\\Users\\World\\.nuget\\packages\\bunit\\2.15.2\\lib\\net10.0\\bunit.xml","label":"C:/Users/World/.nuget/packages/bunit/2.15.2/lib/net10.0/bunit.xml","kind":"search","tool":"Grep","selfTokens":7367,"reads":3,"trips":1620,"billed":429693,"perRead":143231,"share":0.01625362643070034},{"attr":"file:C:\\Users\\World\\.nuget\\packages\\atlas.blazor\\0.4.0\\lib\\net10.0\\Atlas.Blazor.xml","label":"C:/Users/World/.nuget/packages/atlas.blazor/0.4.0/lib/net10.0/Atlas.Blazor.xml","kind":"search","tool":"Grep","selfTokens":4565,"reads":1,"trips":826,"billed":409644,"perRead":409644,"share":0.015495240139088508},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Services\\LoveevoState.cs","label":"src/Loveevo.App/Services/LoveevoState.cs","kind":"write","tool":"Write","selfTokens":6633,"reads":10,"trips":5186,"billed":400985,"perRead":40099,"share":0.015167731534014683},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\wwwroot\\js\\loveevo.js","label":"src/Loveevo.App/wwwroot/js/loveevo.js","kind":"write","tool":"Write","selfTokens":5324,"reads":8,"trips":3642,"billed":398131,"perRead":49766,"share":0.01505974815414273},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Components\\LoveevoWorkspace.razor","label":"src/Loveevo.App/Components/LoveevoWorkspace.razor","kind":"write","tool":"Write","selfTokens":6126,"reads":17,"trips":6108,"billed":342836,"perRead":20167,"share":0.012968151104049338},{"attr":"file:C:\\Users\\World\\.qoder-cn\\tmp\\C--Users-World-source-Github-HestiaLab-Loveevo\\tool-outputs\\session-8e62ddf2-306d-44ea-ba1f-5c0ca64c3696\\webfetch-7f63938c-0840-46f9-b0c0-caeba30e0d63.md","label":"C:/Users/World/.qoder-cn/tmp/C--Users-World-source-Github-HestiaLab-Loveevo/tool-outputs/session-8e62ddf2-306d-44ea-ba1f-5c0ca64c3696/webfetch-7f63938c-0840-46f9-b0c0-caeba30e0d63.md","kind":"read","tool":"Read","selfTokens":3495,"reads":2,"trips":1760,"billed":332697,"perRead":166348,"share":0.012584635935554287},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Components\\SettingsPanel.razor","label":"src/Loveevo.App/Components/SettingsPanel.razor","kind":"write","tool":"Write","selfTokens":6015,"reads":10,"trips":3246,"billed":328683,"perRead":32868,"share":0.012432823792100527},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Components\\PhotoGallery.razor","label":"src/Loveevo.App/Components/PhotoGallery.razor","kind":"write","tool":"Write","selfTokens":4447,"reads":13,"trips":7824,"billed":317765,"perRead":24443,"share":0.012019806620852124},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\tests\\Loveevo.Browser\\tests\\loveevo.spec.cjs","label":"tests/Loveevo.Browser/tests/loveevo.spec.cjs","kind":"write","tool":"Write","selfTokens":6910,"reads":14,"trips":5140,"billed":279516,"perRead":19965,"share":0.010573010152378494},{"attr":"file:C:\\Users\\World\\.agents\\skills\\blazor-development\\references\\state-driven-component-architecture.md","label":"C:/Users/World/.agents/skills/blazor-development/references/state-driven-component-architecture.md","kind":"read","tool":"Read","selfTokens":2414,"reads":1,"trips":900,"billed":238797,"perRead":238797,"share":0.009032778956621725},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Atlas\\src\\Atlas.Core\\Operations","label":"C:/Users/World/source/Github/HestiaLab/Atlas/src/Atlas.Core/Operations","kind":"search","tool":"Grep","selfTokens":2670,"reads":1,"trips":816,"billed":236503,"perRead":236503,"share":0.008945984072925193},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Components\\OverviewPanel.razor","label":"src/Loveevo.App/Components/OverviewPanel.razor","kind":"write","tool":"Write","selfTokens":3097,"reads":8,"trips":4596,"billed":227645,"perRead":28456,"share":0.008610935676981093},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Atlas\\samples\\Atlas.Showcase\\Components\\ShowcaseWorkspace.razor.cs","label":"C:/Users/World/source/Github/HestiaLab/Atlas/samples/Atlas.Showcase/Components/ShowcaseWorkspace.razor.cs","kind":"read","tool":"Read","selfTokens":2424,"reads":1,"trips":820,"billed":215824,"perRead":215824,"share":0.008163786260242374},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Components\\Timeline.razor","label":"src/Loveevo.App/Components/Timeline.razor","kind":"write","tool":"Write","selfTokens":3185,"reads":6,"trips":2246,"billed":207377,"perRead":34563,"share":0.007844261958109548},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Atlas\\samples\\Atlas.Showcase\\Components\\ShowcaseWorkspaceDefinition.cs","label":"C:/Users/World/source/Github/HestiaLab/Atlas/samples/Atlas.Showcase/Components/ShowcaseWorkspaceDefinition.cs","kind":"read","tool":"Read","selfTokens":2314,"reads":1,"trips":820,"billed":206030,"perRead":206030,"share":0.007793317411799043},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Components\\StagePanel.razor","label":"src/Loveevo.App/Components/StagePanel.razor","kind":"write","tool":"Write","selfTokens":2342,"reads":6,"trips":3006,"billed":167905,"perRead":27984,"share":0.0063511850185707435},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Atlas\\src\\Atlas.Core\\Model\\Items\\DockItem.cs","label":"C:/Users/World/source/Github/HestiaLab/Atlas/src/Atlas.Core/Model/Items/DockItem.cs","kind":"read","tool":"Read","selfTokens":1869,"reads":1,"trips":820,"billed":166409,"perRead":166409,"share":0.006294602524914602},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Layout\\MainLayout.razor","label":"src/Loveevo.App/Layout/MainLayout.razor","kind":"read","tool":"Read","selfTokens":3894,"reads":14,"trips":6420,"billed":158777,"perRead":11341,"share":0.006005919183282896},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Services\\BrowserStore.cs","label":"src/Loveevo.App/Services/BrowserStore.cs","kind":"write","tool":"Write","selfTokens":2158,"reads":6,"trips":3000,"billed":150396,"perRead":25066,"share":0.005688900528651789},{"attr":"file:C:\\Users\\World\\.agents\\skills\\blazor-development\\references\\ui-extension-patterns.md","label":"C:/Users/World/.agents/skills/blazor-development/references/ui-extension-patterns.md","kind":"read","tool":"Read","selfTokens":1485,"reads":1,"trips":900,"billed":146899,"perRead":146899,"share":0.0055566183722383},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Components\\MobileApp.razor","label":"src/Loveevo.App/Components/MobileApp.razor","kind":"write","tool":"Write","selfTokens":1655,"reads":4,"trips":2948,"billed":132270,"perRead":33067,"share":0.005003256620813951},{"attr":"file:C:\\Users\\World\\.agents\\skills\\blazor-development\\references\\blazor-typescript-interop.md","label":"C:/Users/World/.agents/skills/blazor-development/references/blazor-typescript-interop.md","kind":"read","tool":"Read","selfTokens":1310,"reads":1,"trips":900,"billed":129588,"perRead":129588,"share":0.004901798025341523},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\wwwroot\\service-worker.published.js","label":"src/Loveevo.App/wwwroot/service-worker.published.js","kind":"read","tool":"Read","selfTokens":1563,"reads":5,"trips":3366,"billed":125993,"perRead":25199,"share":0.004765816249745241},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.Core\\Models\\LoveevoModels.cs","label":"src/Loveevo.Core/Models/LoveevoModels.cs","kind":"write","tool":"Write","selfTokens":1544,"reads":5,"trips":3216,"billed":125829,"perRead":25166,"share":0.0047596227548030575},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Atlas\\src\\Atlas.Core\\Operations\\Engine\\DefaultWorkspaceOperationPlanner.cs","label":"C:/Users/World/source/Github/HestiaLab/Atlas/src/Atlas.Core/Operations/Engine/DefaultWorkspaceOperationPlanner.cs","kind":"search","tool":"Grep","selfTokens":1408,"reads":1,"trips":808,"billed":123436,"perRead":123436,"share":0.004669093568394134},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Components\\Icon.razor","label":"src/Loveevo.App/Components/Icon.razor","kind":"write","tool":"Write","selfTokens":1358,"reads":1,"trips":794,"billed":116899,"perRead":116899,"share":0.004421855355814829},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Components\\EventDetail.razor","label":"src/Loveevo.App/Components/EventDetail.razor","kind":"write","tool":"Write","selfTokens":2184,"reads":9,"trips":2878,"billed":110626,"perRead":12292,"share":0.004184548500439806},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Components\\Onboarding.razor","label":"src/Loveevo.App/Components/Onboarding.razor","kind":"write","tool":"Write","selfTokens":1278,"reads":2,"trips":1490,"billed":103126,"perRead":51563,"share":0.00390086582735232},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Atlas\\src\\Atlas.Core\\Persistence","label":"C:/Users/World/source/Github/HestiaLab/Atlas/src/Atlas.Core/Persistence","kind":"search","tool":"Grep","selfTokens":1358,"reads":1,"trips":692,"billed":101623,"perRead":101623,"share":0.0038440043056833235},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\tests\\Loveevo.Browser\\test-results\\loveevo-onboarding-event-l-ec721-hoto-upload-and-persistence\\error-context.md","label":"tests/Loveevo.Browser/test-results/loveevo-onboarding-event-l-ec721-hoto-upload-and-persistence/error-context.md","kind":"read","tool":"Read","selfTokens":1811,"reads":2,"trips":1010,"billed":95442,"perRead":47721,"share":0.003610184824369426},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Atlas\\src\\Atlas.Core\\Model\\Items\\ContentReference.cs","label":"C:/Users/World/source/Github/HestiaLab/Atlas/src/Atlas.Core/Model/Items/ContentReference.cs","kind":"read","tool":"Read","selfTokens":1035,"reads":1,"trips":820,"billed":92153,"perRead":92153,"share":0.0034857750739896312},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\wwwroot\\index.html","label":"src/Loveevo.App/wwwroot/index.html","kind":"read","tool":"Read","selfTokens":1123,"reads":3,"trips":2138,"billed":87144,"perRead":29048,"share":0.00329631550692126},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.Core\\Validation\\LoveevoValidation.cs","label":"src/Loveevo.Core/Validation/LoveevoValidation.cs","kind":"write","tool":"Write","selfTokens":926,"reads":1,"trips":860,"billed":86889,"perRead":86889,"share":0.0032866577055670463},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\tests\\Loveevo.Tests\\LoveevoStateTests.cs","label":"tests/Loveevo.Tests/LoveevoStateTests.cs","kind":"write","tool":"Write","selfTokens":2220,"reads":4,"trips":1300,"billed":86150,"perRead":21537,"share":0.003258710790973199},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Services\\LoveevoWorkspaceDefinition.cs","label":"src/Loveevo.App/Services/LoveevoWorkspaceDefinition.cs","kind":"write","tool":"Write","selfTokens":870,"reads":1,"trips":800,"billed":75481,"perRead":75481,"share":0.0028551501694843526},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Components\\FilterPanel.razor","label":"src/Loveevo.App/Components/FilterPanel.razor","kind":"write","tool":"Write","selfTokens":1111,"reads":3,"trips":1028,"billed":68699,"perRead":22900,"share":0.002598626580917643},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\tests\\Loveevo.Tests\\FakeStore.cs","label":"tests/Loveevo.Tests/FakeStore.cs","kind":"write","tool":"Write","selfTokens":1307,"reads":5,"trips":2184,"billed":66668,"perRead":13334,"share":0.002521788093595229},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.Core\\Services\\ILoveevoStore.cs","label":"src/Loveevo.Core/Services/ILoveevoStore.cs","kind":"write","tool":"Write","selfTokens":950,"reads":5,"trips":2814,"billed":62790,"perRead":12558,"share":0.00237509593358431},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\tests\\Loveevo.Tests\\BackupServiceTests.cs","label":"tests/Loveevo.Tests/BackupServiceTests.cs","kind":"write","tool":"Write","selfTokens":2094,"reads":5,"trips":1090,"billed":62060,"perRead":12412,"share":0.0023475046372867553},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Program.cs","label":"src/Loveevo.App/Program.cs","kind":"read","tool":"Read","selfTokens":1049,"reads":7,"trips":3504,"billed":60628,"perRead":8661,"share":0.0022933324754649135},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Atlas\\src\\Atlas.Blazor","label":"C:/Users/World/source/Github/HestiaLab/Atlas/src/Atlas.Blazor","kind":"search","tool":"Grep","selfTokens":689,"reads":1,"trips":810,"billed":60560,"perRead":60560,"share":0.0022907331691429736},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Components\\DialogHost.razor","label":"src/Loveevo.App/Components/DialogHost.razor","kind":"write","tool":"Write","selfTokens":937,"reads":3,"trips":1252,"billed":59749,"perRead":19916,"share":0.0022600733375485954},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Atlas\\src\\Atlas.Core\\Operations\\OpenItemOperation.cs","label":"C:/Users/World/source/Github/HestiaLab/Atlas/src/Atlas.Core/Operations/OpenItemOperation.cs","kind":"read","tool":"Read","selfTokens":668,"reads":1,"trips":816,"billed":59170,"perRead":59170,"share":0.0022381712961475754},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Atlas\\src\\Atlas.Core\\Model\\Items\\DockItemCapabilityPresets.cs","label":"C:/Users/World/source/Github/HestiaLab/Atlas/src/Atlas.Core/Model/Items/DockItemCapabilityPresets.cs","kind":"read","tool":"Read","selfTokens":668,"reads":1,"trips":812,"billed":58866,"perRead":58866,"share":0.0022266629075979607},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\tests\\Loveevo.Browser\\test-results\\loveevo-complete-ZIP-backu-7f4b3-estored-after-clearing-data\\error-context.md","label":"tests/Loveevo.Browser/test-results/loveevo-complete-ZIP-backu-7f4b3-estored-after-clearing-data/error-context.md","kind":"read","tool":"Read","selfTokens":2131,"reads":1,"trips":230,"billed":52462,"perRead":52462,"share":0.001984437493324613},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Services\\DialogService.cs","label":"src/Loveevo.App/Services/DialogService.cs","kind":"write","tool":"Write","selfTokens":584,"reads":1,"trips":798,"billed":50535,"perRead":50535,"share":0.0019115586611175872},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Atlas\\src\\Atlas.Core\\Persistence\\LayoutRestoreOptions.cs","label":"C:/Users/World/source/Github/HestiaLab/Atlas/src/Atlas.Core/Persistence/LayoutRestoreOptions.cs","kind":"read","tool":"Read","selfTokens":676,"reads":1,"trips":690,"billed":50440,"perRead":50440,"share":0.0019079350004176303},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\tests\\Loveevo.Tests\\TimelineComponentTests.cs","label":"tests/Loveevo.Tests/TimelineComponentTests.cs","kind":"write","tool":"Write","selfTokens":846,"reads":3,"trips":1622,"billed":49844,"perRead":16615,"share":0.001885415285065311},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\tests\\Loveevo.Browser\\tests\\accessibility.spec.cjs","label":"tests/Loveevo.Browser/tests/accessibility.spec.cjs","kind":"write","tool":"Write","selfTokens":1253,"reads":3,"trips":1016,"billed":49157,"perRead":16386,"share":0.0018594110301922706},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Services\\ImageService.cs","label":"src/Loveevo.App/Services/ImageService.cs","kind":"write","tool":"Write","selfTokens":539,"reads":1,"trips":838,"billed":49132,"perRead":49132,"share":0.0018584916155466513},{"attr":"file:C:\\Program Files\\dotnet\\packs\\Microsoft.AspNetCore.App.Ref\\10.0.14\\ref\\net10.0\\Microsoft.AspNetCore.Components.Web.xml","label":"C:/Program Files/dotnet/packs/Microsoft.AspNetCore.App.Ref/10.0.14/ref/net10.0/Microsoft.AspNetCore.Components.Web.xml","kind":"search","tool":"Grep","selfTokens":677,"reads":1,"trips":648,"billed":47426,"perRead":47426,"share":0.0017939380411883894},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Services\\EditorCloseGuard.cs","label":"src/Loveevo.App/Services/EditorCloseGuard.cs","kind":"write","tool":"Write","selfTokens":534,"reads":1,"trips":796,"billed":46088,"perRead":46088,"share":0.0017433277833575694},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Atlas\\src\\Atlas.Core\\Operations\\IDockItemCloseGuard.cs","label":"C:/Users/World/source/Github/HestiaLab/Atlas/src/Atlas.Core/Operations/IDockItemCloseGuard.cs","kind":"read","tool":"Read","selfTokens":503,"reads":1,"trips":802,"billed":43754,"perRead":43754,"share":0.0016550542315822306},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Services\\TimelineFilterState.cs","label":"src/Loveevo.App/Services/TimelineFilterState.cs","kind":"write","tool":"Write","selfTokens":442,"reads":2,"trips":1472,"billed":36022,"perRead":18011,"share":0.0013625744298814255},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\wwwroot\\manifest.webmanifest","label":"src/Loveevo.App/wwwroot/manifest.webmanifest","kind":"read","tool":"Read","selfTokens":455,"reads":2,"trips":1504,"billed":35132,"perRead":17566,"share":0.0013289248639725985},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\wwwroot\\js\\pwa.js","label":"src/Loveevo.App/wwwroot/js/pwa.js","kind":"write","tool":"Write","selfTokens":443,"reads":2,"trips":1458,"billed":34995,"perRead":17497,"share":0.0013237123658827801},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\.github\\workflows\\deploy.yml","label":".github/workflows/deploy.yml","kind":"write","tool":"Write","selfTokens":1567,"reads":3,"trips":512,"billed":33755,"perRead":11252,"share":0.0012768342574124899},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\tests\\Loveevo.Tests\\LoveevoValidationTests.cs","label":"tests/Loveevo.Tests/LoveevoValidationTests.cs","kind":"write","tool":"Write","selfTokens":530,"reads":1,"trips":560,"billed":32047,"perRead":32047,"share":0.0012122265020869055},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\tests\\Loveevo.Browser\\tests\\offline.spec.cjs","label":"tests/Loveevo.Browser/tests/offline.spec.cjs","kind":"write","tool":"Write","selfTokens":666,"reads":2,"trips":844,"billed":30437,"perRead":15218,"share":0.0011512965536806376},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Components\\CoverImage.razor","label":"src/Loveevo.App/Components/CoverImage.razor","kind":"write","tool":"Write","selfTokens":558,"reads":3,"trips":1414,"billed":29602,"perRead":9867,"share":0.001119712606799179},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\tests\\Loveevo.Browser\\test-results\\loveevo-custom-stages-can--55a90-cted-and-used-for-filtering\\error-context.md","label":"tests/Loveevo.Browser/test-results/loveevo-custom-stages-can--55a90-cted-and-used-for-filtering/error-context.md","kind":"read","tool":"Read","selfTokens":1857,"reads":1,"trips":140,"billed":27805,"perRead":27805,"share":0.001051772509355477},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Loveevo.App.csproj","label":"src/Loveevo.App/Loveevo.App.csproj","kind":"read","tool":"Read","selfTokens":585,"reads":2,"trips":880,"billed":27057,"perRead":13529,"share":0.0010234724142261717},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\_Imports.razor","label":"src/Loveevo.App/_Imports.razor","kind":"read","tool":"Read","selfTokens":304,"reads":2,"trips":1646,"billed":26904,"perRead":13452,"share":0.0010176822055395526},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\tests\\Loveevo.Browser\\test-results\\loveevo-onboarding-event-l-ec721-hoto-upload-and-persistence\\test-failed-1.png","label":"tests/Loveevo.Browser/test-results/loveevo-onboarding-event-l-ec721-hoto-upload-and-persistence/test-failed-1.png","kind":"read","tool":"Read","selfTokens":439,"reads":3,"trips":1510,"billed":23826,"perRead":7942,"share":0.0009012570907570605},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\tests\\Loveevo.Browser\\package.json","label":"tests/Loveevo.Browser/package.json","kind":"read","tool":"Read","selfTokens":366,"reads":3,"trips":1150,"billed":16256,"perRead":5419,"share":0.0006148906743964123},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\tests\\Loveevo.Browser\\playwright.config.cjs","label":"tests/Loveevo.Browser/playwright.config.cjs","kind":"write","tool":"Write","selfTokens":248,"reads":1,"trips":530,"billed":14182,"perRead":14182,"share":0.0005364388993618811},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Atlas","label":"C:/Users/World/source/Github/HestiaLab/Atlas","kind":"search","tool":"Glob","selfTokens":139,"reads":3,"trips":2466,"billed":12408,"perRead":4136,"share":0.00046936296097212785},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\wwwroot\\assets\\loveevo-hero.png","label":"src/Loveevo.App/wwwroot/assets/loveevo-hero.png","kind":"read","tool":"Read","selfTokens":129,"reads":1,"trips":866,"billed":12201,"perRead":12201,"share":0.00046150402427006784},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\App.razor","label":"src/Loveevo.App/App.razor","kind":"read","tool":"Read","selfTokens":353,"reads":4,"trips":1044,"billed":10851,"perRead":2713,"share":0.0004104351615624744},{"attr":"file:C:\\Users\\World\\AppData\\Local\\Temp\\qoder-cli-cn\\C--Users-World-source-Github-HestiaLab-ActionLens\\fdd53cde-94f1-4b34-b935-e51a48a43e7e\\tasks\\bd4ws0899.output","label":"C:/Users/World/AppData/Local/Temp/qoder-cli-cn/C--Users-World-source-Github-HestiaLab-ActionLens/fdd53cde-94f1-4b34-b935-e51a48a43e7e/tasks/bd4ws0899.output","kind":"read","tool":"Read","selfTokens":166,"reads":1,"trips":604,"billed":10832,"perRead":10832,"share":0.0004097486083568373},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Services\\BeforeUnloadGuard.cs","label":"src/Loveevo.App/Services/BeforeUnloadGuard.cs","kind":"write","tool":"Write","selfTokens":350,"reads":1,"trips":280,"billed":10493,"perRead":10493,"share":0.0003969148396479465},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Localization\\LoveevoStrings.resx","label":"src/Loveevo.App/Localization/LoveevoStrings.resx","kind":"write","tool":"Write","selfTokens":434,"reads":1,"trips":222,"billed":10313,"perRead":10313,"share":0.0003900859108921699},{"attr":"file:C:\\Users\\World\\.nuget\\packages\\atlas.blazor\\0.4.0\\lib\\net10.0\\Atlas.Core.xml","label":"C:/Users/World/.nuget/packages/atlas.blazor/0.4.0/lib/net10.0/Atlas.Core.xml","kind":"search","tool":"Grep","selfTokens":113,"reads":1,"trips":828,"billed":10167,"perRead":10167,"share":0.0003845727938971236},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Atlas\\src\\Atlas.Core\\Operations\\UpdateItemPresentationOperation.cs","label":"C:/Users/World/source/Github/HestiaLab/Atlas/src/Atlas.Core/Operations/UpdateItemPresentationOperation.cs","kind":"read","tool":"Read","selfTokens":524,"reads":1,"trips":172,"billed":9645,"perRead":9645,"share":0.00036482241754317093},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.Core\\GlobalUsings.cs","label":"src/Loveevo.Core/GlobalUsings.cs","kind":"write","tool":"Write","selfTokens":92,"reads":1,"trips":858,"billed":8610,"perRead":8610,"share":0.0003256761940435082},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Pages\\Home.razor","label":"src/Loveevo.App/Pages/Home.razor","kind":"read","tool":"Read","selfTokens":827,"reads":6,"trips":1052,"billed":7782,"perRead":1297,"share":0.00029435163673769},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\wwwroot\\service-worker.js","label":"src/Loveevo.App/wwwroot/service-worker.js","kind":"read","tool":"Read","selfTokens":98,"reads":1,"trips":730,"billed":7739,"perRead":7739,"share":0.0002927553404450235},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Atlas\\src\\Atlas.Core\\Items\\DockItemCapabilities.cs","label":"C:/Users/World/source/Github/HestiaLab/Atlas/src/Atlas.Core/Items/DockItemCapabilities.cs","kind":"search","tool":"Grep","selfTokens":84,"reads":1,"trips":816,"billed":7441,"perRead":7441,"share":0.0002814466899347251},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\artifacts\\loveevo-timeline.png","label":"artifacts/loveevo-timeline.png","kind":"read","tool":"Read","selfTokens":125,"reads":1,"trips":394,"billed":5289,"perRead":5289,"share":0.00020004769979248675},{"attr":"file:C:\\Users\\World\\AppData\\Local\\Temp\\qoder-cli-cn\\C--Users-World-source-Github-HestiaLab-ActionLens\\fdd53cde-94f1-4b34-b935-e51a48a43e7e\\tasks\\b1gugqyeq.output","label":"C:/Users/World/AppData/Local/Temp/qoder-cli-cn/C--Users-World-source-Github-HestiaLab-ActionLens/fdd53cde-94f1-4b34-b935-e51a48a43e7e/tasks/b1gugqyeq.output","kind":"read","tool":"Read","selfTokens":75,"reads":1,"trips":508,"billed":4109,"perRead":4109,"share":0.0001554225290620655},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\.gitignore","label":".gitignore","kind":"write","tool":"Write","selfTokens":88,"reads":1,"trips":408,"billed":3858,"perRead":3858,"share":0.00014593600848172194},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\tests\\Loveevo.Browser\\test-results\\loveevo-complete-ZIP-backu-7f4b3-estored-after-clearing-data\\test-failed-1.png","label":"tests/Loveevo.Browser/test-results/loveevo-complete-ZIP-backu-7f4b3-estored-after-clearing-data/test-failed-1.png","kind":"read","tool":"Read","selfTokens":146,"reads":1,"trips":230,"billed":3594,"perRead":3594,"share":0.00013595864571815748},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo","label":"C:/Users/World/source/Github/HestiaLab/Loveevo","kind":"search","tool":"Glob","selfTokens":24,"reads":1,"trips":1036,"billed":2944,"perRead":2944,"share":0.00011137133280675716},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Localization\\LoveevoStrings.cs","label":"src/Loveevo.App/Localization/LoveevoStrings.cs","kind":"write","tool":"Write","selfTokens":100,"reads":1,"trips":224,"billed":2398,"perRead":2398,"share":0.00009069174157858687},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\tests\\Loveevo.Browser\\test-results\\loveevo-custom-stages-can--55a90-cted-and-used-for-filtering\\test-failed-1.png","label":"tests/Loveevo.Browser/test-results/loveevo-custom-stages-can--55a90-cted-and-used-for-filtering/test-failed-1.png","kind":"read","tool":"Read","selfTokens":146,"reads":1,"trips":140,"billed":2186,"perRead":2186,"share":0.00008269186126327385},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.App\\Pages\\NotFound.razor","label":"src/Loveevo.App/Pages/NotFound.razor","kind":"read","tool":"Read","selfTokens":225,"reads":2,"trips":70,"billed":762,"perRead":381,"share":0.00002880882428684715},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\LICENSE","label":"LICENSE","kind":"read","tool":"Read","selfTokens":392,"reads":4,"trips":40,"billed":389,"perRead":97,"share":0.000014726435744426455},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\README.md","label":"README.md","kind":"write","tool":"Write","selfTokens":702,"reads":1,"trips":2,"billed":150,"perRead":150,"share":0.00000567352609373751},{"attr":"file:C:\\Users\\World\\source\\Github\\HestiaLab\\Loveevo\\src\\Loveevo.Core\\Loveevo.Core.csproj","label":"src/Loveevo.Core/Loveevo.Core.csproj","kind":"read","tool":"Read","selfTokens":84,"reads":1,"trips":4,"billed":36,"perRead":36,"share":0.0000013580747964227622}],"byAttr":[{"attr":"tool_use|Write","tokens":4358665,"share":0.16487145497407585},{"attr":"attachment","tokens":3397134,"share":0.12850046383818378},{"attr":"tool_result|Bash","tokens":3198402,"share":0.12098320162359802},{"attr":"assistant_thinking","tokens":2503344,"share":0.09469181276049918},{"attr":"tool_result|Read","tokens":2264747,"share":0.085666628932359},{"attr":"tool_result|WebFetch","tokens":2041007,"share":0.07720339583997063},{"attr":"tool_result|Grep","tokens":1879273,"share":0.07108565277585478},{"attr":"tool_use|AskUserQuestion","tokens":1483665,"share":0.05612131186798022},{"attr":"tool_use|Edit","tokens":1342847,"share":0.050794726578988404},{"attr":"assistant_text","tokens":1030638,"share":0.038985044178122936},{"attr":"user_input","tokens":643068,"share":0.024324774446308643},{"attr":"tool_result|Edit","tokens":409225,"share":0.015479410052501847},{"attr":"tool_use|Bash","tokens":378515,"share":0.014317765070104451},{"attr":"tool_result|AskUserQuestion","tokens":354576,"share":0.013412221143729941},{"attr":"tool_result|mcp_list","tokens":190121,"share":0.007191558408344424},{"attr":"tool_result|mcp_get","tokens":182894,"share":0.0069181712701779},{"attr":"tool_result|Write","tokens":172534,"share":0.006526290748057601},{"attr":"tool_result|mcp_call","tokens":135003,"share":0.005106635959880835},{"attr":"tool_use|Read","tokens":106836,"share":0.004041204410976068},{"attr":"tool_use|Grep","tokens":69009,"share":0.0026103439152562803},{"attr":"tool_use|TaskCreate","tokens":52087,"share":0.0019702586730387813},{"attr":"tool_use|mcp_call","tokens":40613,"share":0.0015362191988212135},{"attr":"tool_use|Skill","tokens":38406,"share":0.0014527644110258918},{"attr":"tool_result|TaskStop","tokens":35353,"share":0.0013372708044111959},{"attr":"tool_use|ImageGen","tokens":22248,"share":0.000841551232344651},{"attr":"tool_use|WebFetch","tokens":17673,"share":0.0006685188601362561},{"attr":"tool_use|Agent","tokens":15880,"share":0.00060069699095791},{"attr":"tool_use|Glob","tokens":14068,"share":0.0005321205615978009},{"attr":"tool_result|TaskCreate","tokens":12462,"share":0.0004713889909326432},{"attr":"tool_result|Agent","tokens":12182,"share":0.00046078734745389583},{"attr":"tool_result|Glob","tokens":9985,"share":0.0003777036650323209},{"attr":"tool_result|Skill","tokens":4687,"share":0.00017730606105471728},{"attr":"tool_use|mcp_list","tokens":4502,"share":0.0001702937797912236},{"attr":"tool_use|mcp_get","tokens":4329,"share":0.00016373593041287628},{"attr":"tool_result|ImageGen","tokens":3328,"share":0.00012587304757291756},{"attr":"tool_use|TaskUpdate","tokens":3326,"share":0.00012582183178146985},{"attr":"tool_result|TaskUpdate","tokens":2218,"share":0.00008388122118764663},{"attr":"tool_use|TaskStop","tokens":1897,"share":0.00007174616270125842},{"attr":"system","tokens":0,"share":0}],"byRequest":[{"index":1,"time":"11:37","ratio":0.029849,"inputTokens":5970,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.402,"originalCredits":9.402,"afterCompact":false},{"index":2,"time":"11:37","ratio":0.030254,"inputTokens":6051,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.2,"originalCredits":1.2,"afterCompact":false},{"index":3,"time":"11:38","ratio":0.030453,"inputTokens":6091,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.309,"originalCredits":1.309,"afterCompact":false},{"index":4,"time":"11:38","ratio":0.030833,"inputTokens":6167,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.418,"originalCredits":1.418,"afterCompact":false},{"index":5,"time":"11:40","ratio":0.031205,"inputTokens":6241,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.402,"originalCredits":1.402,"afterCompact":false},{"index":6,"time":"11:40","ratio":0.031588,"inputTokens":6318,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.032,"originalCredits":10.032,"afterCompact":false},{"index":7,"time":"11:41","ratio":0.031865,"inputTokens":6373,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.361,"originalCredits":9.361,"afterCompact":false},{"index":8,"time":"11:41","ratio":0.032177,"inputTokens":6435,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.467,"originalCredits":1.467,"afterCompact":false},{"index":9,"time":"11:41","ratio":0.032522,"inputTokens":6504,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.645,"originalCredits":1.645,"afterCompact":false},{"index":10,"time":"11:42","ratio":0.032804,"inputTokens":6561,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.633,"originalCredits":1.633,"afterCompact":false},{"index":11,"time":"11:42","ratio":0.033286,"inputTokens":6657,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.517,"originalCredits":1.517,"afterCompact":false},{"index":12,"time":"11:42","ratio":0.033635,"inputTokens":6727,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.331,"originalCredits":1.331,"afterCompact":false},{"index":13,"time":"11:42","ratio":0.039076,"inputTokens":7815,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.044,"originalCredits":3.044,"afterCompact":false},{"index":14,"time":"11:43","ratio":0.039441,"inputTokens":7888,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.65,"originalCredits":1.65,"afterCompact":false},{"index":15,"time":"11:44","ratio":0.039803,"inputTokens":7961,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.614,"originalCredits":12.614,"afterCompact":false},{"index":16,"time":"11:44","ratio":0.040116,"inputTokens":8023,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.669,"originalCredits":1.669,"afterCompact":false},{"index":17,"time":"11:45","ratio":0.04042,"inputTokens":8084,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.612,"originalCredits":1.612,"afterCompact":false},{"index":18,"time":"11:45","ratio":0.040715,"inputTokens":8143,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.776,"originalCredits":1.776,"afterCompact":false},{"index":19,"time":"11:45","ratio":0.041008,"inputTokens":8202,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.571,"originalCredits":1.571,"afterCompact":false},{"index":20,"time":"11:45","ratio":0.041295,"inputTokens":8259,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.641,"originalCredits":1.641,"afterCompact":false},{"index":21,"time":"11:46","ratio":0.041642,"inputTokens":8328,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.608,"originalCredits":1.608,"afterCompact":false},{"index":22,"time":"11:46","ratio":0.04191,"inputTokens":8382,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.646,"originalCredits":1.646,"afterCompact":false},{"index":23,"time":"11:46","ratio":0.042204,"inputTokens":8441,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.749,"originalCredits":1.749,"afterCompact":false},{"index":24,"time":"11:47","ratio":0.042589,"inputTokens":8518,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.756,"originalCredits":1.756,"afterCompact":false},{"index":25,"time":"11:47","ratio":0.04293,"inputTokens":8586,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.335,"originalCredits":2.335,"afterCompact":false},{"index":26,"time":"11:48","ratio":0.043477,"inputTokens":8695,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.96,"originalCredits":12.96,"afterCompact":false},{"index":27,"time":"11:48","ratio":0.043776,"inputTokens":8755,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.695,"originalCredits":1.695,"afterCompact":false},{"index":28,"time":"11:49","ratio":0.044102,"inputTokens":8820,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.69,"originalCredits":1.69,"afterCompact":false},{"index":29,"time":"11:49","ratio":0.044388,"inputTokens":8878,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.684,"originalCredits":1.684,"afterCompact":false},{"index":30,"time":"11:49","ratio":0.044684,"inputTokens":8937,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.671,"originalCredits":1.671,"afterCompact":false},{"index":31,"time":"11:50","ratio":0.044943,"inputTokens":8989,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.68,"originalCredits":1.68,"afterCompact":false},{"index":32,"time":"11:50","ratio":0.045221,"inputTokens":9044,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.715,"originalCredits":1.715,"afterCompact":false},{"index":33,"time":"11:50","ratio":0.045523,"inputTokens":9105,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.726,"originalCredits":1.726,"afterCompact":false},{"index":34,"time":"11:51","ratio":0.045811,"inputTokens":9162,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.738,"originalCredits":1.738,"afterCompact":false},{"index":35,"time":"11:51","ratio":0.04611,"inputTokens":9222,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.764,"originalCredits":1.764,"afterCompact":false},{"index":36,"time":"11:51","ratio":0.046423,"inputTokens":9285,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.769,"originalCredits":1.769,"afterCompact":false},{"index":37,"time":"11:51","ratio":0.046731,"inputTokens":9346,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.826,"originalCredits":1.826,"afterCompact":false},{"index":38,"time":"11:52","ratio":0.047096,"inputTokens":9419,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.83,"originalCredits":1.83,"afterCompact":false},{"index":39,"time":"11:52","ratio":0.047435,"inputTokens":9487,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.838,"originalCredits":1.838,"afterCompact":false},{"index":40,"time":"11:52","ratio":0.048999,"inputTokens":9800,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.232,"originalCredits":2.232,"afterCompact":false},{"index":41,"time":"11:52","ratio":0.049351,"inputTokens":9870,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.903,"originalCredits":1.903,"afterCompact":false},{"index":42,"time":"11:53","ratio":0.049686,"inputTokens":9937,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.928,"originalCredits":1.928,"afterCompact":false},{"index":43,"time":"11:54","ratio":0.050055,"inputTokens":10011,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.894,"originalCredits":1.894,"afterCompact":false},{"index":44,"time":"11:55","ratio":0.050248,"inputTokens":10050,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.901,"originalCredits":3.901,"afterCompact":false},{"index":45,"time":"11:55","ratio":0.050565,"inputTokens":10113,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.061,"originalCredits":4.061,"afterCompact":false},{"index":46,"time":"11:55","ratio":0.050873,"inputTokens":10175,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.961,"originalCredits":1.961,"afterCompact":false},{"index":47,"time":"11:55","ratio":0.051209,"inputTokens":10242,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.004,"originalCredits":2.004,"afterCompact":false},{"index":48,"time":"11:56","ratio":0.051554,"inputTokens":10311,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.914,"originalCredits":1.914,"afterCompact":false},{"index":49,"time":"11:56","ratio":0.051841,"inputTokens":10368,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.015,"originalCredits":2.015,"afterCompact":false},{"index":50,"time":"11:56","ratio":0.052222,"inputTokens":10444,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.068,"originalCredits":2.068,"afterCompact":false},{"index":51,"time":"11:56","ratio":0.052614,"inputTokens":10523,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.042,"originalCredits":2.042,"afterCompact":false},{"index":52,"time":"11:56","ratio":0.052916,"inputTokens":10583,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.99,"originalCredits":1.99,"afterCompact":false},{"index":53,"time":"11:57","ratio":0.053212,"inputTokens":10642,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.72,"originalCredits":2.72,"afterCompact":false},{"index":54,"time":"11:57","ratio":0.053499,"inputTokens":10700,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.039,"originalCredits":2.039,"afterCompact":false},{"index":55,"time":"11:57","ratio":0.053811,"inputTokens":10762,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.289,"originalCredits":2.289,"afterCompact":false},{"index":56,"time":"11:57","ratio":0.074791,"inputTokens":14958,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.34,"originalCredits":8.34,"afterCompact":false},{"index":57,"time":"11:57","ratio":0.076012,"inputTokens":15202,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.984,"originalCredits":2.984,"afterCompact":false},{"index":58,"time":"11:58","ratio":0.076362,"inputTokens":15272,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.864,"originalCredits":2.864,"afterCompact":false},{"index":59,"time":"11:58","ratio":0.07678,"inputTokens":15356,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.756,"originalCredits":2.756,"afterCompact":false},{"index":60,"time":"11:59","ratio":0.077082,"inputTokens":15416,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.782,"originalCredits":2.782,"afterCompact":false},{"index":61,"time":"11:59","ratio":0.077406,"inputTokens":15481,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.737,"originalCredits":2.737,"afterCompact":false},{"index":62,"time":"12:00","ratio":0.077712,"inputTokens":15542,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.75,"originalCredits":2.75,"afterCompact":false},{"index":63,"time":"12:00","ratio":0.078005,"inputTokens":15601,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.87,"originalCredits":2.87,"afterCompact":false},{"index":64,"time":"12:00","ratio":0.078415,"inputTokens":15683,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.835,"originalCredits":2.835,"afterCompact":false},{"index":65,"time":"12:01","ratio":0.07872,"inputTokens":15744,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.779,"originalCredits":2.779,"afterCompact":false},{"index":66,"time":"12:01","ratio":0.079019,"inputTokens":15804,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.814,"originalCredits":2.814,"afterCompact":false},{"index":67,"time":"12:02","ratio":0.079334,"inputTokens":15867,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.029,"originalCredits":3.029,"afterCompact":false},{"index":68,"time":"12:03","ratio":0.079863,"inputTokens":15973,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.752,"originalCredits":3.752,"afterCompact":false},{"index":69,"time":"12:03","ratio":0.0811,"inputTokens":16220,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.289,"originalCredits":3.289,"afterCompact":false},{"index":70,"time":"12:03","ratio":0.081941,"inputTokens":16388,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.965,"originalCredits":2.965,"afterCompact":false},{"index":71,"time":"12:03","ratio":0.087706,"inputTokens":17541,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.407,"originalCredits":4.407,"afterCompact":false},{"index":72,"time":"12:03","ratio":0.088269,"inputTokens":17654,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.011,"originalCredits":3.011,"afterCompact":false},{"index":73,"time":"12:03","ratio":0.089581,"inputTokens":17916,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.283,"originalCredits":3.283,"afterCompact":false},{"index":74,"time":"12:04","ratio":0.090141,"inputTokens":18028,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.11,"originalCredits":3.11,"afterCompact":false},{"index":75,"time":"12:04","ratio":0.090988,"inputTokens":18198,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.181,"originalCredits":3.181,"afterCompact":false},{"index":76,"time":"12:04","ratio":0.091153,"inputTokens":18231,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.42,"originalCredits":3.42,"afterCompact":false},{"index":77,"time":"12:04","ratio":0.091828,"inputTokens":18366,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.158,"originalCredits":3.158,"afterCompact":false},{"index":78,"time":"12:04","ratio":0.091968,"inputTokens":18394,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.013,"originalCredits":3.013,"afterCompact":false},{"index":79,"time":"12:04","ratio":0.093691,"inputTokens":18738,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.683,"originalCredits":3.683,"afterCompact":false},{"index":80,"time":"12:05","ratio":0.094442,"inputTokens":18888,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.378,"originalCredits":3.378,"afterCompact":false},{"index":81,"time":"12:05","ratio":0.094805,"inputTokens":18961,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.303,"originalCredits":3.303,"afterCompact":false},{"index":82,"time":"12:05","ratio":0.095613,"inputTokens":19123,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.494,"originalCredits":3.494,"afterCompact":false},{"index":83,"time":"12:05","ratio":0.097217,"inputTokens":19443,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.735,"originalCredits":4.735,"afterCompact":false},{"index":84,"time":"12:05","ratio":0.100003,"inputTokens":20001,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.024,"originalCredits":4.024,"afterCompact":false},{"index":85,"time":"12:05","ratio":0.101558,"inputTokens":20312,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.849,"originalCredits":3.849,"afterCompact":false},{"index":86,"time":"12:06","ratio":0.101854,"inputTokens":20371,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.415,"originalCredits":3.415,"afterCompact":false},{"index":87,"time":"12:06","ratio":0.102002,"inputTokens":20400,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.333,"originalCredits":3.333,"afterCompact":false},{"index":88,"time":"12:06","ratio":0.102923,"inputTokens":20585,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.758,"originalCredits":3.758,"afterCompact":false},{"index":89,"time":"12:06","ratio":0.103435,"inputTokens":20687,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.168,"originalCredits":4.168,"afterCompact":false},{"index":90,"time":"12:06","ratio":0.104404,"inputTokens":20881,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.206,"originalCredits":4.206,"afterCompact":false},{"index":91,"time":"12:07","ratio":0.105239,"inputTokens":21048,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.646,"originalCredits":3.646,"afterCompact":false},{"index":92,"time":"12:07","ratio":0.105392,"inputTokens":21078,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.954,"originalCredits":3.954,"afterCompact":false},{"index":93,"time":"12:07","ratio":0.106163,"inputTokens":21233,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.716,"originalCredits":5.716,"afterCompact":false},{"index":94,"time":"12:07","ratio":0.108646,"inputTokens":21729,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.325,"originalCredits":4.325,"afterCompact":false},{"index":95,"time":"12:07","ratio":0.10894,"inputTokens":21788,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.598,"originalCredits":3.598,"afterCompact":false},{"index":96,"time":"12:08","ratio":0.109121,"inputTokens":21824,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.654,"originalCredits":3.654,"afterCompact":false},{"index":97,"time":"12:08","ratio":0.109382,"inputTokens":21876,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.617,"originalCredits":3.617,"afterCompact":false},{"index":98,"time":"12:09","ratio":0.10959,"inputTokens":21918,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.891,"originalCredits":6.891,"afterCompact":false},{"index":99,"time":"12:09","ratio":0.113679,"inputTokens":22736,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.737,"originalCredits":5.737,"afterCompact":false},{"index":100,"time":"12:09","ratio":0.114925,"inputTokens":22985,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.168,"originalCredits":6.168,"afterCompact":false},{"index":101,"time":"12:09","ratio":0.117511,"inputTokens":23502,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.992,"originalCredits":4.992,"afterCompact":false},{"index":102,"time":"12:10","ratio":0.11819,"inputTokens":23638,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.999,"originalCredits":3.999,"afterCompact":false},{"index":103,"time":"12:10","ratio":0.118805,"inputTokens":23761,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.045,"originalCredits":4.045,"afterCompact":false},{"index":104,"time":"12:10","ratio":0.11902,"inputTokens":23804,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.281,"originalCredits":4.281,"afterCompact":false},{"index":105,"time":"12:10","ratio":0.121441,"inputTokens":24288,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.763,"originalCredits":4.763,"afterCompact":false},{"index":106,"time":"12:10","ratio":0.122714,"inputTokens":24543,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.351,"originalCredits":4.351,"afterCompact":false},{"index":107,"time":"12:10","ratio":0.122938,"inputTokens":24588,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.064,"originalCredits":4.064,"afterCompact":false},{"index":108,"time":"12:10","ratio":0.126897,"inputTokens":25379,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.207,"originalCredits":5.207,"afterCompact":false},{"index":109,"time":"12:11","ratio":0.128088,"inputTokens":25618,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.612,"originalCredits":4.612,"afterCompact":false},{"index":110,"time":"12:11","ratio":0.128475,"inputTokens":25695,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.335,"originalCredits":4.335,"afterCompact":false},{"index":111,"time":"12:11","ratio":0.13514,"inputTokens":27028,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.266,"originalCredits":6.266,"afterCompact":false},{"index":112,"time":"12:11","ratio":0.136312,"inputTokens":27262,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.896,"originalCredits":4.896,"afterCompact":false},{"index":113,"time":"12:11","ratio":0.14033,"inputTokens":28066,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.584,"originalCredits":5.584,"afterCompact":false},{"index":114,"time":"12:11","ratio":0.140455,"inputTokens":28091,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.468,"originalCredits":4.468,"afterCompact":false},{"index":115,"time":"12:11","ratio":0.14106,"inputTokens":28212,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.112,"originalCredits":5.112,"afterCompact":false},{"index":116,"time":"12:12","ratio":0.1424,"inputTokens":28480,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.244,"originalCredits":5.244,"afterCompact":false},{"index":117,"time":"12:12","ratio":0.144006,"inputTokens":28801,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.081,"originalCredits":5.081,"afterCompact":false},{"index":118,"time":"12:12","ratio":0.149435,"inputTokens":29887,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.266,"originalCredits":6.266,"afterCompact":false},{"index":119,"time":"12:12","ratio":0.149535,"inputTokens":29907,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.782,"originalCredits":4.782,"afterCompact":false},{"index":120,"time":"12:12","ratio":0.150004,"inputTokens":30001,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.885,"originalCredits":5.885,"afterCompact":false},{"index":121,"time":"12:12","ratio":0.151286,"inputTokens":30257,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.56,"originalCredits":5.56,"afterCompact":false},{"index":122,"time":"12:12","ratio":0.151831,"inputTokens":30366,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.36,"originalCredits":5.36,"afterCompact":false},{"index":123,"time":"12:13","ratio":0.152555,"inputTokens":30511,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.337,"originalCredits":7.337,"afterCompact":false},{"index":124,"time":"12:13","ratio":0.155301,"inputTokens":31060,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.161,"originalCredits":7.161,"afterCompact":false},{"index":125,"time":"12:14","ratio":0.15705,"inputTokens":31410,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.155,"originalCredits":6.155,"afterCompact":false},{"index":126,"time":"12:14","ratio":0.157947,"inputTokens":31589,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.627,"originalCredits":7.627,"afterCompact":false},{"index":127,"time":"12:14","ratio":0.160746,"inputTokens":32149,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.07,"originalCredits":6.07,"afterCompact":false},{"index":128,"time":"12:14","ratio":0.16106,"inputTokens":32212,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.299,"originalCredits":5.299,"afterCompact":false},{"index":129,"time":"12:14","ratio":0.161283,"inputTokens":32257,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.225,"originalCredits":5.225,"afterCompact":false},{"index":130,"time":"12:14","ratio":0.161506,"inputTokens":32301,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.189,"originalCredits":5.189,"afterCompact":false},{"index":131,"time":"12:15","ratio":0.161691,"inputTokens":32338,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.28,"originalCredits":5.28,"afterCompact":false},{"index":132,"time":"12:15","ratio":0.161914,"inputTokens":32383,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.297,"originalCredits":5.297,"afterCompact":false},{"index":133,"time":"12:15","ratio":0.16235,"inputTokens":32470,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.955,"originalCredits":5.955,"afterCompact":false},{"index":134,"time":"12:15","ratio":0.163259,"inputTokens":32652,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.748,"originalCredits":5.748,"afterCompact":false},{"index":135,"time":"12:15","ratio":0.163778,"inputTokens":32756,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.468,"originalCredits":5.468,"afterCompact":false},{"index":136,"time":"12:15","ratio":0.164044,"inputTokens":32809,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.41,"originalCredits":5.41,"afterCompact":false},{"index":137,"time":"12:16","ratio":0.164311,"inputTokens":32862,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.824,"originalCredits":6.824,"afterCompact":false},{"index":138,"time":"12:16","ratio":0.166156,"inputTokens":33231,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.072,"originalCredits":7.072,"afterCompact":false},{"index":139,"time":"12:16","ratio":0.167715,"inputTokens":33543,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.338,"originalCredits":6.338,"afterCompact":false},{"index":140,"time":"12:16","ratio":0.168548,"inputTokens":33710,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.07,"originalCredits":7.07,"afterCompact":false},{"index":141,"time":"12:17","ratio":0.170397,"inputTokens":34079,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.275,"originalCredits":6.275,"afterCompact":false},{"index":142,"time":"12:17","ratio":0.17095,"inputTokens":34190,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.891,"originalCredits":7.891,"afterCompact":false},{"index":143,"time":"12:18","ratio":0.173879,"inputTokens":34776,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.761,"originalCredits":8.761,"afterCompact":false},{"index":144,"time":"12:18","ratio":0.176734,"inputTokens":35347,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.45,"originalCredits":6.45,"afterCompact":false},{"index":145,"time":"12:18","ratio":0.176962,"inputTokens":35392,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.713,"originalCredits":5.713,"afterCompact":false},{"index":146,"time":"12:18","ratio":0.177168,"inputTokens":35434,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.939,"originalCredits":5.939,"afterCompact":false},{"index":147,"time":"12:18","ratio":0.177633,"inputTokens":35527,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.511,"originalCredits":6.511,"afterCompact":false},{"index":148,"time":"12:18","ratio":0.178657,"inputTokens":35731,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.072,"originalCredits":6.072,"afterCompact":false},{"index":149,"time":"12:19","ratio":0.178913,"inputTokens":35783,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.244,"originalCredits":6.244,"afterCompact":false},{"index":150,"time":"12:19","ratio":0.179592,"inputTokens":35918,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.014,"originalCredits":7.014,"afterCompact":false},{"index":151,"time":"12:19","ratio":0.18098,"inputTokens":36196,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.249,"originalCredits":6.249,"afterCompact":false},{"index":152,"time":"12:19","ratio":0.181459,"inputTokens":36292,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.956,"originalCredits":5.956,"afterCompact":false},{"index":153,"time":"12:19","ratio":0.181652,"inputTokens":36330,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.959,"originalCredits":5.959,"afterCompact":false},{"index":154,"time":"12:19","ratio":0.181942,"inputTokens":36388,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.264,"originalCredits":6.264,"afterCompact":false},{"index":155,"time":"12:20","ratio":0.182552,"inputTokens":36510,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.969,"originalCredits":5.969,"afterCompact":false},{"index":156,"time":"12:20","ratio":0.182703,"inputTokens":36541,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.331,"originalCredits":6.331,"afterCompact":false},{"index":157,"time":"12:20","ratio":0.183445,"inputTokens":36689,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.15,"originalCredits":6.15,"afterCompact":false},{"index":158,"time":"12:20","ratio":0.183727,"inputTokens":36745,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.986,"originalCredits":5.986,"afterCompact":false},{"index":159,"time":"12:20","ratio":0.183967,"inputTokens":36793,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.176,"originalCredits":6.176,"afterCompact":false},{"index":160,"time":"12:20","ratio":0.184417,"inputTokens":36883,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.087,"originalCredits":6.087,"afterCompact":false},{"index":161,"time":"12:20","ratio":0.18469,"inputTokens":36938,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.002,"originalCredits":6.002,"afterCompact":false},{"index":162,"time":"12:20","ratio":0.185123,"inputTokens":37025,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.035,"originalCredits":6.035,"afterCompact":false},{"index":163,"time":"12:21","ratio":0.185333,"inputTokens":37067,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.957,"originalCredits":5.957,"afterCompact":false},{"index":164,"time":"12:21","ratio":0.185543,"inputTokens":37109,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.098,"originalCredits":6.098,"afterCompact":false},{"index":165,"time":"12:21","ratio":0.185831,"inputTokens":37166,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.003,"originalCredits":6.003,"afterCompact":false},{"index":166,"time":"12:21","ratio":0.188659,"inputTokens":37732,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.997,"originalCredits":6.997,"afterCompact":false},{"index":167,"time":"12:21","ratio":0.189036,"inputTokens":37807,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.259,"originalCredits":6.259,"afterCompact":false},{"index":168,"time":"12:21","ratio":0.189338,"inputTokens":37868,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.212,"originalCredits":6.212,"afterCompact":false},{"index":169,"time":"12:21","ratio":0.189642,"inputTokens":37928,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.122,"originalCredits":6.122,"afterCompact":false},{"index":170,"time":"12:21","ratio":0.189819,"inputTokens":37964,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.101,"originalCredits":6.101,"afterCompact":false},{"index":171,"time":"12:21","ratio":0.189991,"inputTokens":37998,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.116,"originalCredits":6.116,"afterCompact":false},{"index":172,"time":"12:22","ratio":0.19039,"inputTokens":38078,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.168,"originalCredits":6.168,"afterCompact":false},{"index":173,"time":"12:22","ratio":0.190598,"inputTokens":38120,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.113,"originalCredits":6.113,"afterCompact":false},{"index":174,"time":"12:22","ratio":0.195634,"inputTokens":39127,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.786,"originalCredits":7.786,"afterCompact":false},{"index":175,"time":"12:22","ratio":0.197464,"inputTokens":39493,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.725,"originalCredits":6.725,"afterCompact":false},{"index":176,"time":"12:22","ratio":0.198091,"inputTokens":39618,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.536,"originalCredits":6.536,"afterCompact":false},{"index":177,"time":"12:22","ratio":0.198356,"inputTokens":39671,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.4,"originalCredits":6.4,"afterCompact":false},{"index":178,"time":"12:22","ratio":0.198537,"inputTokens":39707,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.041,"originalCredits":7.041,"afterCompact":false},{"index":179,"time":"12:23","ratio":0.199452,"inputTokens":39890,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.764,"originalCredits":6.764,"afterCompact":false},{"index":180,"time":"12:23","ratio":0.199823,"inputTokens":39965,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.427,"originalCredits":6.427,"afterCompact":false},{"index":181,"time":"12:23","ratio":0.200006,"inputTokens":40001,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.424,"originalCredits":6.424,"afterCompact":false},{"index":182,"time":"12:23","ratio":0.200393,"inputTokens":40079,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.667,"originalCredits":6.667,"afterCompact":false},{"index":183,"time":"12:23","ratio":0.200844,"inputTokens":40169,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.514,"originalCredits":6.514,"afterCompact":false},{"index":184,"time":"12:23","ratio":0.201284,"inputTokens":40257,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.739,"originalCredits":6.739,"afterCompact":false},{"index":185,"time":"12:23","ratio":0.201694,"inputTokens":40339,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.508,"originalCredits":6.508,"afterCompact":false},{"index":186,"time":"12:23","ratio":0.201861,"inputTokens":40372,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.476,"originalCredits":6.476,"afterCompact":false},{"index":187,"time":"12:23","ratio":0.202045,"inputTokens":40409,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.617,"originalCredits":6.617,"afterCompact":false},{"index":188,"time":"12:23","ratio":0.202374,"inputTokens":40475,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.61,"originalCredits":6.61,"afterCompact":false},{"index":189,"time":"12:24","ratio":0.20266,"inputTokens":40532,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.524,"originalCredits":6.524,"afterCompact":false},{"index":190,"time":"12:24","ratio":0.202846,"inputTokens":40569,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.617,"originalCredits":6.617,"afterCompact":false},{"index":191,"time":"12:24","ratio":0.203152,"inputTokens":40630,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.614,"originalCredits":6.614,"afterCompact":false},{"index":192,"time":"12:24","ratio":0.203619,"inputTokens":40724,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.624,"originalCredits":6.624,"afterCompact":false},{"index":193,"time":"12:24","ratio":0.203942,"inputTokens":40788,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.61,"originalCredits":6.61,"afterCompact":false},{"index":194,"time":"12:24","ratio":0.204163,"inputTokens":40833,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.565,"originalCredits":6.565,"afterCompact":false},{"index":195,"time":"12:24","ratio":0.204326,"inputTokens":40865,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.526,"originalCredits":6.526,"afterCompact":false},{"index":196,"time":"12:24","ratio":0.204574,"inputTokens":40915,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.555,"originalCredits":6.555,"afterCompact":false},{"index":197,"time":"12:24","ratio":0.20524,"inputTokens":41048,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.68,"originalCredits":6.68,"afterCompact":false},{"index":198,"time":"12:24","ratio":0.205424,"inputTokens":41085,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.567,"originalCredits":6.567,"afterCompact":false},{"index":199,"time":"12:25","ratio":0.207607,"inputTokens":41521,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.199,"originalCredits":7.199,"afterCompact":false},{"index":200,"time":"12:25","ratio":0.207788,"inputTokens":41558,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.654,"originalCredits":6.654,"afterCompact":false},{"index":201,"time":"12:27","ratio":0.208054,"inputTokens":41611,"outputTokens":null,"usageSource":"transcript-ratio","credits":17.875,"originalCredits":17.875,"afterCompact":false},{"index":202,"time":"12:27","ratio":0.221005,"inputTokens":44201,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.347,"originalCredits":11.347,"afterCompact":false},{"index":203,"time":"12:27","ratio":0.221967,"inputTokens":44393,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.534,"originalCredits":7.534,"afterCompact":false},{"index":204,"time":"12:27","ratio":0.222366,"inputTokens":44473,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.423,"originalCredits":7.423,"afterCompact":false},{"index":205,"time":"12:27","ratio":0.222825,"inputTokens":44565,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.37,"originalCredits":7.37,"afterCompact":false},{"index":206,"time":"12:28","ratio":0.223192,"inputTokens":44638,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.236,"originalCredits":7.236,"afterCompact":false},{"index":207,"time":"12:28","ratio":0.223442,"inputTokens":44688,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.316,"originalCredits":7.316,"afterCompact":false},{"index":208,"time":"12:28","ratio":0.223778,"inputTokens":44756,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.359,"originalCredits":7.359,"afterCompact":false},{"index":209,"time":"12:28","ratio":0.224147,"inputTokens":44829,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.156,"originalCredits":7.156,"afterCompact":false},{"index":210,"time":"12:28","ratio":0.224412,"inputTokens":44882,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.34,"originalCredits":7.34,"afterCompact":false},{"index":211,"time":"12:28","ratio":0.224742,"inputTokens":44948,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.262,"originalCredits":7.262,"afterCompact":false},{"index":212,"time":"12:28","ratio":0.228939,"inputTokens":45788,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.491,"originalCredits":8.491,"afterCompact":false},{"index":213,"time":"12:28","ratio":0.229208,"inputTokens":45842,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.269,"originalCredits":7.269,"afterCompact":false},{"index":214,"time":"12:28","ratio":0.229686,"inputTokens":45937,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.404,"originalCredits":7.404,"afterCompact":false},{"index":215,"time":"12:28","ratio":0.229833,"inputTokens":45967,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.297,"originalCredits":7.297,"afterCompact":false},{"index":216,"time":"12:29","ratio":0.230013,"inputTokens":46003,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.297,"originalCredits":7.297,"afterCompact":false},{"index":217,"time":"12:29","ratio":0.230227,"inputTokens":46045,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.333,"originalCredits":7.333,"afterCompact":false},{"index":218,"time":"12:29","ratio":0.230391,"inputTokens":46078,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.333,"originalCredits":7.333,"afterCompact":false},{"index":219,"time":"12:30","ratio":0.230654,"inputTokens":46131,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.405,"originalCredits":7.405,"afterCompact":false},{"index":220,"time":"12:31","ratio":0.23083,"inputTokens":46166,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.39,"originalCredits":7.39,"afterCompact":false},{"index":221,"time":"12:31","ratio":0.231096,"inputTokens":46219,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.389,"originalCredits":7.389,"afterCompact":false},{"index":222,"time":"12:31","ratio":0.2314,"inputTokens":46280,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.397,"originalCredits":7.397,"afterCompact":false},{"index":223,"time":"12:31","ratio":0.231504,"inputTokens":46301,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.392,"originalCredits":7.392,"afterCompact":false},{"index":224,"time":"12:31","ratio":0.231689,"inputTokens":46338,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.53,"originalCredits":7.53,"afterCompact":false},{"index":225,"time":"12:31","ratio":0.231995,"inputTokens":46399,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.437,"originalCredits":7.437,"afterCompact":false},{"index":226,"time":"12:32","ratio":0.233184,"inputTokens":46637,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.661,"originalCredits":7.661,"afterCompact":false},{"index":227,"time":"12:32","ratio":0.233272,"inputTokens":46654,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.396,"originalCredits":7.396,"afterCompact":false},{"index":228,"time":"12:32","ratio":0.235523,"inputTokens":47105,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.163,"originalCredits":8.163,"afterCompact":false},{"index":229,"time":"12:32","ratio":0.235758,"inputTokens":47152,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.736,"originalCredits":7.736,"afterCompact":false},{"index":230,"time":"12:33","ratio":0.236355,"inputTokens":47271,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.672,"originalCredits":7.672,"afterCompact":false},{"index":231,"time":"12:33","ratio":0.237374,"inputTokens":47475,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.766,"originalCredits":7.766,"afterCompact":false},{"index":232,"time":"12:33","ratio":0.237873,"inputTokens":47575,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.652,"originalCredits":7.652,"afterCompact":false},{"index":233,"time":"12:43","ratio":0.238542,"inputTokens":47708,"outputTokens":null,"usageSource":"transcript-ratio","credits":74.326,"originalCredits":74.326,"afterCompact":false},{"index":234,"time":"12:43","ratio":0.238819,"inputTokens":47764,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.634,"originalCredits":7.634,"afterCompact":false},{"index":235,"time":"12:44","ratio":0.239023,"inputTokens":47805,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.744,"originalCredits":7.744,"afterCompact":false},{"index":236,"time":"12:44","ratio":0.239334,"inputTokens":47867,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.696,"originalCredits":7.696,"afterCompact":false},{"index":237,"time":"12:44","ratio":0.250257,"inputTokens":50051,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.239,"originalCredits":11.239,"afterCompact":false},{"index":238,"time":"12:44","ratio":0.252844,"inputTokens":50569,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.685,"originalCredits":8.685,"afterCompact":false},{"index":239,"time":"12:45","ratio":0.256712,"inputTokens":51342,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.021,"originalCredits":10.021,"afterCompact":false},{"index":240,"time":"12:45","ratio":0.257834,"inputTokens":51567,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.747,"originalCredits":8.747,"afterCompact":false},{"index":241,"time":"12:45","ratio":0.258552,"inputTokens":51710,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.826,"originalCredits":8.826,"afterCompact":false},{"index":242,"time":"12:46","ratio":0.25926,"inputTokens":51852,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.84,"originalCredits":8.84,"afterCompact":false},{"index":243,"time":"12:46","ratio":0.259957,"inputTokens":51991,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.591,"originalCredits":8.591,"afterCompact":false},{"index":244,"time":"12:46","ratio":0.260356,"inputTokens":52071,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.618,"originalCredits":8.618,"afterCompact":false},{"index":245,"time":"12:46","ratio":0.260863,"inputTokens":52173,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.386,"originalCredits":8.386,"afterCompact":false},{"index":246,"time":"12:47","ratio":0.262121,"inputTokens":52424,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.623,"originalCredits":8.623,"afterCompact":false},{"index":247,"time":"12:47","ratio":0.262302,"inputTokens":52460,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.285,"originalCredits":8.285,"afterCompact":false},{"index":248,"time":"12:48","ratio":0.263132,"inputTokens":52626,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.552,"originalCredits":8.552,"afterCompact":false},{"index":249,"time":"12:48","ratio":0.263705,"inputTokens":52741,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.482,"originalCredits":8.482,"afterCompact":false},{"index":250,"time":"12:48","ratio":0.267241,"inputTokens":53448,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.439,"originalCredits":9.439,"afterCompact":false},{"index":251,"time":"12:49","ratio":0.269351,"inputTokens":53870,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.13,"originalCredits":9.13,"afterCompact":false},{"index":252,"time":"12:49","ratio":0.271156,"inputTokens":54231,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.126,"originalCredits":9.126,"afterCompact":false},{"index":253,"time":"12:49","ratio":0.271422,"inputTokens":54284,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.623,"originalCredits":8.623,"afterCompact":false},{"index":254,"time":"12:50","ratio":0.271594,"inputTokens":54319,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.58,"originalCredits":8.58,"afterCompact":false},{"index":255,"time":"12:50","ratio":0.271983,"inputTokens":54397,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.153,"originalCredits":9.153,"afterCompact":false},{"index":256,"time":"12:50","ratio":0.272692,"inputTokens":54538,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.445,"originalCredits":9.445,"afterCompact":false},{"index":257,"time":"12:50","ratio":0.273605,"inputTokens":54721,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.848,"originalCredits":8.848,"afterCompact":false},{"index":258,"time":"12:51","ratio":0.274881,"inputTokens":54976,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.047,"originalCredits":9.047,"afterCompact":false},{"index":259,"time":"12:51","ratio":0.275843,"inputTokens":55169,"outputTokens":null,"usageSource":"transcript-ratio","credits":86.094,"originalCredits":86.094,"afterCompact":false},{"index":260,"time":"12:52","ratio":0.276512,"inputTokens":55302,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.905,"originalCredits":8.905,"afterCompact":false},{"index":261,"time":"12:52","ratio":0.276768,"inputTokens":55354,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.89,"originalCredits":8.89,"afterCompact":false},{"index":262,"time":"12:52","ratio":0.277601,"inputTokens":55520,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.032,"originalCredits":9.032,"afterCompact":false},{"index":263,"time":"12:52","ratio":0.277841,"inputTokens":55568,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.776,"originalCredits":8.776,"afterCompact":false},{"index":264,"time":"12:53","ratio":0.278228,"inputTokens":55646,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.884,"originalCredits":8.884,"afterCompact":false},{"index":265,"time":"12:53","ratio":0.278484,"inputTokens":55697,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.051,"originalCredits":9.051,"afterCompact":false},{"index":266,"time":"12:54","ratio":0.279058,"inputTokens":55812,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.936,"originalCredits":8.936,"afterCompact":false},{"index":267,"time":"12:54","ratio":0.279208,"inputTokens":55842,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.88,"originalCredits":8.88,"afterCompact":false},{"index":268,"time":"12:54","ratio":0.279498,"inputTokens":55900,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.037,"originalCredits":9.037,"afterCompact":false},{"index":269,"time":"12:54","ratio":0.279862,"inputTokens":55972,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.962,"originalCredits":8.962,"afterCompact":false},{"index":270,"time":"12:55","ratio":0.281566,"inputTokens":56313,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.339,"originalCredits":9.339,"afterCompact":false},{"index":271,"time":"12:55","ratio":0.282357,"inputTokens":56471,"outputTokens":null,"usageSource":"transcript-ratio","credits":87.959,"originalCredits":87.959,"afterCompact":false},{"index":272,"time":"12:55","ratio":0.282569,"inputTokens":56514,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.947,"originalCredits":8.947,"afterCompact":false},{"index":273,"time":"12:56","ratio":0.283293,"inputTokens":56659,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.148,"originalCredits":9.148,"afterCompact":false},{"index":274,"time":"12:57","ratio":0.283512,"inputTokens":56702,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.973,"originalCredits":8.973,"afterCompact":false},{"index":275,"time":"12:57","ratio":0.28422,"inputTokens":56844,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.217,"originalCredits":9.217,"afterCompact":false},{"index":276,"time":"12:57","ratio":0.284475,"inputTokens":56895,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.018,"originalCredits":9.018,"afterCompact":false},{"index":277,"time":"12:58","ratio":0.285203,"inputTokens":57041,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.299,"originalCredits":9.299,"afterCompact":false},{"index":278,"time":"12:58","ratio":0.28779,"inputTokens":57558,"outputTokens":null,"usageSource":"transcript-ratio","credits":89.775,"originalCredits":89.775,"afterCompact":false},{"index":279,"time":"12:58","ratio":0.288334,"inputTokens":57667,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.215,"originalCredits":9.215,"afterCompact":false},{"index":280,"time":"12:58","ratio":0.289216,"inputTokens":57843,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.546,"originalCredits":9.546,"afterCompact":false},{"index":281,"time":"12:59","ratio":0.289573,"inputTokens":57915,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.504,"originalCredits":9.504,"afterCompact":false},{"index":282,"time":"12:59","ratio":0.290071,"inputTokens":58014,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.257,"originalCredits":9.257,"afterCompact":false},{"index":283,"time":"12:59","ratio":0.291102,"inputTokens":58220,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.468,"originalCredits":9.468,"afterCompact":false},{"index":284,"time":"12:59","ratio":0.291305,"inputTokens":58261,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.225,"originalCredits":9.225,"afterCompact":false},{"index":285,"time":"13:00","ratio":0.291525,"inputTokens":58305,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.643,"originalCredits":9.643,"afterCompact":false},{"index":286,"time":"13:00","ratio":0.29216,"inputTokens":58432,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.398,"originalCredits":9.398,"afterCompact":false},{"index":287,"time":"13:00","ratio":0.292378,"inputTokens":58476,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.751,"originalCredits":10.751,"afterCompact":false},{"index":288,"time":"13:01","ratio":0.294223,"inputTokens":58845,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.8,"originalCredits":9.8,"afterCompact":false},{"index":289,"time":"13:02","ratio":0.29586,"inputTokens":59172,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.946,"originalCredits":9.946,"afterCompact":false},{"index":290,"time":"13:02","ratio":0.296248,"inputTokens":59250,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.432,"originalCredits":9.432,"afterCompact":false},{"index":291,"time":"13:02","ratio":0.296476,"inputTokens":59295,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.566,"originalCredits":9.566,"afterCompact":false},{"index":292,"time":"13:02","ratio":0.29682,"inputTokens":59364,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.514,"originalCredits":9.514,"afterCompact":false},{"index":293,"time":"13:03","ratio":0.297053,"inputTokens":59411,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.812,"originalCredits":9.812,"afterCompact":false},{"index":294,"time":"13:03","ratio":0.297675,"inputTokens":59535,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.531,"originalCredits":9.531,"afterCompact":false},{"index":295,"time":"13:04","ratio":0.30441,"inputTokens":60882,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.271,"originalCredits":12.271,"afterCompact":false},{"index":296,"time":"13:04","ratio":0.305509,"inputTokens":61102,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.063,"originalCredits":10.063,"afterCompact":false},{"index":297,"time":"13:04","ratio":0.305857,"inputTokens":61171,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.782,"originalCredits":9.782,"afterCompact":false},{"index":298,"time":"13:05","ratio":0.30611,"inputTokens":61222,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.789,"originalCredits":9.789,"afterCompact":false},{"index":299,"time":"13:05","ratio":0.306383,"inputTokens":61277,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.834,"originalCredits":9.834,"afterCompact":false},{"index":300,"time":"13:05","ratio":0.306882,"inputTokens":61376,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.733,"originalCredits":9.733,"afterCompact":false},{"index":301,"time":"13:05","ratio":0.307335,"inputTokens":61467,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.839,"originalCredits":9.839,"afterCompact":false},{"index":302,"time":"13:05","ratio":0.307609,"inputTokens":61522,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.778,"originalCredits":9.778,"afterCompact":false},{"index":303,"time":"13:06","ratio":0.30788,"inputTokens":61576,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.914,"originalCredits":9.914,"afterCompact":false},{"index":304,"time":"13:06","ratio":0.308215,"inputTokens":61643,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.8,"originalCredits":9.8,"afterCompact":false},{"index":305,"time":"13:07","ratio":0.311629,"inputTokens":62326,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.749,"originalCredits":10.749,"afterCompact":false},{"index":306,"time":"13:07","ratio":0.311845,"inputTokens":62369,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.487,"originalCredits":10.487,"afterCompact":false},{"index":307,"time":"13:07","ratio":0.312726,"inputTokens":62545,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.088,"originalCredits":10.088,"afterCompact":false},{"index":308,"time":"13:08","ratio":0.313471,"inputTokens":62694,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.245,"originalCredits":10.245,"afterCompact":false},{"index":309,"time":"13:08","ratio":0.313901,"inputTokens":62780,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.978,"originalCredits":9.978,"afterCompact":false},{"index":310,"time":"13:08","ratio":0.314452,"inputTokens":62890,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.045,"originalCredits":10.045,"afterCompact":false},{"index":311,"time":"13:08","ratio":0.314686,"inputTokens":62937,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.951,"originalCredits":9.951,"afterCompact":false},{"index":312,"time":"13:10","ratio":0.315277,"inputTokens":63055,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.172,"originalCredits":10.172,"afterCompact":false},{"index":313,"time":"13:10","ratio":0.315554,"inputTokens":63111,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.987,"originalCredits":9.987,"afterCompact":false},{"index":314,"time":"13:10","ratio":0.315739,"inputTokens":63148,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.72,"originalCredits":10.72,"afterCompact":false},{"index":315,"time":"13:11","ratio":0.316768,"inputTokens":63354,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.84,"originalCredits":10.84,"afterCompact":false},{"index":316,"time":"13:11","ratio":0.317607,"inputTokens":63521,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.196,"originalCredits":10.196,"afterCompact":false},{"index":317,"time":"13:11","ratio":0.317744,"inputTokens":63549,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.344,"originalCredits":10.344,"afterCompact":false},{"index":318,"time":"13:11","ratio":0.31833,"inputTokens":63666,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.319,"originalCredits":10.319,"afterCompact":false},{"index":319,"time":"13:11","ratio":0.318887,"inputTokens":63777,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.411,"originalCredits":10.411,"afterCompact":false},{"index":320,"time":"13:12","ratio":0.31949,"inputTokens":63898,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.596,"originalCredits":10.596,"afterCompact":false},{"index":321,"time":"13:12","ratio":0.320115,"inputTokens":64023,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.362,"originalCredits":10.362,"afterCompact":false},{"index":322,"time":"13:13","ratio":0.320999,"inputTokens":64200,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.642,"originalCredits":10.642,"afterCompact":false},{"index":323,"time":"13:13","ratio":0.321464,"inputTokens":64293,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.187,"originalCredits":10.187,"afterCompact":false},{"index":324,"time":"13:13","ratio":0.322208,"inputTokens":64442,"outputTokens":null,"usageSource":"transcript-ratio","credits":100.768,"originalCredits":100.768,"afterCompact":false},{"index":325,"time":"13:14","ratio":0.322882,"inputTokens":64576,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.248,"originalCredits":11.248,"afterCompact":false},{"index":326,"time":"13:14","ratio":0.324087,"inputTokens":64817,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.526,"originalCredits":10.526,"afterCompact":false},{"index":327,"time":"13:15","ratio":0.324268,"inputTokens":64854,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.276,"originalCredits":12.276,"afterCompact":false},{"index":328,"time":"13:15","ratio":0.32799,"inputTokens":65598,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.904,"originalCredits":12.904,"afterCompact":false},{"index":329,"time":"13:16","ratio":0.329912,"inputTokens":65982,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.924,"originalCredits":10.924,"afterCompact":false},{"index":330,"time":"13:16","ratio":0.330104,"inputTokens":66021,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.471,"originalCredits":10.471,"afterCompact":false},{"index":331,"time":"13:16","ratio":0.330324,"inputTokens":66065,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.733,"originalCredits":10.733,"afterCompact":false},{"index":332,"time":"13:16","ratio":0.33082,"inputTokens":66164,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.979,"originalCredits":10.979,"afterCompact":false},{"index":333,"time":"13:16","ratio":0.331503,"inputTokens":66301,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.754,"originalCredits":10.754,"afterCompact":false},{"index":334,"time":"13:17","ratio":0.331855,"inputTokens":66371,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.7,"originalCredits":10.7,"afterCompact":false},{"index":335,"time":"13:17","ratio":0.332222,"inputTokens":66444,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.391,"originalCredits":11.391,"afterCompact":false},{"index":336,"time":"13:18","ratio":0.333359,"inputTokens":66672,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.826,"originalCredits":12.826,"afterCompact":false},{"index":337,"time":"13:18","ratio":0.336005,"inputTokens":67201,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.343,"originalCredits":11.343,"afterCompact":false},{"index":338,"time":"13:18","ratio":0.336229,"inputTokens":67246,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.019,"originalCredits":11.019,"afterCompact":false},{"index":339,"time":"13:18","ratio":0.336856,"inputTokens":67371,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.101,"originalCredits":11.101,"afterCompact":false},{"index":340,"time":"13:19","ratio":0.337418,"inputTokens":67484,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.769,"originalCredits":10.769,"afterCompact":false},{"index":341,"time":"13:19","ratio":0.337609,"inputTokens":67522,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.687,"originalCredits":10.687,"afterCompact":false},{"index":342,"time":"13:19","ratio":0.337823,"inputTokens":67565,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.689,"originalCredits":10.689,"afterCompact":false},{"index":343,"time":"13:19","ratio":0.338027,"inputTokens":67605,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.728,"originalCredits":10.728,"afterCompact":false},{"index":344,"time":"13:20","ratio":0.338264,"inputTokens":67653,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.713,"originalCredits":10.713,"afterCompact":false},{"index":345,"time":"13:20","ratio":0.338459,"inputTokens":67692,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.722,"originalCredits":10.722,"afterCompact":false},{"index":346,"time":"13:20","ratio":0.338676,"inputTokens":67735,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.698,"originalCredits":10.698,"afterCompact":false},{"index":347,"time":"13:21","ratio":0.340218,"inputTokens":68044,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.9,"originalCredits":11.9,"afterCompact":false},{"index":348,"time":"13:21","ratio":0.341251,"inputTokens":68250,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.105,"originalCredits":11.105,"afterCompact":false},{"index":349,"time":"13:21","ratio":0.341512,"inputTokens":68302,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.506,"originalCredits":11.506,"afterCompact":false},{"index":350,"time":"13:22","ratio":0.342476,"inputTokens":68495,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.584,"originalCredits":11.584,"afterCompact":false},{"index":351,"time":"13:22","ratio":0.34327,"inputTokens":68654,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.169,"originalCredits":11.169,"afterCompact":false},{"index":352,"time":"13:22","ratio":0.343622,"inputTokens":68724,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.025,"originalCredits":11.025,"afterCompact":false},{"index":353,"time":"13:23","ratio":0.344258,"inputTokens":68852,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.888,"originalCredits":11.888,"afterCompact":false},{"index":354,"time":"13:24","ratio":0.345452,"inputTokens":69090,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.269,"originalCredits":11.269,"afterCompact":false},{"index":355,"time":"13:24","ratio":0.345713,"inputTokens":69143,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.497,"originalCredits":11.497,"afterCompact":false},{"index":356,"time":"13:24","ratio":0.346507,"inputTokens":69301,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.317,"originalCredits":11.317,"afterCompact":false},{"index":357,"time":"13:24","ratio":0.347095,"inputTokens":69419,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.104,"originalCredits":11.104,"afterCompact":false},{"index":358,"time":"13:25","ratio":0.347306,"inputTokens":69461,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.017,"originalCredits":11.017,"afterCompact":false},{"index":359,"time":"13:25","ratio":0.347543,"inputTokens":69509,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.033,"originalCredits":11.033,"afterCompact":false},{"index":360,"time":"13:26","ratio":0.347776,"inputTokens":69555,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.44,"originalCredits":11.44,"afterCompact":false},{"index":361,"time":"13:26","ratio":0.348466,"inputTokens":69693,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.166,"originalCredits":11.166,"afterCompact":false},{"index":362,"time":"13:26","ratio":0.348666,"inputTokens":69733,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.106,"originalCredits":11.106,"afterCompact":false},{"index":363,"time":"13:26","ratio":0.34895,"inputTokens":69790,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.115,"originalCredits":11.115,"afterCompact":false},{"index":364,"time":"13:27","ratio":0.349206,"inputTokens":69841,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.048,"originalCredits":11.048,"afterCompact":false},{"index":365,"time":"13:27","ratio":0.349398,"inputTokens":69880,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.075,"originalCredits":11.075,"afterCompact":false},{"index":366,"time":"13:27","ratio":0.349633,"inputTokens":69927,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.06,"originalCredits":11.06,"afterCompact":false},{"index":367,"time":"13:27","ratio":0.350023,"inputTokens":70005,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.122,"originalCredits":11.122,"afterCompact":false},{"index":368,"time":"13:27","ratio":0.350213,"inputTokens":70043,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.118,"originalCredits":11.118,"afterCompact":false},{"index":369,"time":"13:28","ratio":0.350473,"inputTokens":70095,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.09,"originalCredits":11.09,"afterCompact":false},{"index":370,"time":"13:28","ratio":0.352014,"inputTokens":70403,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.75,"originalCredits":11.75,"afterCompact":false},{"index":371,"time":"13:28","ratio":0.35248,"inputTokens":70496,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.438,"originalCredits":11.438,"afterCompact":false},{"index":372,"time":"13:28","ratio":0.352916,"inputTokens":70583,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.276,"originalCredits":11.276,"afterCompact":false},{"index":373,"time":"13:28","ratio":0.353158,"inputTokens":70632,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.329,"originalCredits":11.329,"afterCompact":false},{"index":374,"time":"13:29","ratio":0.353706,"inputTokens":70741,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.359,"originalCredits":11.359,"afterCompact":false},{"index":375,"time":"13:29","ratio":0.353987,"inputTokens":70797,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.199,"originalCredits":11.199,"afterCompact":false},{"index":376,"time":"13:29","ratio":0.354151,"inputTokens":70830,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.209,"originalCredits":11.209,"afterCompact":false},{"index":377,"time":"13:29","ratio":0.354562,"inputTokens":70912,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.283,"originalCredits":11.283,"afterCompact":false},{"index":378,"time":"13:29","ratio":0.355911,"inputTokens":71182,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.836,"originalCredits":11.836,"afterCompact":false},{"index":379,"time":"13:29","ratio":0.356396,"inputTokens":71279,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.419,"originalCredits":11.419,"afterCompact":false},{"index":380,"time":"13:30","ratio":0.35667,"inputTokens":71334,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.744,"originalCredits":11.744,"afterCompact":false},{"index":381,"time":"13:30","ratio":0.357367,"inputTokens":71473,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.446,"originalCredits":11.446,"afterCompact":false},{"index":382,"time":"13:30","ratio":0.357564,"inputTokens":71513,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.32,"originalCredits":11.32,"afterCompact":false},{"index":383,"time":"13:30","ratio":0.357761,"inputTokens":71552,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.314,"originalCredits":11.314,"afterCompact":false},{"index":384,"time":"13:30","ratio":0.357943,"inputTokens":71589,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.342,"originalCredits":11.342,"afterCompact":false},{"index":385,"time":"13:31","ratio":0.358153,"inputTokens":71631,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.344,"originalCredits":11.344,"afterCompact":false},{"index":386,"time":"13:31","ratio":0.358353,"inputTokens":71671,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.395,"originalCredits":11.395,"afterCompact":false},{"index":387,"time":"13:31","ratio":0.358813,"inputTokens":71763,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.411,"originalCredits":11.411,"afterCompact":false},{"index":388,"time":"13:31","ratio":0.358998,"inputTokens":71800,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.417,"originalCredits":11.417,"afterCompact":false},{"index":389,"time":"13:32","ratio":0.359282,"inputTokens":71856,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.385,"originalCredits":11.385,"afterCompact":false},{"index":390,"time":"13:32","ratio":0.359491,"inputTokens":71898,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.362,"originalCredits":11.362,"afterCompact":false},{"index":391,"time":"13:32","ratio":0.359666,"inputTokens":71933,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.353,"originalCredits":11.353,"afterCompact":false},{"index":392,"time":"13:32","ratio":0.35985,"inputTokens":71970,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.354,"originalCredits":11.354,"afterCompact":false},{"index":393,"time":"13:32","ratio":0.360027,"inputTokens":72005,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.404,"originalCredits":11.404,"afterCompact":false},{"index":394,"time":"13:33","ratio":0.360259,"inputTokens":72052,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.475,"originalCredits":11.475,"afterCompact":false},{"index":395,"time":"13:33","ratio":0.36055,"inputTokens":72110,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.452,"originalCredits":11.452,"afterCompact":false},{"index":396,"time":"13:33","ratio":0.360794,"inputTokens":72159,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.643,"originalCredits":11.643,"afterCompact":false},{"index":397,"time":"13:33","ratio":0.361425,"inputTokens":72285,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.586,"originalCredits":11.586,"afterCompact":false},{"index":398,"time":"13:33","ratio":0.361659,"inputTokens":72332,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.444,"originalCredits":11.444,"afterCompact":false},{"index":399,"time":"13:33","ratio":0.361871,"inputTokens":72374,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.452,"originalCredits":11.452,"afterCompact":false},{"index":400,"time":"13:34","ratio":0.362078,"inputTokens":72416,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.011,"originalCredits":12.011,"afterCompact":false},{"index":401,"time":"13:34","ratio":0.362922,"inputTokens":72584,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.649,"originalCredits":11.649,"afterCompact":false},{"index":402,"time":"13:35","ratio":0.363366,"inputTokens":72673,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.484,"originalCredits":11.484,"afterCompact":false},{"index":403,"time":"13:35","ratio":0.36382,"inputTokens":72764,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.572,"originalCredits":11.572,"afterCompact":false},{"index":404,"time":"13:35","ratio":0.36407,"inputTokens":72814,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.595,"originalCredits":11.595,"afterCompact":false},{"index":405,"time":"13:39","ratio":0.365177,"inputTokens":73035,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.854,"originalCredits":11.854,"afterCompact":false},{"index":406,"time":"13:40","ratio":0.368277,"inputTokens":73655,"outputTokens":null,"usageSource":"transcript-ratio","credits":114.829,"originalCredits":114.829,"afterCompact":false},{"index":407,"time":"13:40","ratio":0.368649,"inputTokens":73730,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.066,"originalCredits":12.066,"afterCompact":false},{"index":408,"time":"13:40","ratio":0.369219,"inputTokens":73844,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.716,"originalCredits":11.716,"afterCompact":false},{"index":409,"time":"13:40","ratio":0.369363,"inputTokens":73873,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.938,"originalCredits":11.938,"afterCompact":false},{"index":410,"time":"13:41","ratio":0.369889,"inputTokens":73978,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.756,"originalCredits":11.756,"afterCompact":false},{"index":411,"time":"13:41","ratio":0.370064,"inputTokens":74013,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.659,"originalCredits":11.659,"afterCompact":false},{"index":412,"time":"13:41","ratio":0.37023,"inputTokens":74046,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.688,"originalCredits":11.688,"afterCompact":false},{"index":413,"time":"13:41","ratio":0.370436,"inputTokens":74087,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.709,"originalCredits":11.709,"afterCompact":false},{"index":414,"time":"13:41","ratio":0.370634,"inputTokens":74127,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.733,"originalCredits":11.733,"afterCompact":false},{"index":415,"time":"13:42","ratio":0.37087,"inputTokens":74174,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.726,"originalCredits":11.726,"afterCompact":false},{"index":416,"time":"13:42","ratio":0.371271,"inputTokens":74254,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.797,"originalCredits":11.797,"afterCompact":false},{"index":417,"time":"13:42","ratio":0.371479,"inputTokens":74296,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.093,"originalCredits":12.093,"afterCompact":false},{"index":418,"time":"13:42","ratio":0.372088,"inputTokens":74418,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.869,"originalCredits":11.869,"afterCompact":false},{"index":419,"time":"13:43","ratio":0.372293,"inputTokens":74459,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.301,"originalCredits":12.301,"afterCompact":false},{"index":420,"time":"13:43","ratio":0.373074,"inputTokens":74615,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.044,"originalCredits":12.044,"afterCompact":false},{"index":421,"time":"13:43","ratio":0.373374,"inputTokens":74675,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.883,"originalCredits":11.883,"afterCompact":false},{"index":422,"time":"13:43","ratio":0.37363,"inputTokens":74726,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.863,"originalCredits":11.863,"afterCompact":false},{"index":423,"time":"13:44","ratio":0.374368,"inputTokens":74874,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.989,"originalCredits":11.989,"afterCompact":false},{"index":424,"time":"13:44","ratio":0.375615,"inputTokens":75123,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.124,"originalCredits":12.124,"afterCompact":false},{"index":425,"time":"13:44","ratio":0.376022,"inputTokens":75204,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.885,"originalCredits":11.885,"afterCompact":false},{"index":426,"time":"13:45","ratio":0.376639,"inputTokens":75328,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.012,"originalCredits":12.012,"afterCompact":false},{"index":427,"time":"13:45","ratio":0.376893,"inputTokens":75379,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.152,"originalCredits":12.152,"afterCompact":false},{"index":428,"time":"13:45","ratio":0.377378,"inputTokens":75476,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.991,"originalCredits":11.991,"afterCompact":false},{"index":429,"time":"13:46","ratio":0.378312,"inputTokens":75662,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.138,"originalCredits":12.138,"afterCompact":false},{"index":430,"time":"13:46","ratio":0.381682,"inputTokens":76336,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.922,"originalCredits":12.922,"afterCompact":false},{"index":431,"time":"13:46","ratio":0.381919,"inputTokens":76384,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.044,"originalCredits":12.044,"afterCompact":false},{"index":432,"time":"13:47","ratio":0.386857,"inputTokens":77371,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.829,"originalCredits":13.829,"afterCompact":false},{"index":433,"time":"13:48","ratio":0.387384,"inputTokens":77477,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.302,"originalCredits":12.302,"afterCompact":false},{"index":434,"time":"13:49","ratio":0.387714,"inputTokens":77543,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.589,"originalCredits":12.589,"afterCompact":false},{"index":435,"time":"13:49","ratio":0.38883,"inputTokens":77766,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.84,"originalCredits":12.84,"afterCompact":false},{"index":436,"time":"13:49","ratio":0.389368,"inputTokens":77874,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.443,"originalCredits":12.443,"afterCompact":false},{"index":437,"time":"13:49","ratio":0.389634,"inputTokens":77927,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.948,"originalCredits":12.948,"afterCompact":false},{"index":438,"time":"13:50","ratio":0.390536,"inputTokens":78107,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.505,"originalCredits":12.505,"afterCompact":false},{"index":439,"time":"13:50","ratio":0.391013,"inputTokens":78203,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.34,"originalCredits":12.34,"afterCompact":false},{"index":440,"time":"13:50","ratio":0.391423,"inputTokens":78285,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.416,"originalCredits":12.416,"afterCompact":false},{"index":441,"time":"13:50","ratio":0.39167,"inputTokens":78334,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.395,"originalCredits":12.395,"afterCompact":false},{"index":442,"time":"13:51","ratio":0.391963,"inputTokens":78393,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.775,"originalCredits":12.775,"afterCompact":false},{"index":443,"time":"13:51","ratio":0.392578,"inputTokens":78516,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.532,"originalCredits":12.532,"afterCompact":false},{"index":444,"time":"13:51","ratio":0.392806,"inputTokens":78561,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.385,"originalCredits":12.385,"afterCompact":false},{"index":445,"time":"13:51","ratio":0.393356,"inputTokens":78671,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.655,"originalCredits":12.655,"afterCompact":false},{"index":446,"time":"13:52","ratio":0.393712,"inputTokens":78742,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.432,"originalCredits":12.432,"afterCompact":false},{"index":447,"time":"13:52","ratio":0.394185,"inputTokens":78837,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.775,"originalCredits":12.775,"afterCompact":false},{"index":448,"time":"13:53","ratio":0.394823,"inputTokens":78965,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.975,"originalCredits":12.975,"afterCompact":false},{"index":449,"time":"13:53","ratio":0.395472,"inputTokens":79094,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.574,"originalCredits":12.574,"afterCompact":false},{"index":450,"time":"13:54","ratio":0.396136,"inputTokens":79227,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.72,"originalCredits":12.72,"afterCompact":false},{"index":451,"time":"13:55","ratio":0.398901,"inputTokens":79780,"outputTokens":null,"usageSource":"transcript-ratio","credits":124.329,"originalCredits":124.329,"afterCompact":false},{"index":452,"time":"13:55","ratio":0.399225,"inputTokens":79845,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.688,"originalCredits":12.688,"afterCompact":false},{"index":453,"time":"13:55","ratio":0.399657,"inputTokens":79931,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.666,"originalCredits":12.666,"afterCompact":false},{"index":454,"time":"13:56","ratio":0.399837,"inputTokens":79967,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.664,"originalCredits":12.664,"afterCompact":false},{"index":455,"time":"13:56","ratio":0.400093,"inputTokens":80019,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.622,"originalCredits":12.622,"afterCompact":false},{"index":456,"time":"13:56","ratio":0.400272,"inputTokens":80054,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.673,"originalCredits":12.673,"afterCompact":false},{"index":457,"time":"13:56","ratio":0.400527,"inputTokens":80105,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.751,"originalCredits":12.751,"afterCompact":false},{"index":458,"time":"13:57","ratio":0.40084,"inputTokens":80168,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.75,"originalCredits":12.75,"afterCompact":false},{"index":459,"time":"14:03","ratio":0.401124,"inputTokens":80225,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.732,"originalCredits":12.732,"afterCompact":false},{"index":460,"time":"14:04","ratio":0.401699,"inputTokens":80340,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.703,"originalCredits":12.703,"afterCompact":false},{"index":461,"time":"14:04","ratio":0.402095,"inputTokens":80419,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.744,"originalCredits":12.744,"afterCompact":false},{"index":462,"time":"14:04","ratio":0.402345,"inputTokens":80469,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.723,"originalCredits":12.723,"afterCompact":false},{"index":463,"time":"14:05","ratio":0.402832,"inputTokens":80566,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.954,"originalCredits":12.954,"afterCompact":false},{"index":464,"time":"14:05","ratio":0.403382,"inputTokens":80676,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.846,"originalCredits":12.846,"afterCompact":false},{"index":465,"time":"14:05","ratio":0.403572,"inputTokens":80714,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.948,"originalCredits":12.948,"afterCompact":false},{"index":466,"time":"14:06","ratio":0.404259,"inputTokens":80852,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.878,"originalCredits":12.878,"afterCompact":false},{"index":467,"time":"14:06","ratio":0.404744,"inputTokens":80949,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.839,"originalCredits":12.839,"afterCompact":false},{"index":468,"time":"14:07","ratio":0.40498,"inputTokens":80996,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.75,"originalCredits":12.75,"afterCompact":false},{"index":469,"time":"14:08","ratio":0.405548,"inputTokens":81110,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.984,"originalCredits":12.984,"afterCompact":false},{"index":470,"time":"14:08","ratio":0.405884,"inputTokens":81177,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.991,"originalCredits":12.991,"afterCompact":false},{"index":471,"time":"14:08","ratio":0.406205,"inputTokens":81241,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.234,"originalCredits":13.234,"afterCompact":false},{"index":472,"time":"14:08","ratio":0.407446,"inputTokens":81489,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.119,"originalCredits":13.119,"afterCompact":false},{"index":473,"time":"14:09","ratio":0.407562,"inputTokens":81512,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.893,"originalCredits":12.893,"afterCompact":false},{"index":474,"time":"14:09","ratio":0.408565,"inputTokens":81713,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.18,"originalCredits":13.18,"afterCompact":false},{"index":475,"time":"14:09","ratio":0.408863,"inputTokens":81773,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.014,"originalCredits":13.014,"afterCompact":false},{"index":476,"time":"14:10","ratio":0.409901,"inputTokens":81980,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.543,"originalCredits":13.543,"afterCompact":false},{"index":477,"time":"14:10","ratio":0.410521,"inputTokens":82104,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.088,"originalCredits":13.088,"afterCompact":false},{"index":478,"time":"14:11","ratio":0.411269,"inputTokens":82254,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.263,"originalCredits":13.263,"afterCompact":false},{"index":479,"time":"14:11","ratio":0.411623,"inputTokens":82325,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.094,"originalCredits":13.094,"afterCompact":false},{"index":480,"time":"14:12","ratio":0.411908,"inputTokens":82382,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.078,"originalCredits":13.078,"afterCompact":false},{"index":481,"time":"14:12","ratio":0.412905,"inputTokens":82581,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.596,"originalCredits":13.596,"afterCompact":false},{"index":482,"time":"14:12","ratio":0.41368,"inputTokens":82736,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.607,"originalCredits":13.607,"afterCompact":false},{"index":483,"time":"14:13","ratio":0.414324,"inputTokens":82865,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.384,"originalCredits":13.384,"afterCompact":false},{"index":484,"time":"14:13","ratio":0.414733,"inputTokens":82947,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.247,"originalCredits":13.247,"afterCompact":false},{"index":485,"time":"14:13","ratio":0.415049,"inputTokens":83010,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.187,"originalCredits":13.187,"afterCompact":false},{"index":486,"time":"14:13","ratio":0.415571,"inputTokens":83114,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.115,"originalCredits":13.115,"afterCompact":false},{"index":487,"time":"14:14","ratio":0.415974,"inputTokens":83195,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.173,"originalCredits":13.173,"afterCompact":false},{"index":488,"time":"14:15","ratio":0.416224,"inputTokens":83245,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.154,"originalCredits":13.154,"afterCompact":false},{"index":489,"time":"14:15","ratio":0.416518,"inputTokens":83304,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.287,"originalCredits":13.287,"afterCompact":false},{"index":490,"time":"14:16","ratio":0.420049,"inputTokens":84010,"outputTokens":null,"usageSource":"transcript-ratio","credits":14.157,"originalCredits":14.157,"afterCompact":false},{"index":491,"time":"14:16","ratio":0.42028,"inputTokens":84056,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.227,"originalCredits":13.227,"afterCompact":false},{"index":492,"time":"14:17","ratio":0.421039,"inputTokens":84208,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.551,"originalCredits":13.551,"afterCompact":false},{"index":493,"time":"14:17","ratio":0.421415,"inputTokens":84283,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.477,"originalCredits":13.477,"afterCompact":false},{"index":494,"time":"14:17","ratio":0.421725,"inputTokens":84345,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.294,"originalCredits":13.294,"afterCompact":false},{"index":495,"time":"14:18","ratio":0.422626,"inputTokens":84525,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.444,"originalCredits":13.444,"afterCompact":false},{"index":496,"time":"14:18","ratio":0.422686,"inputTokens":84537,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.262,"originalCredits":13.262,"afterCompact":false},{"index":497,"time":"14:18","ratio":0.422799,"inputTokens":84560,"outputTokens":null,"usageSource":"transcript-ratio","credits":14.215,"originalCredits":14.215,"afterCompact":false},{"index":498,"time":"14:24","ratio":0.423993,"inputTokens":84799,"outputTokens":null,"usageSource":"transcript-ratio","credits":14.132,"originalCredits":14.132,"afterCompact":false},{"index":499,"time":"14:28","ratio":0.424688,"inputTokens":84938,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.699,"originalCredits":13.699,"afterCompact":false},{"index":500,"time":"14:28","ratio":0.425882,"inputTokens":85176,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.724,"originalCredits":13.724,"afterCompact":false},{"index":501,"time":"14:28","ratio":0.426081,"inputTokens":85216,"outputTokens":null,"usageSource":"transcript-ratio","credits":14.236,"originalCredits":14.236,"afterCompact":false},{"index":502,"time":"14:29","ratio":0.42718,"inputTokens":85436,"outputTokens":null,"usageSource":"transcript-ratio","credits":14.202,"originalCredits":14.202,"afterCompact":false},{"index":503,"time":"14:29","ratio":0.42792,"inputTokens":85584,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.872,"originalCredits":13.872,"afterCompact":false},{"index":504,"time":"14:30","ratio":0.428371,"inputTokens":85674,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.604,"originalCredits":13.604,"afterCompact":false},{"index":505,"time":"14:30","ratio":0.428607,"inputTokens":85721,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.538,"originalCredits":13.538,"afterCompact":false},{"index":506,"time":"14:30","ratio":0.428827,"inputTokens":85765,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.556,"originalCredits":13.556,"afterCompact":false},{"index":507,"time":"14:30","ratio":0.429049,"inputTokens":85810,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.54,"originalCredits":13.54,"afterCompact":false},{"index":508,"time":"14:31","ratio":0.429569,"inputTokens":85914,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.573,"originalCredits":13.573,"afterCompact":false},{"index":509,"time":"14:31","ratio":0.429982,"inputTokens":85996,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.625,"originalCredits":13.625,"afterCompact":false},{"index":510,"time":"14:31","ratio":0.430227,"inputTokens":86045,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.629,"originalCredits":13.629,"afterCompact":false},{"index":511,"time":"14:32","ratio":0.430866,"inputTokens":86173,"outputTokens":null,"usageSource":"transcript-ratio","credits":14.024,"originalCredits":14.024,"afterCompact":false},{"index":512,"time":"14:36","ratio":0.431377,"inputTokens":86275,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.817,"originalCredits":13.817,"afterCompact":false},{"index":513,"time":"14:36","ratio":0.434216,"inputTokens":86843,"outputTokens":null,"usageSource":"transcript-ratio","credits":14.571,"originalCredits":14.571,"afterCompact":false},{"index":514,"time":"14:36","ratio":0.434568,"inputTokens":86914,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.775,"originalCredits":13.775,"afterCompact":false},{"index":515,"time":"14:37","ratio":0.434817,"inputTokens":86963,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.742,"originalCredits":13.742,"afterCompact":false},{"index":516,"time":"14:37","ratio":0.435102,"inputTokens":87020,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.775,"originalCredits":13.775,"afterCompact":false},{"index":517,"time":"14:37","ratio":0.435455,"inputTokens":87091,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.758,"originalCredits":13.758,"afterCompact":false},{"index":518,"time":"14:42","ratio":0.435598,"inputTokens":87120,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.863,"originalCredits":13.863,"afterCompact":false},{"index":519,"time":"14:43","ratio":0.437233,"inputTokens":87447,"outputTokens":null,"usageSource":"transcript-ratio","credits":14.994,"originalCredits":14.994,"afterCompact":false},{"index":520,"time":"14:43","ratio":0.438336,"inputTokens":87667,"outputTokens":null,"usageSource":"transcript-ratio","credits":14.023,"originalCredits":14.023,"afterCompact":false}],"identity":{"sumAttributed":26436748,"billedInputTokens":26436748,"absDiff":0,"ok":true},"pluginVersion":"2.7.4","selfCmd":"\"C:\\Users\\World\\.qoder-cn\\plugins\\cache\\qoder-marketplace\\qoder-credits-inspector\\2.7.4\\bin\\credits-inspector.cmd\" cli","linkHealth":{"matched":0,"requests":520,"coverage":0,"usageSource":"transcript-ratio","breakdown":{"proxy":0,"transcriptTokens":0,"transcriptRatio":520},"logRecords":0,"lastRecordAt":null,"recentRequests":0,"proxyErrors":null,"clientAbort":null,"clientAbortMaxMs":null,"upstreamRejected":null,"aborted":null,"truncated":null,"noUsage":null,"slowestMs":null,"supersededFailure":null},"subagents":{"scanned":true,"dir":"C:\\Users\\World\\.qoder-cn\\projects\\C--Users-World-source-Github-HestiaLab-Loveevo\\8e62ddf2-306d-44ea-ba1f-5c0ca64c3696\\subagents","probedPaths":["C:\\Users\\World\\.qoder-cn\\projects\\C--Users-World-source-Github-HestiaLab-Loveevo\\8e62ddf2-306d-44ea-ba1f-5c0ca64c3696\\subagents","C:\\Users\\World\\.qoder-cn\\projects\\8e62ddf2-306d-44ea-ba1f-5c0ca64c3696\\subagents"],"reason":"ok","count":2,"items":[{"agentId":"a5dff1bb65a324dfd","agentType":"【示例】代码审查员","description":"Verify critical Loveevo fixes","toolUseId":"call_849ce5ed6df049e9a74e6ac4","roundTrips":15,"billedInputTokens":177547,"peakContextRatio":0.0893,"credits":63.553,"originalCredits":63.553,"error":null},{"agentId":"a8e5ac5cd9dcf6961","agentType":"【示例】代码审查员","description":"Review Loveevo implementation","toolUseId":"call_4f3ab12ddd274ab1a621a294","roundTrips":12,"billedInputTokens":118781,"peakContextRatio":0.0779,"credits":45.2,"originalCredits":45.2,"error":null}],"totals":{"roundTrips":27,"billedInputTokens":296328,"credits":108.753,"originalCredits":108.753},"combined":{"roundTrips":547,"billedInputTokens":26733076,"credits":5167.833,"originalCredits":5167.833}},"manual":null,"artifacts":{"report":"report.json","canvas":"_command-message_grill-m__8e62ddf2.canvas.tsx"}} as unknown as Report;

function human(n: number): string {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}

function pct(x: number): string {
  return (x * 100).toFixed(1) + "%";
}

// —— 可用性口径：把 report.availability 翻成人话，并决定某个数字该显示值、「≈」还是「—」——
const AVAIL_LABEL: Record<string, string> = {
  measured: "实测",
  derived: "推导",
  fallback: "回退",
  manual: "手工",
  unavailable: "不可用",
};

const SOURCE_LABEL: Record<string, string> = {
  "desktop-rich": "桌面端富转录",
  "ide-lite": "IDE 端精简转录",
  unknown: "来源未知",
};

function availOf(av: Availability | undefined, key: keyof Availability, dflt: Avail = "measured"): Avail {
  return (av?.[key] as Avail | undefined) ?? dflt;
}

/** 段标题旁的性质标注：实测不标（默认就是实测），其余标出来。 */
function availTag(av: Availability | undefined, key: keyof Availability, dflt: Avail = "measured"): string {
  const v = availOf(av, key, dflt);
  return v === "measured" ? "" : `（${AVAIL_LABEL[v]}）`;
}

/** 不可用的量显示「—」而不是 0：IDE 端的 0 是「读不到」，不是「没发生」。 */
function orDash(
  v: number,
  av: Availability | undefined,
  key: keyof Availability,
  fmt: (n: number) => string = String
): string {
  return availOf(av, key) === "unavailable" ? "—" : fmt(v);
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "read":
      return "读取";
    case "write":
      return "写入";
    case "search":
      return "搜索";
    case "shell":
      return "命令";
    default:
      return "其他";
  }
}

function shortTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function SessionTokensReport() {
  if (!REPORT) {
    return (
      <ReportShell width="wide" ariaLabel="会话 token 消耗截析">
        <Stack gap="component">
          <H1>会话 token 消耗截析</H1>
          <Text tone="secondary">报告数据尚未注入。请在会话中触发一次 Stop 钩子，或运行 CLI 生成 report.json。</Text>
        </Stack>
      </ReportShell>
    );
  }

  const r = REPORT;
  const s = r.session;
  const c = r.context;
  const t = r.totals;
  const av = r.availability;
  const manual = r.manual ?? null;
  const sourceLabel = SOURCE_LABEL[r.source ?? "unknown"] ?? "来源未知";
  // 有没有 usage 决定整份报告是「真值/推导」还是「一律 —」。手工回填的 credits 不算有 usage，
  // 否则下面按 ratio 推导的图表会照画一堆 0。
  const hasUsage = availOf(av, "roundTrips") === "measured";
  const manualCredits = manual?.credits ?? null;

  // 报告里出现的命令一律用数据层注入的插件入口（Windows 上是自带启动器的绝对路径，免装 Node）。
  // 旧报告没有这个字段时回退原写法，不比改动前更差。
  const CLI = r.selfCmd || "node scripts/cli.mjs";

  // credits 覆盖范围：credits 与「计费输入总量」并排放在头部，读者一除就得到单价。
  // 混合会话里 credits 只来自转录路径的那几笔（实测某会话 413 笔里只有 1 笔带 credits），
  // 部分覆盖不说出来 = 把局部真值当全量展示。
  const cov = r.creditsCoverage ?? null;
  const covPartial = !!(cov && !cov.full && cov.roundTrips > 0);
  const covNote = covPartial ? ` · 仅覆盖 ${cov!.trips}/${cov!.roundTrips} 笔往返（占计费输入 ${pct(cov!.tokenShare)}）` : "";

  // 缓存命中：代理记录里一直带着 cachedTokens，此前采集了却从不呈现。
  const cachedMeasured = availOf(av, "cachedTokens") === "measured";
  const cachedText = cachedMeasured
    ? `输入 ${human(t.billedInputTokens)}，其中缓存命中 ${human(t.cachedTokens ?? 0)}（${pct(t.cachedShare ?? 0)}，${t.cachedTrips ?? 0} 笔往返带缓存）——供应商对重复叠加的前缀打折，故按 token 数的节省大于按计费的节省。`
    : "";

  // 代理告警只在「失败记录仍然成立」时才报：status.json 只写不清，陈旧失败会把用户推去改
  // 本来正确的 Base URL，越修越坏；而同一份报告里的 lastRecordAt / matched 是它在跑的硬证据。
  const proxyAlarm = r.proxy?.status && !r.proxy.statusSuperseded ? r.proxy.status : null;
  const proxyAlive = !proxyAlarm && (r.proxy?.logRecords ?? 0) > 0;

  // 官方 UI 一场会话扣费 = 主链 + 子代理，故有子代理时 headline 必须给 combined，否则比 UI 少一截
  const creditScope =
    r.subagents && r.subagents.count > 0
      ? {
          credits: r.subagents.combined.credits,
          note: `主链 ${t.credits} + 子代理 ${r.subagents.totals.credits} · 原始 ${r.subagents.combined.originalCredits}`,
        }
      : { credits: t.credits, note: `原始 ${t.originalCredits}（实测）` };

  const headline: MetricItem[] = [
    {
      label: "计费输入总量",
      value: hasUsage ? human(t.billedInputTokens) : "—",
      description: hasUsage
        ? availOf(av, "tokens") === "measured"
          ? `Σ prompt_tokens（实测真值）${covPartial ? ` · 覆盖全部 ${cov!.roundTrips} 笔往返` : ""}`
          : `Σ 上下文 × 往返${availTag(av, "tokens", "derived")}${covPartial ? ` · 覆盖全部 ${cov!.roundTrips} 笔往返` : ""}`
        : "转录无 usage",
    },
    {
      label: "当前上下文",
      value: hasUsage ? human(t.netContextTokens) : "—",
      description: hasUsage
        ? `峰值 ${pct(c.peakContextRatio)}${s.compactions ? "（压缩后起算）" : ""}`
        : "转录无 usage",
    },
    {
      label: "重发放大",
      value: hasUsage ? `${t.amplification}×` : "—",
      description: `往返 ${hasUsage ? `${s.roundTrips} 次` : "—"}`,
    },
    {
      label: "Credits",
      // 代理路径（自定义模型）token 是实测真值但 credits 无来源：hasUsage 为真也要显示「—」，
      // 否则 t.credits=0 会被读成「这次没花钱」。
      value:
        manualCredits != null
          ? `${manualCredits}`
          : hasUsage && availOf(av, "credits") !== "unavailable"
            ? `${creditScope.credits}`
            : "—",
      description:
        manualCredits != null
          ? `官方 UI 手工录入 · 本地 ${creditScope.credits}`
          : hasUsage && availOf(av, "credits") !== "unavailable"
            ? `${creditScope.note}${covNote}`
            : r.usageSource === "proxy" || r.usageSource === "transcript-tokens" || r.usageSource === "mixed"
              ? "自定义模型（BYOK）不经 Qoder 计费网关，无 credits 真值"
              : hasUsage
                ? "转录带 usage 但没有 credits 字段，本地无计费真值"
                : "本地不可用，见下方告警",
    },
  ];

  const pieData = r.byCategory.map((x) => ({ label: x.label, value: x.tokens }));

  // 系统提示词是报告里少数「用户能直接动」的一项：它每轮被完整重发，总量 = 每请求规模 × 往返数，
  // 而它的大小由装了多少插件与技能决定。占比小时不必啰嗦。
  const sysCat = r.byCategory.find((x) => x.key === "system");
  const sysNote =
    hasUsage && sysCat && sysCat.share >= 0.1
      ? ` 系统提示词占 ${pct(sysCat.share)}（${human(c.systemPromptTokens)}/请求 × ${s.roundTrips} 次往返 = ${human(sysCat.tokens)}）：它每轮都被完整重发，大小由你装了多少插件与技能决定，精简技能能直接压低这一项——本插件自己的技能描述也常驻在里面（约 170 token）。`
      : "";

  const tools = r.byTool.slice(0, 8);
  const toolCategories = tools.map((x) => x.tool);
  const toolSeries = [{ name: "重发 tokens", data: tools.map((x) => x.tokens) }];
  // 「单次」= 平均每次调用带来的重发 token。总量榜会埋掉次数少但每次极贵的工具：
  // 实测 Read 只 29 次却吃 335 万，单次是 Edit 的 2.6 倍。
  const toolRows = tools.map((x) => [
    x.tool,
    human(x.tokens),
    pct(x.share),
    String(x.calls),
    x.perCall == null ? "—" : human(x.perCall),
  ]);

  const files = r.byFile.slice(0, 20);
  const fileRows = files.map((f) => [
    f.label,
    kindLabel(f.kind),
    human(f.billed),
    pct(f.share),
    f.perRead == null ? "—" : human(f.perRead),
    String(f.trips),
    String(f.reads),
  ]);

  const byReq = r.byRequest ?? [];
  const reqLabels = byReq.map((x, i) => x.time || `#${x.index ?? i + 1}`);
  const reqInputs = byReq.map((x) => x.inputTokens);
  const reqCredits = byReq.map((x) => x.credits);
  // credits 只在覆盖全部往返时才画曲线：部分覆盖（BYOK 混合会话实测 413 笔里 1 笔有 credits）
  // 画出来是一地零，既读不出形状，还会暗示「其余往返没花钱」。
  const showCreditsChart = hasUsage && !covPartial && availOf(av, "credits") !== "unavailable";

  // 按类别下钻：类别小计行（accent/neutral）+ 其工具/文件明细行（default），用 rowTone 分组着色。
  const catDetail = r.byCategoryDetail ?? [];
  const detailRows: string[][] = [];
  const detailTones: ("accent" | "neutral" | "default")[] = [];
  for (const cc of catDetail) {
    const hasKids = cc.children.length > 0;
    detailRows.push([cc.label, "—", hasKids ? "小计" : "（整体，无工具/文件归属）", human(cc.tokens), pct(cc.share), "100%", "—"]);
    detailTones.push(hasKids ? "accent" : "neutral");
    for (const k of cc.children) {
      detailRows.push(["", k.tool || "—", k.label, human(k.tokens), pct(k.share), pct(k.catShare), String(k.trips)]);
      detailTones.push("default");
    }
  }

  // 子代理账：Agent 派发的子代理消耗不在主链里，单独一段呈现（无子代理则整段不渲染）。
  const sub = r.subagents;
  const subItems = sub?.items ?? [];
  const subRows: string[][] = [];
  const subTones: ("accent" | "default")[] = [];
  for (const a of subItems) {
    subRows.push([
      a.description || a.agentId,
      a.agentType || "—",
      String(a.roundTrips),
      human(a.billedInputTokens),
      pct(a.peakContextRatio),
      String(a.credits),
      String(a.originalCredits),
      a.error || "—",
    ]);
    subTones.push("default");
  }
  if (sub && subItems.length > 0) {
    subRows.push([
      "合计（主链 + 子代理）",
      "—",
      String(sub.combined.roundTrips),
      human(sub.combined.billedInputTokens),
      "—",
      String(sub.combined.credits),
      String(sub.combined.originalCredits),
      `主链 ${t.credits} / 子代理 ${sub.totals.credits}`,
    ]);
    subTones.push("accent");
  }

  // 压缩单笔成本：输入/摘要一律取数据层归一后的生效值（有代理实测就是实测，否则是客户端自估），
  // 并用「口径」列把两者分开——混着显示会让自估值被当成实测。
  const ccost = r.compactionCost;
  const ccItems = ccost?.items ?? [];
  const compactRows: string[][] = ccItems.map((e) => [
    `#${e.index}`,
    shortTime(e.at),
    e.trigger || "—",
    e.effectiveInputTokens == null ? "—" : human(e.effectiveInputTokens),
    e.effectiveOutputTokens == null ? "—" : human(e.effectiveOutputTokens),
    e.nextInputTokens == null ? "—" : human(e.nextInputTokens),
    e.savedTokens == null ? "—" : human(e.savedTokens),
    e.proxy && e.proxy.ms != null ? `${Math.round(e.proxy.ms / 1000)}s` : "—",
    e.proxy ? "实测" : "自估",
  ]);

  // IDE 端仅剩的真值：工具调用次数与文件读取次数（不依赖 usage，两种转录都写 tool_use 块）。
  const residueRows: string[][] = [];
  if (!hasUsage) {
    for (const x of r.byTool.filter((v) => v.calls > 0).sort((a, b) => b.calls - a.calls).slice(0, 15)) {
      residueRows.push([x.tool, "工具", String(x.calls), "—", "—"]);
    }
    for (const f of r.byFile.filter((v) => v.reads > 0).sort((a, b) => b.reads - a.reads).slice(0, 15)) {
      residueRows.push([f.label, kindLabel(f.kind), "—", String(f.reads), String(f.trips)]);
    }
  }

  // A1 三值：一次带 usage 的往返都没有时 0 <= max(2,0) 恒成立，会把「没数据」判成「校验通过」，
  // 故 breakdown.mjs 在 reqCount===0 时给 null；这里必须显示「不适用」而不是绿色通过。
  const identityText =
    r.identity.ok == null
      ? "恒等式 A1 不适用（本转录没有一次带 usage 的往返）。"
      : r.identity.ok
        ? `归因覆盖 ${pct(t.coverage)}${availTag(av, "categoryShare", "derived")}，恒等式 A1 通过（|Δ|=${r.identity.absDiff}）。`
        : `归因覆盖 ${pct(t.coverage)}，恒等式 A1 未通过（|Δ|=${r.identity.absDiff}）。`;
  // 窗口读不到时是静默回退的 200000，而所有 token 数字都乘它 —— 必须显式标 ≈ 与来源。
  const cwIsFallback = availOf(av, "contextWindow") === "fallback";
  const cwText = cwIsFallback ? `≈${human(c.contextWindow)}（回退值）` : human(c.contextWindow);
  // 当前占用头条：以最新上下文（currentContextTokens）为准；段内单调递增 ⇒ 旧版峰值与当前恒等，故合并为一条。
  const curCtx = c.currentContextTokens ?? c.peakContextTokens;
  const netAdv = c.netUserAdvice || c.peakUserAdvice || c.peakAdvice || null;
  const limitSrcLabel =
    c.userContextLimitSource === "manual" ? "手工"
    : c.userContextLimitSource === "config" ? "配置"
    : c.userContextLimitSource === "derived" ? "实测反推"
    : "默认";
  // 阈值来源非 manual/config/derived ⇒ 用的是内置兜底 200K，不是用户在 Qoder 设的真值，需显式提示如何改。
  const limitIsDefault = c.userContextLimitSource !== "manual" && c.userContextLimitSource !== "config" && c.userContextLimitSource !== "derived";
  // 上下文对比表：把旧版挤成一段小字的「界面显示 / 自动压缩实况 / 历史高点」拆成可扫读的行，无数据不占位。
  const ctxRows: string[][] = [];
  if (c.userContextLimit != null && Number.isFinite(c.contextWindow)) {
    ctxRows.push(
      c.contextWindow > c.userContextLimit
        ? ["Qoder 界面进度条", pct(c.netWindowRatio ?? c.peakContextRatio), `按模型物理窗口 ${cwText} 算，比你真实占比低约 ${(c.contextWindow / c.userContextLimit).toFixed(1)} 倍——界面显得偏空、有迷惑性，别信它`]
        : ["Qoder 界面进度条", pct(c.netWindowRatio ?? c.peakContextRatio), `按模型窗口 ${cwText} 算，与你实设上限一致，显示无偏差`],
    );
  }
  if (c.observedAutoCompactions != null && c.observedAutoCompactions > 0 && c.observedAutoTriggerTokens != null) {
    ctxRows.push(["自动压缩实况", `自动 ${c.observedAutoCompactions} 次`, `触发点在 ~${human(c.observedAutoTriggerTokens)}（窗口的 ${pct(c.autoTriggerRatio ?? 0)}）`]);
  } else if (s.compactions > 0) {
    ctxRows.push(["压缩实况", `手动 ${s.compactions} 次`, "本场未见自动压缩，均为你手动触发"]);
  }
  if (c.peakSessionNotable) {
    ctxRows.push(["压缩前历史高点", `${pct(c.peakSessionRatio ?? 0)}（${human(c.peakSessionTokens ?? 0)}）`, "本场曾达到的最高占用"]);
  }

  // 链路健康度：把 --request-log 的逐笔归因压成一行结论（明细属于排障，留在 CLI）。
  // 分两档：本会话确实走在代理链路上（proxy/mixed）才印「最近 N 笔」的失败统计与排障命令；
  // token 全来自转录的会话里，那些统计说的是别的会话，印成 warning + 命令是噪音，只留覆盖率与最近记录时间。
  // 纯官方模型用户从没配过代理，整行不渲染。
  const lhRaw = r.linkHealth ?? null;
  const lh = lhRaw && (r.proxy?.configured || lhRaw.matched > 0) ? lhRaw : null;
  const lhOnPath = !!lh && (lh.matched > 0 || lh.usageSource === "proxy" || lh.usageSource === "mixed");
  const lhErrors = lh ? lh.proxyErrors ?? 0 : 0;
  const lhBad = lhOnPath && lhErrors > 0;
  const lhTone: "info" | "warning" = lhBad ? "warning" : "info";
  // 三档拆分一行说清：代理实测 / 转录 input_tokens / 转录 ratio×window 各多少笔。
  // 旧报告（v3）无 breakdown 字段时退回到只报 matched。
  const lhBd = lh?.breakdown ?? null;
  const lhBdText = lhBd
    ? `拆分：代理 ${lhBd.proxy} 笔 · 转录 input_tokens ${lhBd.transcriptTokens} 笔 · 转录 ratio×窗口 ${lhBd.transcriptRatio} 笔`
    : "";
  const lhSrcNote = !lh
    ? ""
    : lh.usageSource === "proxy"
      ? "：全部为供应商实测"
      : lh.usageSource === "transcript-tokens"
        ? "：本会话 token 全来自转录 input_tokens（BYOK，代理未在链路上）"
        : lh.usageSource === "transcript-ratio"
          ? "：本会话 token 由 ratio×窗口推导（官方模型）"
          : lh.usageSource === "mixed"
            ? "：多源混合，以下拆分列为准"
            : lh.usageSource === "transcript"
              ? "：本会话 token 全部来自转录，代理不在链路上"
              : "";
  const lhText = !lh
    ? ""
    : [
        lh.requests > 0
          ? `代理覆盖 ${lh.matched}/${lh.requests} 笔往返（${pct(lh.coverage)}）${lhSrcNote}`
          : "本会话没有带 usage 的往返，代理无从覆盖",
        lhBdText,
        lh.lastRecordAt ? `代理最近记录 ${shortTime(lh.lastRecordAt)}` : proxyAlive ? "代理有记录但无时间戳" : "代理从未记到流量",
        lhOnPath && lh.recentRequests
          ? `最近 ${lh.recentRequests} 笔：代理失败 ${lh.proxyErrors} · 上游报错 ${lh.upstreamRejected} · 客户端提前断开 ${lh.aborted} · 成功但无 usage ${lh.noUsage}${
              lh.slowestMs != null ? ` · 最慢 ${Math.round(lh.slowestMs / 1000)}s` : ""
            }`
          : lhOnPath
            ? "请求诊断日志为空（运行中的代理是旧版，或还没记到）"
            : "",
        lhBad ? `有「代理失败」= 请求没出得去或代理自己抛了，跑 ${CLI} --request-log 看归因` : "",
        !lhOnPath && lhErrors > 0 ? `代理另有 ${lhErrors} 笔失败，属于走代理的那些会话` : "",
        lh.supersededFailure
          ? `${shortTime(lh.supersededFailure.at ?? null)} 那条「拉起失败（${lh.supersededFailure.error}）」已被之后的流量推翻，无需处理`
          : "",
      ]
        .filter(Boolean)
        .join("。") + "。";

  return (
    <ReportShell width="wide" ariaLabel="会话 token 消耗截析">
      <Stack gap="sectionCompact">
        <header>
          <Stack gap="component">
            <H1>会话 token 消耗截析</H1>
            <Text tone="secondary">
              {s.model || "未知模型"}
              {s.modelSource === "manual" ? "（手工录入）" : ""} · {sourceLabel} · 会话{" "}
              {String(s.id || "").slice(0, 8)}
              {s.title ? `「${s.title}」` : ""} · {shortTime(s.startedAt)} →{" "}
              {shortTime(s.endedAt)} · 压缩{" "}
              {availOf(av, "compactions") === "unavailable" ? "—" : `${s.compactions} 次`}
              {r.usageSource ? ` · usage 来源 ${
                r.usageSource === "proxy"
                  ? "代理实测"
                  : r.usageSource === "transcript-tokens"
                    ? "转录 input_tokens"
                    : r.usageSource === "transcript-ratio"
                      ? "转录 ratio×窗口"
                      : r.usageSource === "mixed"
                        ? "多源混合"
                        : "转录"
              }` : ""}
              {r.pluginVersion ? ` · v${r.pluginVersion}` : ""} · schema v{r.schemaVersion}
            </Text>
            <MetricsGrid variant="header" columns={4} items={headline} />
          </Stack>
        </header>

        {!hasUsage && r.source === "desktop-rich" && (
          <Callout tone="danger" title="本报告数值不可用：自定义模型（BYOK）不经 Qoder 计费网关">
            转录是桌面端富布局，但 assistant entry 里没有 message.usage——自定义模型（如千问
            tokenplan）的响应不经 Qoder 计费网关，credits / context_usage_ratio 无来源，提供商返回的
            usage 客户端也不落盘（已实测扫过 ~/.qoder-cn、~/.qoder、~/.qoder-cli 与 %APPDATA%\QoderCN）。
            本地补救（改一个配置文件即可，免装 Node、之后全自动）：编辑 {"`~/.qoder-credits-proxy/config.json`"}，
            把 {"`upstream`"} 填成你的供应商根地址（= Base URL 去掉结尾 /v1），再把自定义模型 Base URL 的 host:port
            换成 {`127.0.0.1:${r.proxy?.port ?? 49787}`}（路径保留），新开一个会话即自动拉起代理、按 message.id
            精确 join 出实测 token（credits 仍无真值）。装了 Node 也可用 {"`--setup-proxy`"} / {"`--check-proxy`"} 一步到位。
            手工回填通道同样可用：
            {"`.qoder-credits/overrides/<sessionId>.json`"}。
          </Callout>
        )}

        {!hasUsage && r.source !== "desktop-rich" && (
          <Callout tone="danger" title="本报告数值不可用：转录不含 message.usage">
            这是 {sourceLabel}（IDE 端客户端）。它的转录只写 session_meta / user / assistant / progress 四种 entry，
            message.usage 整个字段不存在，也不落到本地任何其它文件（已实测扫过 ~/.qoder-cn、~/.qoder、
            ~/.qoder-cli 与 %APPDATA%\QoderCN）。因此 Credits、token 与各类占比一律显示「—」而不是 0 ——
            0 会被误读成「这次没花钱」。真值只有官方 UI 有：把它填进{" "}
            {"`.qoder-credits/overrides/<sessionId>.json`"} 后重跑，上方会出现「官方 UI 真值」一段并与本地并列对账。
          </Callout>
        )}

        {manual && (
          <Callout tone="success" title="官方 UI 真值（手工录入，未覆盖任何本地数字）">
            Credits {manual.credits ?? "—"} · 原价 {manual.originalCredits ?? "—"}
            {manual.model ? ` · 模型 ${manual.model}` : ""}
            {manual.durationMin != null ? ` · 时长 ${manual.durationMin} min` : ""}
            {manual.startedAt ? ` · ${shortTime(manual.startedAt)}` : ""}
            {manual.localCoverage != null
              ? ` · 本地${manual.localScope === "combined" ? "合计（主链+子代理）" : "主链"} ${manual.localCredits ?? t.credits}，覆盖 ${pct(manual.localCoverage)}`
              : " · 本地无 usage，无法对账"}
            {manual.note ? `。备注：${manual.note}` : ""}
          </Callout>
        )}

        {sub && sub.count === 0 && sub.reason && sub.reason !== "no-dir" && (
          <Callout tone="warning" title={`子代理账未汇总（${sub.reason}）`}>
            探测过的候选目录：{(sub.probedPaths ?? []).join("  |  ") || "（无）"}
          </Callout>
        )}

        {proxyAlarm && (
          <Callout tone="warning" title={`代理自动启动失败（${proxyAlarm.error}）`}>
            {proxyAlarm.error === "EADDRINUSE"
              ? `端口 ${proxyAlarm.port ?? "—"} 被占用，自定义模型将无法对话。请换一个空闲端口重启代理：${CLI} --setup-proxy --port <新端口>，并把模型 Base URL 改成新端口。`
              : `代理未就绪（${proxyAlarm.error}），自定义模型可能无法对话。请运行 ${CLI} --check-proxy 查看链路状态。`}
          </Callout>
        )}

        {r.proxy?.dormant && !proxyAlarm && (
          <Callout tone="info" title="代理长期空闲">
            代理已配置但超过 14 天没有记录到流量（可能你已改回官方模型）。如不再使用自定义模型，可运行{" "}
            {CLI} --stop-proxy 停用代理；保留也不影响官方模型。
          </Callout>
        )}

        {cwIsFallback && (
          <Callout tone="warning" title="上下文窗口为回退值 200K（未从 runtime-config / usage 反推 / ManualTruth 拿到真值）">
            本会话所有以窗口为分母的占比与「峰值建议」都可能偏大，而绝对 token 数（已改以 S 真值为底）不受影响。
            建议在 {"`.qoder-credits/overrides/<sessionId>.json`"} 里手工填 {"`contextWindow`"}（如 qwen3-max=1000000），或等一笔带 input_tokens+ratio 的往返写入转录后自动反推生效。
          </Callout>
        )}

        {hasUsage && netAdv && c.userContextLimit != null && (
          <Stack gap="component">
            <Callout
              tone={netAdv.tone}
              title={`你真实的上下文占用 ${pct(c.netUserRatio ?? c.peakUserRatio ?? 0)}（${human(curCtx)} / 阈值 ${human(c.userContextLimit)}・${limitSrcLabel}）`}
            >
              {netAdv.text}
              {limitIsDefault && (
                <Text tone="secondary">
                  {` ⚙ 这里的 ${human(c.userContextLimit)} 是插件内置默认值，不是你在 Qoder「模型管理」里设的真实上限（插件读不到那个设置）。想按真实阈值算：在 ~/.qoder-credits-proxy/config.json 填 "userContextLimit": <你的上限>（对所有会话生效），或对本会话在 .qoder-credits/overrides/<会话id>.json 填同名字段，重跑报告即生效。`}
                </Text>
              )}
            </Callout>
            {ctxRows.length > 0 && (
              <Table
                headers={["对比口径", "数值", "说明"]}
                rows={ctxRows}
                density="compact"
              />
            )}
          </Stack>
        )}

        {c.thresholdNotEnforced && (
          <Callout tone="warning" title="⚠ 自动压缩不会在你设的阈值触发（本条最重要）">
            你的模型物理窗口是 {cwText}，Qoder 的自动压缩要等上下文涨到窗口 ~85%（≈{human(Math.round(c.contextWindow * 0.85))}）才触发；
            你在模型管理里设的 {human(c.userContextLimit)} 上限远在其下，永远不会触发自动压缩。
            请照上面「你真实的上下文占用」那条，到点自己手动压缩，别等它自动压。
          </Callout>
        )}

        {lh && (
          <Callout tone={lhTone} title="链路健康度">
            {lhText}
          </Callout>
        )}

        <Callout tone="info" title="度量口径">
          计费输入总量逐笔锁定真值（优先级：代理 promptTokens &gt; 转录 usage.input_tokens &gt; ratio{availTag(av, "contextRatio")} × {cwText}
          {cwIsFallback ? "，未拿到真窗口、全部 token 数字随之带 ≈" : ""}）；各类别/文件按块估算规模比例分摊
          {availTag(av, "categoryShare", "derived")}。{identityText}
          {cachedText ? ` ${cachedText}` : ""}
          {covPartial
            ? ` Credits 只来自 ${cov!.trips}/${cov!.roundTrips} 笔往返（占计费输入 ${pct(cov!.tokenShare)}），其余往返走代理实测、不经 Qoder 计费，故不要拿 Credits 去除以计费输入总量算单价。`
            : ""}
        </Callout>

        {byReq.length > 0 && (
          <ReportSection
            title="逐请求明细（每一次往返）"
            description={
              showCreditsChart
                ? "每个 round-trip 的真实输入规模与 credits；曲线骤降处为上下文压缩重置（顶部四项为会话累计，此处为每一次）"
                : `每个 round-trip 的真实输入规模；曲线骤降处为上下文压缩重置。credits 曲线未画：本会话只有 ${cov?.trips ?? 0}/${cov?.roundTrips ?? byReq.length} 笔往返带 credits（其余走代理实测、不经 Qoder 计费），画出来是一地零。`
            }
            meta={`${byReq.length} 次往返 · 压缩 ${orDash(s.compactions, av, "compactions")} 次`}
            divided
          >
            {showCreditsChart ? (
              <ChartComparisonGrid>
                <ChartContainer title="每次输入 tokens" ariaLabel="每次输入 tokens">
                  <LineChart
                    categories={reqLabels}
                    series={[{ name: "输入 tokens", data: reqInputs, tone: "info" }]}
                    height={220}
                    valueFormatter={human}
                    ariaLabel="每次请求输入 tokens"
                  />
                </ChartContainer>
                <ChartContainer title="每次 credits" ariaLabel="每次 credits">
                  <LineChart
                    categories={reqLabels}
                    series={[{ name: "credits", data: reqCredits, tone: "warning" }]}
                    height={220}
                    ariaLabel="每次请求 credits"
                  />
                </ChartContainer>
              </ChartComparisonGrid>
            ) : (
              <ChartContainer title="每次输入 tokens" ariaLabel="每次输入 tokens">
                <LineChart
                  categories={reqLabels}
                  series={[{ name: "输入 tokens", data: reqInputs, tone: "info" }]}
                  height={220}
                  valueFormatter={human}
                  ariaLabel="每次请求输入 tokens"
                />
              </ChartContainer>
            )}
          </ReportSection>
        )}

        {hasUsage && ccItems.length > 0 && (
          <ReportSection
            title="压缩单笔成本（会话里最贵的那几笔调用）"
            description="每次压缩本身就是一笔普通模型调用：整份上下文当 prompt 进去、摘要当 completion 出来。此前报告只显示「压缩 N 次」，把单笔最贵的开销藏成了一个计数。「省下」= 压缩前规模 − 压缩后首轮实测输入（地板）。口径列：实测=能在代理日志里唯一对上的供应商真值；自估=客户端在压缩边界里写的前后规模。"
            meta={`${ccItems.length} 次 · 输入累计 ${human(ccost?.totals.preTokens ?? 0)} · 摘要累计 ${human(ccost?.totals.postTokens ?? 0)} · 累计省下 ${human(ccost?.totals.savedTokens ?? 0)} · 其中 ${ccost?.totals.measured ?? 0} 笔为供应商实测`}
            divided
          >
            <Table
              headers={["第几次", "时刻", "触发", "输入", "摘要输出", "压缩后首轮", "省下", "耗时", "口径"]}
              rows={compactRows}
              density="compact"
              stickyHeader
            />
          </ReportSection>
        )}

        {sub && subItems.length > 0 && (
          <ReportSection
            title="子代理账（Agent 派发）"
            description="子代理的每次往返只写进它自己的独立转录，不计入上方主链任何数字；官方 UI 的一场会话扣费 = 主链 + 各子代理。"
            meta={`${subItems.length} 个子代理 · 主链 ${t.credits} + 子代理 ${sub.totals.credits} = 合计 ${sub.combined.credits} Credits`}
            divided
          >
            <Table
              headers={["子代理", "类型", "往返", "计费输入", "峰值占比", "Credits", "原价", "备注"]}
              rows={subRows}
              rowTone={subTones}
              density="compact"
              stickyHeader
            />
          </ReportSection>
        )}

        {hasUsage && r.byCategory.length > 0 && (
          <ReportSection
            title="按类别占比"
            description={`会话计费输入 token 在各来源间的分布（完整划分，占比之和 = 100%）${sysNote}`}
            meta={human(t.billedInputTokens) + ` tokens${availTag(av, "categoryShare", "derived")}`}
            divided
          >
            <ChartContainer ariaLabel="按类别占比">
              <PieChart donut data={pieData} centerLabel="计费输入" valueFormatter={human} />
            </ChartContainer>
          </ReportSection>
        )}

        {hasUsage && catDetail.length > 0 && (
          <ReportSection
            title="按类别下钻（工具 / 文件路径）"
            description="每个类别的消耗再拆到工具与具体文件/路径：工具返回、工具调用可精确到路径，其余类别为整体（无文件归属）。数值均为重发计费 token。"
            meta={`占总额=占计费输入总量 · 占本类=占该类别 · 程数=存活往返累计${availTag(av, "fileShare", "derived")}`}
            divided
          >
            <Table
              headers={["类别", "工具", "文件 / 路径", "重发 tokens", "占总额", "占本类", "程数"]}
              rows={detailRows}
              rowTone={detailTones}
              density="compact"
              stickyHeader
            />
          </ReportSection>
        )}

        {hasUsage && tools.length > 0 && (
          <ReportSection
            title="按工具占比"
            description="各工具相关内容（调用参数 + 返回）重发累计的计费 token 占比（仅工具相关块，非完整划分，占比之和 < 100%）。「单次」= 平均每次调用带来的重发 token：总量榜会把「次数少但每次极贵」的工具埋掉，这一列专门把它捞出来。"
            meta={`token 占比${availTag(av, "toolShare", "derived")} · 调用次数为实测`}
            divided
          >
            <Stack gap="component">
              <ChartContainer ariaLabel="按工具占比">
                <BarChart horizontal categories={toolCategories} series={toolSeries} valueFormatter={human} ariaLabel="按工具占比" />
              </ChartContainer>
              <Table
                headers={["工具", "重发 tokens", "占比", "调用", "单次"]}
                rows={toolRows}
                density="compact"
                stickyHeader
              />
            </Stack>
          </ReportSection>
        )}

        {hasUsage && fileRows.length > 0 && (
          <ReportSection
            title="按文件占比"
            description="精确到路径/文件名：内容随上下文被重复发送累计的计费 token 占比（Top 20，仅可归因文件的块）。「单次读取」= 这个文件平均每次被读取最终烧掉多少（含此后每一程的重发）——读一次就烧掉十几万的文件，在按总量排序的榜上毫不起眼。"
            meta={`程数=存活往返累计 · 读取=返回次数（实测）${availTag(av, "fileShare", "derived")}`}
            divided
          >
            <Table
              headers={["文件", "种类", "重发 tokens", "占比", "单次读取", "程数", "读取"]}
              rows={fileRows}
              density="compact"
              stickyHeader
            />
          </ReportSection>
        )}

        {!hasUsage && residueRows.length > 0 && (
          <ReportSection
            title="工具调用与文件读取（计数为实测）"
            description="占比与 token 一律不可用，但 tool_use 块两种转录都写，所以「谁被调了几次、谁被读了几次」仍是真值 —— IDE 端不是一无所有。"
            meta={`${t.toolCalls ?? 0} 次工具调用${availTag(av, "toolCalls")} · ${t.fileReads ?? 0} 次文件读取${availTag(av, "fileReads")} · ${s.turns} 轮对话`}
            divided
          >
            <Table
              headers={["工具 / 文件", "种类", "调用", "读取", "程数"]}
              rows={residueRows}
              density="compact"
              stickyHeader
            />
          </ReportSection>
        )}
      </Stack>
    </ReportShell>
  );
}
