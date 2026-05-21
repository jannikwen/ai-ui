import { getLlmEnv } from "../config/llmEnv";
import { collapseHtmlPrototypeBlock } from "./extractHtmlFromMarkdown";
import { DEMO_LOGIN_HTML } from "./mockHtml";
import { getStyleById, type StylePresetId } from "../config/styles";
import type { ChatMessage, SelectedElement } from "../types";

export type SessionBrief = {
  id: string;
  title: string;
  hasHtml: boolean;
};

export type LlmReply = {
  /** 完整的助手回复文本（含 Markdown） */
  content: string;
  /** AI 为本轮对话提取的标签（最多 5 个） */
  tags: string[];
};

function buildSystemPrompt(styleId: StylePresetId, allSessions: SessionBrief[], refHtml: string | null, resumeMode = false): string {
  // 恢复续写模式：只用极简指令，不包含任何 HTML 生成/风格/跨会话等系统提示词
  // 让 LLM 完全根据对话上下文自然续写
  if (resumeMode) {
    return [
      "你正在续写一条被中断的消息。",
      "直接从未完成处继续写，不要打招呼、不要解释、不要开新话题。",
      "必须保持与上文相同的风格、格式和内容方向，无缝衔接。",
    ].join("\n");
  }

  const style = getStyleById(styleId);
  return [
    "你是资深前端与 UI 原型助手。",
    "当用户需要界面原型时，用中文简要说明思路，然后给出**一个** Markdown 围栏代码块：语言标记为 html，",
    "内容为**完整可运行的 HTML 文档**（含 <!DOCTYPE html>",
    "自定义样式请写普通 CSS。",
    "不要在 html 围栏外再嵌套第二层 ```。",
    "**严格禁止使用任何联网的外部资源**：不得引入 Google Fonts、外部 CDN 的 JS/CSS 库、外部图片、第三方 API 等，特别注意不要使用tailwindcss。",
    "所有图标请使用内联 SVG 或纯文本/emoji 代替，不得依赖外部图标库。所有字体使用系统默认栈（如 system-ui, -apple-system 等），不得加载外部字体。",
    "对话可能是多轮：若用户在已有原型上提出修改，请阅读前文（尤其**最新一条助手消息**里给出的完整 HTML），",
    "输出**整合修改后的完整 HTML 文档**（新的 ```html 围栏），不要只回复文字说明而不给出新的 html 代码块，也不要只输出增量片段。",
    "",
    `【当前 UI 风格要求】${style.name}`,
    style.instruction,
    "【多标签页/子页面切换要求】",
    "如果用户没有明确要求创建多个独立 HTML 文件，请在单个 HTML 文件中实现多标签页（子页面）切换功能：",
    "1. 使用 JavaScript 变量 `let activeTab = 'tab1';` 跟踪当前选中的标签（或使用框架状态管理）",
    "2. 为每个子页面创建独立的内容区域（如 `<div id=\"page-tab1\">`），通过 `activeTab` 控制显示/隐藏",
    "3. 在顶部或侧边添加标签导航栏（Tab Bar / Sidebar Nav），点击时更新 `activeTab` 并切换显示对应内容",
    "4. 使用 CSS 类名控制激活态样式（如 `.tab-active` 高亮当前标签）",
    "5. 完善每个子页面的基础功能与布局，保证功能完整，页面美观，组件丰富，不要只放占位文字",
    "6. 确保切换流畅，不要刷新页面或重新加载资源",
    "",
    "【iframe 沙箱页内交互规则 — 极其重要】",
    "该页面将在 iframe 沙箱中展示！违反以下规则会导致预览页白屏跳转或嵌入层叠：",
    "a) **严禁**使用 `<a>` 标签作为标签页切换或任何页内交互按钮；所有可点击元素必须使用 `<button type=\"button\">`",
    "b) 所有 `<button>` 必须显式设置 `type=\"button\"`（不要省略，省略时默认是 submit，可能在表单中触发意外提交）",
    "c) 所有页内交互按钮（tab 切换、折叠展开、弹窗开关等）的 click 事件处理函数中，**必须在第一行调用 `e.preventDefault()`** 阻止浏览器默认行为",
    "d) **严禁**使用 `window.location`、`window.open`、`document.location`、`history.pushState` 等会改变页面地址的 API",
    "e) **严禁**在 HTML 中设置任何 `<a href=\"...\">`（哪怕 href=\"#\" 也不行，iframe 内的 # 锚点会触发父页面滚动/跳转）",
    "f) 如果确实需要链接效果（如\"跳转到其他原型\"），必须通过 `window.parent.postMessage({ type:'navigate', sessionId: '目标会话ID' }, '*')` 通信",
    "",
    "【跨会话链接能力】",
    `当前工作区共有以下会话（Session）：`,
    ...allSessions.map(
      (s) =>
        `  - 会话 ID: \`${s.id}\`，标题: "${s.title}"${s.hasHtml ? "（已生成原型页面）" : "（尚无原型页面）"}`,
    ),
    "如果你需要创建一个指向另一个会话预览页面的超链接按钮，请在 HTML 中生成如下格式：",
    `<button onclick="window.parent.postMessage({ type: 'navigate', sessionId: '${allSessions.length > 0 ? allSessions[0]!.id : "SESSION_ID"}' }, '*')">跳转到 XX 原型</button>`,
    "用户点击该按钮时，应用会自动切换到目标会话的预览视图。",
    "注意：使用 postMessage 通信，type 固定为 'navigate'，sessionId 为目标会话 ID。",
    "",
    "【标签提取】",
    "在每次回复的**末尾**，请以如下格式输出 2~5 个最能概括本次原型内容的中文标签（每个标签 2~4 个字）：",
    "<!-- TAGS: 标签1, 标签2, 标签3 -->",
    "如果对话是已有原型的修改，标签应综合反映整个会话的主题。",
    "示例：<!-- TAGS: 登录页, 深色模式, 表单设计 -->",
    "",
    refHtml
      ? [
          "【引用原型】",
          "当前用户正在引用另一个已有的原型页面。该页面的完整 HTML 如下：",
          "```html",
          refHtml,
          "```",
          "请基于该引用的原型进行修改、扩展或创建新界面。若用户没有提出具体修改要求，请直接改进引用原型的样式或补充交互。",
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function indexOfLastAssistant(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "assistant") return i;
  }
  return -1;
}

/** 截断过长历史，并对「非最新」的助手回复折叠 HTML，控制 token。 */
function prepareHistoryForOpenAi(messages: ChatMessage[], maxMessages = 36): ChatMessage[] {
  const clipped = messages.slice(-maxMessages);
  const lastAi = indexOfLastAssistant(clipped);
  return clipped.map((m, i) => {
    if (m.role !== "assistant") return m;
    if (i === lastAi) return m;
    return { ...m, content: collapseHtmlPrototypeBlock(m.content) };
  });
}

async function mockReply(history: ChatMessage[]): Promise<string> {
  await new Promise((r) => setTimeout(r, 900));

  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const prompt = lastUser?.content?.trim() ?? "";

  const hasAssistantBefore = history.slice(0, -1).some((m) => m.role === "assistant");

  const trimmed = prompt.trim();
  const hint = hasAssistantBefore
    ? `已在既有原型对话基础上收到你的补充说明：“${trimmed.slice(0, 120)}${trimmed.length > 120 ? "…" : ""}”。`
    : trimmed
      ? `已收到你的描述：“${trimmed.slice(0, 120)}${trimmed.length > 120 ? "…" : ""}”。`
      : "未检测到文本提示，这里给出一个默认可交互登录页原型。";

  return [
    hint,
    "",
    "下面是一段可直接在浏览器中运行的完整 `index.html`（通过 Tailwind CDN 注入样式）：",
    "",
    "```html",
    DEMO_LOGIN_HTML,
    "```",
    "",
    "你可以在「预览」里实时查看，或在「代码」里高亮查看并导出为 `index.html`。",
  ].join("\n");
}

type OpenAIChatResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
};

type OpenAIChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | object[] }
  | { role: "assistant"; content: string };

function toUserPayload(
  msg: ChatMessage,
  isLastTurn: boolean,
  images: string[],
): string | object[] {
  if (isLastTurn && images.length > 0) {
    return [
      {
        type: "text" as const,
        text: msg.content.trim() || "请结合附件与对话历史更新界面原型。",
      },
      ...images.map((url) => ({
        type: "image_url" as const,
        image_url: { url },
      })),
    ];
  }

  if (msg.imageDataUrls?.length) {
    return (
      (msg.content?.trim() || "[用户消息]") +
      `\n（该轮用户曾上传 ${msg.imageDataUrls.length} 张图片；历史图片未在后续轮次重复传输。）`
    );
  }

  return msg.content?.trim() || "[空消息]";
}

/**
 * 调用 OpenAI 兼容的 `POST {apiBase}/chat/completions`。
 * `history` 须为按时间排序的消息列表，且**最后一条为用户**；`images` 仅会附加在该用户消息上。
 */
/** 从助手回复末尾解析 AI 标签 */
function parseTagsFromReply(reply: string): string[] {
  const match = reply.match(/<!--\s*TAGS:\s*([\s\S]*?)\s*-->/i);
  if (!match) return [];
  return match[1]!
    .split(/[,，、]/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 10);
}

async function buildPayload(history: ChatMessage[], images: string[], styleId: StylePresetId, allSessions: SessionBrief[], refHtml: string | null, resumeMode = false): Promise<{ messages: OpenAIChatMessage[] }> {
  if (!history.length || history[history.length - 1]!.role !== "user") {
    throw new Error("chatWithLLM：历史最后一条必须是用户消息");
  }

  const prepared = prepareHistoryForOpenAi(history);

  const payloadMessages: OpenAIChatMessage[] = [
    { role: "system", content: buildSystemPrompt(styleId, allSessions, refHtml, resumeMode) },
    ...prepared.map((m, idx): OpenAIChatMessage => {
      const isLast = idx === prepared.length - 1;
      if (m.role === "user") {
        return { role: "user", content: toUserPayload(m, isLast, images) };
      }
      return { role: "assistant", content: m.content || "" };
    }),
  ];

  return { messages: payloadMessages };
}

async function openAiCompatibleChat(
  history: ChatMessage[],
  images: string[],
  apiBase: string,
  apiKey: string,
  model: string,
  styleId: StylePresetId,
  allSessions: SessionBrief[],
  refHtml: string | null,
): Promise<LlmReply> {
  const { messages: payloadMessages } = await buildPayload(history, images, styleId, allSessions, refHtml);

  const res = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.6,
      messages: payloadMessages,
    }),
  });

  const raw = await res.text();
  let data: OpenAIChatResponse;
  try {
    data = JSON.parse(raw) as OpenAIChatResponse;
  } catch {
    throw new Error(`接口返回非 JSON（HTTP ${res.status}）：${raw.slice(0, 500)}`);
  }

  if (!res.ok) {
    const msg = data.error?.message ?? raw.slice(0, 500);
    throw new Error(`LLM 请求失败（${res.status}）：${msg}`);
  }

  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("接口未返回 choices[0].message.content");
  }
  return {
    content: text,
    tags: parseTagsFromReply(text),
  };
}

/**
 * 流式调用 OpenAI 兼容的 `/chat/completions`，每收到一个 token 就回调 onChunk。
 * 返回完整的 LlmReply（流结束后解析最终文本和标签）。
 */
async function openAiCompatibleChatStream(
  history: ChatMessage[],
  images: string[],
  apiBase: string,
  apiKey: string,
  model: string,
  styleId: StylePresetId,
  allSessions: SessionBrief[],
  refHtml: string | null,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
  resumeMode = false,
): Promise<LlmReply> {
  const { messages: payloadMessages } = await buildPayload(history, images, styleId, allSessions, refHtml, resumeMode);

  const res = await fetch(`${apiBase}/chat/completions`, {
    signal,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.6,
      stream: true,
      messages: payloadMessages,
    }),
  });

  if (!res.ok) {
    const raw = await res.text();
    let msg = raw.slice(0, 500);
    try {
      const data = JSON.parse(raw) as OpenAIChatResponse;
      msg = data.error?.message ?? msg;
    } catch { /* use raw */ }
    throw new Error(`LLM 流式请求失败（${res.status}）：${msg}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("响应体不可读，无法启用流式处理");
  }

  const decoder = new TextDecoder("utf-8");
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // 最后一个不完整行留在 buffer 里
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;

      const dataStr = trimmed.slice("data:".length).trim();
      if (dataStr === "[DONE]") continue;

      try {
        const chunk = JSON.parse(dataStr) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          onChunk(fullText);
        }
      } catch {
        // 忽略无法解析的 SSE 行
      }
    }
  }

  if (!fullText) {
    throw new Error("流式接口未返回任何内容");
  }

  return {
    content: fullText,
    tags: parseTagsFromReply(fullText),
  };
}

/**
 * 通用大模型对话抽象：
 * - `history`：包含本轮用户在内的完整上下文（按时间排序，末条为用户）；
 * - `images`：仅作用于本轮用户消息的多模态附件（data URL）；
 * - `styleId`：当前选中的 UI 风格 ID，用于注入样式指令。
 * - 配置 `.env` / `.env.local` 中的 `VITE_LLM_*` 后走真实 HTTP；否则使用 Mock。
 */
export async function chatWithLLM(
  history: ChatMessage[],
  images: string[],
  styleId: StylePresetId = "modern",
  allSessions: SessionBrief[] = [],
  refHtml: string | null = null,
): Promise<LlmReply> {
  const { apiBase, apiKey, model, useRealApi } = getLlmEnv();
  if (!useRealApi) {
    const content = await mockReply(history);
    return {
      content,
      tags: ["登录页", "表单", "响应式"],
    };
  }
  return openAiCompatibleChat(history, images, apiBase, apiKey, model, styleId, allSessions, refHtml);
}

/**
 * 流式版本：每收到一个 token 就回调 onChunk（传入当前累积的完整文本）。
 * Mock 模式下会模拟逐字打字效果。
 */
export async function chatWithLLMStream(
  history: ChatMessage[],
  images: string[],
  styleId: StylePresetId = "modern",
  allSessions: SessionBrief[] = [],
  refHtml: string | null = null,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
  resumeMode = false,
): Promise<LlmReply> {
  const { apiBase, apiKey, model, useRealApi } = getLlmEnv();
  if (!useRealApi) {
    const content = await mockReply(history);
    // 模拟逐字打字效果（支持 AbortSignal 中断）
    let displayed = "";
    for (let i = 0; i < content.length; i++) {
      if (signal?.aborted) {
        return { content: displayed, tags: parseTagsFromReply(displayed) };
      }
      displayed += content[i];
      onChunk(displayed);
      await new Promise((r) => setTimeout(r, 8 + Math.random() * 4));
    }
    return {
      content,
      tags: ["登录页", "表单", "响应式"],
    };
  }
  return openAiCompatibleChatStream(
    history,
    images,
    apiBase,
    apiKey,
    model,
    styleId,
    allSessions,
    refHtml,
    onChunk,
    signal,
    resumeMode,
  );
}

/**
 * 构建编辑模式专用的 prompt。
 * 仅发送 HTML + 选中元素 + 用户修改要求，要求 LLM 返回结构化 JSON 修改命令。
 */
export function buildEditPrompt(
  html: string,
  element: SelectedElement,
  instruction: string,
): string {
  return [
    "你是 DOM 操作专家。请根据下方的 HTML 和用户修改要求，输出一个 JSON 格式的结构化修改命令。",
    "",
    "【重要规则】",
    "1. 只输出合法的 JSON 对象，不要添加任何文字说明、Markdown 围栏或注释",
    "2. 使用精确的 CSS 选择器定位目标元素（优先使用 id，其次用 class 组合）",
    "3. 样式修改使用 setStyle action，直接设置 inline style 属性",
    "4. 不要输出完整的 HTML，只输出修改命令 JSON",
    "5. 【CSS 伪类选择器陷阱】绝对不要使用 :last-child 伪类！",
    "   - :last-child 要求元素必须是父容器的最后一个子元素，但页面中通常还有其他元素（如 script 标签、footer 等）",
    "   - 如果需要选择同类型的最后一个元素，请使用 :last-of-type",
    "   - 示例：.tab-nav:last-of-type 而不是 .tab-nav:last-child",
    "6. 【CSS 样式属性名】使用 kebab-case 格式（如 background-color），不要使用 camelCase",
    "7. 【禁止使用非标准选择器】绝对不要使用 :contains()、:has() 这类 jQuery 扩展伪类！",
    "   - :contains() 和 :has() 不是标准 CSS 选择器，document.querySelector 不支持，会导致命令执行失败",
    "   - 需要按文本内容匹配时，请改用 id、class 或 data-* 属性等标准选择器",
    "   - 示例：.tab-btn[data-tab='tab2'] 而不是 a:contains('新建合同')",
    "8. 【JSON 中 HTML 属性引号必须转义】html / outerHtml 字段值是 HTML 片段，",
    "   内部包含 class=\"xxx\" 等属性，必须将属性值的双引号转义为 \\\"！",
    "   - 正确：{\"html\": \"<div class=\\\"btn\\\">文本</div>\"}",
    "   - 错误：{\"html\": \"<div class=\"btn\">文本</div>\"}（未转义的双引号会破坏 JSON 结构）",
    "",
    "【支持的 action 类型】",
    `- setStyle: 修改内联样式
      参数: selector, styles (对象，CSS 属性名: 值)
      示例: {"action":"setStyle","selector":"#btn","styles":{"backgroundColor":"#ef4444","borderRadius":"8px"}}`,
    `- setText: 替换文本内容
      参数: selector, value
      示例: {"action":"setText","selector":".title","value":"新标题"}`,
    `- setAttribute: 设置 HTML 属性
      参数: selector, name, value
      示例: {"action":"setAttribute","selector":"input","name":"placeholder","value":"请输入"}`,
    `- replaceClass: 替换单个 CSS 类名
      参数: selector, oldClass, newClass
      示例: {"action":"replaceClass","selector":".card","oldClass":"bg-white","newClass":"bg-gray-100"}`,
    `- setHtml: 替换元素内部 HTML
      参数: selector, html
      示例: {"action":"setHtml","selector":".desc","html":"<p>新内容</p>"}`,
    `- addClass: 添加 CSS 类名
      参数: selector, class
      示例: {"action":"addClass","selector":"#nav","class":"sticky"}`,
    `- removeClass: 移除 CSS 类名
      参数: selector, class
      示例: {"action":"removeClass","selector":".banner","class":"hidden"}`,
    `- setOuterHtml: 完全替换整个元素
      参数: selector, outerHtml
      示例: {"action":"setOuterHtml","selector":"#old","outerHtml":"<div id='new'>新元素</div>"}`,
    `- addSibling: 在元素前后插入兄弟节点
      参数: selector, position ("before" 或 "after"), html
      示例: {"action":"addSibling","selector":"li:last-of-type","position":"after","html":"<li>新项目</li>"}`,
    "",
    "【输出格式】",
    '{"commands": [...],"explanation": "简要说明修改内容"}',
    "",
    "【当前页面 HTML】",
    "```html",
    html,
    "```",
    "",
    "【用户选中的元素（供你确定选择器）】",
    `标签: <${element.tagName}>`,
    `ID: ${element.id || "(无)"}`,
    `CSS 类: ${element.className || "(无)"}`,
    `文本内容: "${element.textContent}"`,
    `完整 HTML:`,
    "```html",
    element.outerHtml,
    "```",
    "",
    "【用户修改要求】",
    instruction,
    "",
    "现在请输出修改命令 JSON：",
  ].join("\n");
}

/**
 * 编辑模式 Mock 回复：返回一条简单的 setStyle 命令。
 */
function mockEditReply(instruction: string, element: SelectedElement): string {
  const selector = element.id
    ? `#${element.id}`
    : element.className
      ? `.${element.className.split(" ")[0]}`
      : element.tagName;

  const cmd: any = {
    action: "setStyle",
    selector,
    styles: {
      backgroundColor: "#fef3c7",
      border: "2px solid #f59e0b",
      borderRadius: "8px",
      boxShadow: "0 2px 8px rgba(245,158,11,0.2)",
      padding: "8px 16px",
    },
  };

  // 如果指令提到颜色词，尝试匹配
  const colorMap: Record<string, string> = {
    红色: "#ef4444",
    蓝色: "#3b82f6",
    绿色: "#22c55e",
    黄色: "#eab308",
    紫色: "#a855f7",
    粉色: "#ec4899",
    橙色: "#f97316",
    灰色: "#6b7280",
    黑色: "#000000",
    白色: "#ffffff",
  };

  for (const [name, hex] of Object.entries(colorMap)) {
    if (instruction.includes(name)) {
      (cmd.styles as Record<string, string>).backgroundColor = hex;
      break;
    }
  }

  // 如果提到圆角
  if (/圆角|rounded/.test(instruction)) {
    (cmd.styles as Record<string, string>).borderRadius = "12px";
  }

  // 如果提到阴影
  if (/阴影|shadow/.test(instruction)) {
    (cmd.styles as Record<string, string>).boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
  }

  return JSON.stringify({
    commands: [cmd],
    explanation: `Mock 模式：已将 "${(element.textContent || element.tagName).slice(0, 20)}" 的样式高亮为 ${Object.keys(colorMap).find((k) => instruction.includes(k)) || "黄色"}${/圆角|rounded/.test(instruction) ? "，添加圆角" : ""}${/阴影|shadow/.test(instruction) ? "，添加阴影" : ""}`,
  });
}

/**
 * 编辑模式专用 LLM 调用。
 * 发送精简 prompt（仅 HTML + 选中元素 + 修改要求），
 * 期望 LLM 返回结构化 JSON 修改命令，本地执行 DOM 操作。
 */
export async function chatWithLLMForEdit(
  html: string,
  element: SelectedElement,
  instruction: string,
): Promise<string> {
  const { apiBase, apiKey, model, useRealApi } = getLlmEnv();

  if (!useRealApi) {
    // Mock 模式：模拟延迟后返回简单命令
    await new Promise((r) => setTimeout(r, 500));
    return mockEditReply(instruction, element);
  }

  const systemPrompt = buildEditPrompt(html, element, instruction);

  const payloadMessages: OpenAIChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: instruction },
  ];

  const res = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3, // 编辑模式温度更低，追求确定性输出
      messages: payloadMessages,
    }),
  });

  const raw = await res.text();
  let data: OpenAIChatResponse;
  try {
    data = JSON.parse(raw) as OpenAIChatResponse;
  } catch {
    throw new Error(`编辑模式接口返回非 JSON（HTTP ${res.status}）：${raw.slice(0, 500)}`);
  }

  if (!res.ok) {
    const msg = data.error?.message ?? raw.slice(0, 500);
    throw new Error(`编辑模式 LLM 请求失败（${res.status}）：${msg}`);
  }

  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("编辑模式：接口未返回 choices[0].message.content");
  }

  return text;
}

/**
 * 编辑模式流式 LLM 调用。
 * 每收到一个 token 就回调 onChunk（传入当前累积的完整文本），
 * 流式结束后返回完整回复文本。
 */
export async function chatWithLLMForEditStream(
  html: string,
  element: SelectedElement,
  instruction: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { apiBase, apiKey, model, useRealApi } = getLlmEnv();

  if (!useRealApi) {
    // Mock 模式：模拟逐字流式输出
    const mockJson = mockEditReply(instruction, element);
    let displayed = "";
    for (let i = 0; i < mockJson.length; i++) {
      if (signal?.aborted) return displayed;
      displayed += mockJson[i];
      onChunk(displayed);
      await new Promise((r) => setTimeout(r, 8 + Math.random() * 4));
    }
    return mockJson;
  }

  const systemPrompt = buildEditPrompt(html, element, instruction);

  const payloadMessages: OpenAIChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: instruction },
  ];

  const res = await fetch(`${apiBase}/chat/completions`, {
    signal,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      stream: true,
      messages: payloadMessages,
    }),
  });

  if (!res.ok) {
    const raw = await res.text();
    let msg = raw.slice(0, 500);
    try {
      const data = JSON.parse(raw) as OpenAIChatResponse;
      msg = data.error?.message ?? msg;
    } catch { /* use raw */ }
    throw new Error(`编辑模式流式请求失败（${res.status}）：${msg}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("编辑模式：响应体不可读，无法启用流式处理");
  }

  const decoder = new TextDecoder("utf-8");
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;

      const dataStr = trimmed.slice("data:".length).trim();
      if (dataStr === "[DONE]") continue;

      try {
        const chunk = JSON.parse(dataStr) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          onChunk(fullText);
        }
      } catch {
        // 忽略无法解析的 SSE 行
      }
    }
  }

  if (!fullText) {
    throw new Error("编辑模式流式接口未返回任何内容");
  }

  return fullText;
}
