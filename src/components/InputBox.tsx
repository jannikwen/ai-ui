import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Paperclip, SendHorizontal, X } from "lucide-react";
import type { Session } from "../types";

export type PendingImage = {
  id: string;
  dataUrl: string;
};

type Props = {
  disabled: boolean;
  sessions: Session[];
  onSend: (text: string, images: string[], refId: string | null) => void | Promise<void>;
};

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_IMAGES = 6;

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function InputBox({ disabled, sessions, onSend }: Props) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [refId, setRefId] = useState<string | null>(null);
  const [refOpen, setRefOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 200);
    el.style.height = `${Math.max(next, 44)}px`;
  }, [text]);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const incoming = Array.from(list).filter((f) => f.type.startsWith("image/"));

    setImages((prev) => {
      const room = MAX_IMAGES - prev.length;
      if (room <= 0) {
        window.alert(`最多只能添加 ${MAX_IMAGES} 张图片。`);
        return prev;
      }

      const toRead = incoming.slice(0, room);
      for (const file of toRead) {
        if (file.size > MAX_IMAGE_BYTES) {
          window.alert(`图片「${file.name}」超过 6MB，已跳过。`);
          continue;
        }
        const id = crypto.randomUUID();
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result || "");
          if (!dataUrl.startsWith("data:image/")) return;
          setImages((cur) => {
            if (cur.length >= MAX_IMAGES) return cur;
            if (cur.some((i) => i.id === id)) return cur;
            return [...cur, { id, dataUrl }];
          });
        };
        reader.onerror = () => {
          window.alert(`读取「${file.name}」失败，请重试。`);
        };
        reader.readAsDataURL(file);
      }

      return prev;
    });

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((i) => i.id !== id));
  };

  const submit = async () => {
    const trimmed = text.trim();
    const urls = images.map((i) => i.dataUrl);
    if (!trimmed && urls.length === 0) return;
    if (disabled || busy) return;
    setBusy(true);
    try {
      await onSend(trimmed, urls, refId);
      setText("");
      setImages([]);
      setRefId(null);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  /** 可被引用的会话（有 HTML 原型且非空） */
  const referableSessions = sessions.filter((s) => s.lastHtml);

  const refSession = refId ? sessions.find((s) => s.id === refId) : null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-4 pb-4 pt-10">
      <div className="pointer-events-auto w-full max-w-3xl rounded-2xl border border-slate-200/80 bg-white/95 p-3 shadow-float backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/90 dark:shadow-float-dark">
        {images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {images.map((img) => (
              <div
                key={img.id}
                className="relative h-16 w-16 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
              >
                <img
                  src={img.dataUrl}
                  alt="附件缩略图"
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(img.id)}
                  className="absolute right-0.5 top-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
                  aria-label="移除图片"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
          <button
            type="button"
            disabled={disabled || busy || images.length >= MAX_IMAGES}
            onClick={() => fileInputRef.current?.click()}
            className="mb-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            title="添加图片附件"
          >
            <Paperclip className="h-4 w-4" />
          </button>

          {/* 引用原型下拉选择 */}
          {referableSessions.length > 0 && (
            <div className="relative mb-1">
              <button
                ref={refButtonRef}
                type="button"
                onClick={() => setRefOpen((v) => !v)}
                disabled={disabled || busy}
                className={`inline-flex h-10 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  refId
                    ? "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-600 dark:bg-sky-500/10 dark:text-sky-300"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200"
                }`}
                title="选择要引用的原型页面"
              >
                {refSession ? (
                  <>
                    <span className="max-w-[80px] truncate">{refSession.title}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRefId(null);
                        setRefOpen(false);
                      }}
                      className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-sky-200/60 dark:hover:bg-sky-500/20"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <>
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    <span>引用</span>
                  </>
                )}
              </button>

              {refOpen && (
                <div
                  className="absolute bottom-full left-0 z-50 mb-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    选择要引用的原型
                  </p>
                  {referableSessions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setRefId(s.id);
                        setRefOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition hover:bg-sky-50 dark:hover:bg-sky-500/10 ${
                        refId === s.id
                          ? "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
                          : "text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{s.title}</span>
                      <code className="shrink-0 text-[9px] text-slate-400">{shortId(s.id)}</code>
                      {s.tags.length > 0 && (
                        <span className="shrink-0 rounded-full bg-sky-100/60 px-1.5 py-0.5 text-[9px] text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">
                          {s.tags[0]}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="描述你想要的界面，例如：「参考附件，做一个蓝色玻璃拟态登录页」…（Shift+Enter 换行，Enter 发送）"
            disabled={disabled || busy}
            className="max-h-[200px] min-h-[44px] flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 outline-none ring-sky-500/0 transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-50 dark:focus:border-sky-400 dark:focus:ring-sky-500/20"
          />

          <button
            type="button"
            disabled={disabled || busy || (!text.trim() && images.length === 0)}
            onClick={() => void submit()}
            className="mb-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-md shadow-sky-500/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            title="发送"
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