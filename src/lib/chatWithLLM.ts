import { getLlmEnv } from "../config/llmEnv";
import { collapseHtmlPrototypeBlock } from "./extractHtmlFromMarkdown";
import { DEMO_LOGIN_HTML } from "./mockHtml";
import { getStyleById, type StylePresetId } from "../config/styles";
import type { ChatMessage } from "../types";

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
    "**严格禁止使用任何联网的外部资源**：不得引入 Google Fonts、外部 CDN 的 JS/CSS 库、外部图片、第三方 API 等。",
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
