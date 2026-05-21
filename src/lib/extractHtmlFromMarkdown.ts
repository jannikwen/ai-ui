/**
 * 从 Markdown 中提取用于 iframe 的完整 HTML 文档。
 *
 * 兼容常见模型输出变体：
 * - ` ```html` / ` ``` html` / ` ```  HTML  `（语言标记与反引号之间可有空格）
 * - 无语言标记但内容为 `<!DOCTYPE` / `<html` 等完整文档
 * - 多个围栏时：优先「显式标记为 html」的块，其次取最长、最像完整文档的一块
 */

const FENCE =
  /```\s*([^\n\r`]*?)\s*\r?\n([\s\S]*?)```/g;

function normalizeMarkdown(md: string) {
  return md
    .replace(/\uFEFF/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\uFF40/g, "`");
}

function looksLikeHtmlDocument(inner: string) {
  const t = inner.trim();
  if (!t) return false;
  return (
    /^<!DOCTYPE html>/i.test(t) ||
    /<html[\s>]/i.test(t) ||
    /<(!DOCTYPE|html|head|body|div|main|section)\b/i.test(t)
  );
}

function scoreBlock(langRaw: string, body: string) {
  const lang = langRaw.trim().replace(/[`\s]+/g, "").toLowerCase();
  const len = body.length;
  const doc = looksLikeHtmlDocument(body);

  if (lang === "html" || lang === "htm") {
    return { score: 1_000_000 + len, body };
  }
  if (!lang && doc) {
    return { score: 100_000 + len, body };
  }
  if (doc) {
    return { score: 10_000 + len, body };
  }
  return { score: -1, body };
}

export type HtmlFenceMatch = {
  html: string;
  /** inclusive, on normalized markdown */
  start: number;
  /** exclusive end index on normalized markdown */
  end: number;
};

function pickBestHtmlFence(text: string): HtmlFenceMatch | null {
  let best: (HtmlFenceMatch & { score: number }) | null = null;

  for (const m of text.matchAll(FENCE)) {
    const full = m[0];
    const langRaw = m[1] ?? "";
    const body = (m[2] ?? "").trim();
    if (!body) continue;

    const { score, body: candidate } = scoreBlock(langRaw, body);
    if (score < 0) continue;

    const start = m.index ?? 0;
    const end = start + full.length;
    if (!best || score > best.score) {
      best = { html: candidate, start, end, score };
    }
  }

  if (!best) return null;
  return { html: best.html, start: best.start, end: best.end };
}

/**
 * 提取最合适的 ```…``` 围栏中的 HTML；找不到则返回 null。
 */
export function extractFirstHtmlCodeBlock(markdown: string): string | null {
  if (!markdown) return null;
  return pickBestHtmlFence(normalizeMarkdown(markdown))?.html ?? null;
}

export function hasRenderableHtmlInMarkdown(markdown: string): boolean {
  return extractFirstHtmlCodeBlock(markdown) !== null;
}

export type ParsedAssistantContent = {
  /** 是否有 HTML 代码块 */
  hasHtml: boolean;
  /** HTML 代码块之前的文本 */
  before: string;
  /** HTML 代码块原始内容（含 ``` 标记） */
  htmlBlock: string;
  /** HTML 代码块之后的文本 */
  after: string;
};

/**
 * 解析助手回复为三部分，便于聊天区按需渲染可折叠 HTML 代码块。
 */
export function parseAssistantContent(markdown: string): ParsedAssistantContent {
  if (!markdown) return { hasHtml: false, before: "", htmlBlock: "", after: "" };
  const norm = normalizeMarkdown(markdown);
  const picked = pickBestHtmlFence(norm);
  if (!picked) {
    return { hasHtml: false, before: markdown, htmlBlock: "", after: "" };
  }

  const before = norm.slice(0, picked.start).trimEnd();
  const after = norm.slice(picked.end).trimStart();
  // 还原原始标记中的围栏内容（用原始 markdown 提取以保留格式）
  const origFenceMatch = markdown.match(
    /```\s*[^\n\r`]*?\s*\r?\n[\s\S]*?```/
  );
  const htmlBlock = origFenceMatch?.[0] ?? norm.slice(picked.start, picked.end);

  return { hasHtml: true, before, htmlBlock, after };
}

/**
 * 聊天区展示助手回复（旧版：直接删除 HTML 代码块）。
 */
export function assistantChatDisplayText(markdown: string): string {
  if (!markdown) return "";
  const parsed = parseAssistantContent(markdown);
  if (!parsed.hasHtml) return markdown;
  const kept = [parsed.before, parsed.after].filter((s) => s.length > 0).join("\n\n").trim();
  const hint =
    "────────────────────────────────\n" +
    "已生成 **HTML 界面原型**（长代码已在聊天中折叠）。\n" +
    "请点顶部「**预览**」在 iframe 中渲染页面，或点「**代码**」查看 / 导出。";
  return kept ? `${kept}\n\n${hint}` : hint;
}

/**
 * 多轮对话请求上游模型时压缩历史：去掉较早助手消息里的大段 HTML 围栏，仅保留前后文字说明，
 * 避免重复传输完整页面导致 token 爆炸；**不要**对「当前最新一条助手消息」调用本函数。
 */
export function collapseHtmlPrototypeBlock(markdown: string): string {
  if (!markdown) return markdown;
  const norm = normalizeMarkdown(markdown);
  const picked = pickBestHtmlFence(norm);
  if (!picked) return markdown;

  const before = norm.slice(0, picked.start).trimEnd();
  const after = norm.slice(picked.end).trimStart();
  const note =
    "（该轮助手曾输出完整 HTML 原型；大段源码在后续请求中已省略。请结合用户最新要求输出新的完整 html 代码围栏。）";

  const merged = [before, note, after].filter((s) => s.length > 0).join("\n\n").trim();
  return merged || note;
}
