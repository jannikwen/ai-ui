import { Bot, Edit3, Moon, Sun, User } from "lucide-react";
import { assistantChatDisplayText } from "../lib/extractHtmlFromMarkdown";
import type { ChatMessage, MainViewMode, SelectedElement } from "../types";
import { PreviewSandbox } from "./PreviewSandbox";
import { CodePanel } from "./CodePanel";

type Props = {
  messages: ChatMessage[];
  viewMode: MainViewMode;
  onViewModeChange: (mode: MainViewMode) => void;
  /** 流式生成中 */
  busy: boolean;
  /** 从最近一条助手消息中解析出的 HTML（用于预览 / 导出） */
  extractedHtml: string | null;
  /** 应用级暗色主题（影响代码面板背景等） */
  appDark: boolean;
  onToggleTheme: () => void;
  /** iframe 内跨会话导航回调 */
  onPreviewNavigate?: (sessionId: string) => void;
  /** 编辑模式开关 */
  editMode: boolean;
  onEditModeChange: (enabled: boolean) => void;
  /** 编辑模式下选中元素的回调 */
  onElementSelect?: (element: SelectedElement) => void;
};

function ModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-50"
          : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
      }`}
    >
      {label}
    </button>
  );
}

export function ChatArea({
  messages,
  viewMode,
  onViewModeChange,
  busy,
  extractedHtml,
  appDark,
  onToggleTheme,
  onPreviewNavigate,
  editMode,
  onEditModeChange,
  onElementSelect,
}: Props) {
  const canInspectPrototype = extractedHtml !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative z-20 flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/70 bg-slate-50 px-4 py-3 dark:border-slate-800/80 dark:bg-slate-950">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            主工作区
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            对话、实时预览与代码导出一体化
          </p>
        </div>
        <div className="flex flex-1 items-center justify-end gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            title={appDark ? "切换到浅色" : "切换到暗色"}
          >
            {appDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          {/* 编辑模式切换按钮 */}
          {viewMode === "preview" && canInspectPrototype && (
            <button
              type="button"
              onClick={() => onEditModeChange(!editMode)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium shadow-sm transition ${
                editMode
                  ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-500/10 dark:text-amber-300"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
              title={editMode ? "退出编辑模式" : "开启编辑模式，点击页面上的组件进行修改"}
            >
              <Edit3 className="h-3.5 w-3.5" />
              {editMode ? "退出编辑" : "编辑"}
            </button>
          )}

          <div
            className={`inline-flex rounded-xl border border-slate-200/80 bg-slate-100/80 p-1 dark:border-slate-800 dark:bg-slate-900/80 ${
              canInspectPrototype ? "" : "pointer-events-none opacity-40"
            }`}
            title={
              canInspectPrototype
                ? "在聊天、预览与代码视图之间切换"
                : "生成包含 ```html 代码块的回复后可切换"
            }
          >
            <ModeButton
              active={viewMode === "chat"}
              label="聊天"
              onClick={() => onViewModeChange("chat")}
            />
            <ModeButton
              active={viewMode === "preview"}
              label="预览"
              onClick={() => onViewModeChange("preview")}
            />
            <ModeButton
              active={viewMode === "code"}
              label="代码"
              onClick={() => onViewModeChange("code")}
            />
          </div>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {viewMode === "preview" && (
          <div className="absolute inset-0 p-4">
            <PreviewSandbox
              html={extractedHtml}
              onNavigate={onPreviewNavigate}
              editMode={editMode}
              onElementSelect={onElementSelect}
            />
          </div>
        )}

        {viewMode === "code" && (
          <div className="absolute inset-0 p-4">
            {extractedHtml ? (
              <CodePanel code={extractedHtml} dark={appDark} />
            ) : (
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-400">
                暂无可导出的 HTML 片段
              </div>
            )}
          </div>
        )}

        {viewMode === "chat" && (
          <div className="absolute inset-0 overflow-y-auto px-4 py-4">
            <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-28">
              {messages.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-6 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-300">
                  <p className="font-medium text-slate-900 dark:text-slate-50">
                    从一个想法开始
                  </p>
                  <p className="mt-2 leading-relaxed">
                    描述你想要的界面，或附上参考截图。生成结果后，可在右上角切换到「预览」在
                    iframe 沙箱中查看，或在「代码」里高亮查看并导出{" "}
                    <span className="font-mono text-xs">index.html</span>。
                  </p>
                </div>
              )}

              {messages.map((m, idx) => (
                <article
                  key={m.id}
                  className={`flex gap-3 ${
                    m.role === "user" ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  <div
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border text-xs font-semibold shadow-sm ${
                      m.role === "user"
                        ? "border-sky-100 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100"
                        : "border-indigo-100 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100"
                    }`}
                  >
                    {m.role === "user" ? (
                      <User className="h-4 w-4" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                  </div>
                  <div
                    className={`max-w-[min(100%,720px)] space-y-3 rounded-2xl border px-4 py-3 text-sm leading-relaxed shadow-sm ${
                      m.role === "user"
                        ? "border-slate-200/80 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50"
                        : "border-slate-200/80 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
                    }`}
                  >
                    {m.role === "user" && m.imageDataUrls && m.imageDataUrls.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {m.imageDataUrls.map((src, idx) => (
                          <img
                            key={`${m.id}-img-${idx}`}
                            src={src}
                            alt={`附件 ${idx + 1}`}
                            className="h-24 w-24 rounded-xl border border-slate-200 object-cover dark:border-slate-700"
                          />
                        ))}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap break-words">
                      {m.role === "assistant"
                        ? assistantChatDisplayText(m.content)
                        : m.content}
                    </div>
                    {busy &&
                      m.role === "assistant" &&
                      idx === messages.length - 1 && (
                        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse rounded-full bg-sky-500 align-text-bottom" />
                      )}
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}