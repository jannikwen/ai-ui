import { X, SendHorizontal, Loader2 } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import type { SelectedElement } from "../types";

type Props = {
  element: SelectedElement;
  busy: boolean;
  onSend: (instruction: string) => void;
  onClose: () => void;
};

export function ElementEditPanel({ element, busy, onSend, onClose }: Props) {
  const [instruction, setInstruction] = useState("");

  const submit = () => {
    const trimmed = instruction.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    setInstruction("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="absolute inset-x-0 bottom-16 z-20 flex justify-center px-4">
      <div className="w-full max-w-3xl rounded-2xl border border-amber-200 bg-white/98 p-4 shadow-lg backdrop-blur-xl dark:border-amber-700 dark:bg-slate-900/98">
        {/* 头部 */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
              编辑选中组件
            </p>
            <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                <code className="rounded bg-sky-100 px-1.5 py-0.5 font-mono font-semibold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                  {"<"}{element.tagName}
                  {element.id ? ` id="${element.id}"` : ""}{">"}
                </code>
                {element.className && (
                  <span className="truncate text-slate-500 dark:text-slate-500">
                    class="{element.className.slice(0, 60)}{element.className.length > 60 ? "…" : ""}"
                  </span>
                )}
                {element.textContent && (
                  <span className="truncate italic text-slate-400 dark:text-slate-500">
                    &ldquo;{element.textContent}&rdquo;
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            title="取消选择"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 输入区 */}
        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="描述如何修改这个组件，例如：「把这个按钮改成红色，加上圆角和阴影」"
            disabled={busy}
            className="max-h-[120px] min-h-[44px] flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 outline-none ring-amber-500/0 transition focus:border-amber-500 focus:ring-2 focus:ring-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-50 dark:focus:border-amber-400 dark:focus:ring-amber-500/20"
          />
          <button
            type="button"
            disabled={busy || !instruction.trim()}
            onClick={submit}
            className="mb-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md shadow-amber-500/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            title="发送修改"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SendHorizontal className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}