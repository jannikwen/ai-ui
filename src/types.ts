export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  /** User-visible text; assistant messages may include Markdown with ```html fences */
  content: string;
  /** Data URLs for images the user attached with this turn */
  imageDataUrls?: string[];
  createdAt: number;
};

export type SubPage = {
  id: string;
  title: string;
  html: string;
  isActive: boolean;
};

export type Session = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
  /** 该会话最新生成的 HTML 原型（独立存储，不随历史消息折叠） */
  lastHtml: string | null;
  /** 从用户消息中自动提取的关键词标签 */
  tags: string[];
  /** 引用的其他会话 ID（该会话的 HTML 会注入到 LLM 上下文中） */
  referenceId: string | null;
  /** 置顶时间戳，null 表示未置顶 */
  pinnedAt: number | null;
  /** 标题是否被用户手动锁定（锁定后不随输入自动更新） */
  titleLocked: boolean;
  /** 该会话下的多个子页面（标签页） */
  subPages: SubPage[];
};

export type MainViewMode = "chat" | "preview" | "code";

/** 编辑模式下选中的 DOM 元素信息 */
export type SelectedElement = {
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  outerHtml: string;
};

/** 单一编辑命令 */
export type EditCommand = {
  action: "setStyle";
  selector: string;
  styles: Record<string, string>;
} | {
  action: "setText";
  selector: string;
  value: string;
} | {
  action: "setAttribute";
  selector: string;
  name: string;
  value: string;
} | {
  action: "replaceClass";
  selector: string;
  oldClass: string;
  newClass: string;
} | {
  action: "setHtml";
  selector: string;
  html: string;
} | {
  action: "addClass";
  selector: string;
  class: string;
} | {
  action: "removeClass";
  selector: string;
  class: string;
} | {
  action: "setOuterHtml";
  selector: string;
  outerHtml: string;
} | {
  action: "addSibling";
  selector: string;
  position: "before" | "after";
  html: string;
};

/** LLM 返回的结构化编辑指令 */
export type EditCommandsResult = {
  commands: EditCommand[];
  explanation?: string;
};

export type { StylePresetId as UIStyleId } from "./config/styles";
