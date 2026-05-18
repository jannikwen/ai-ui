import { useEffect, useMemo, useRef } from "react";
import { finalizePrototypeHtml } from "../lib/prepareHtmlForTailwindCdn";

type Props = {
  html: string | null;
  /** 当 iframe 内通过 postMessage 请求导航到其他会话预览页时触发 */
  onNavigate?: (sessionId: string) => void;
};

function hashString(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/**
 * 使用 iframe + srcDoc 在浏览器侧沙箱渲染从 Markdown 中抽取的完整 HTML 文档。
 * 通过 `sandbox` 限制顶层导航等能力，同时允许脚本以支持 Tailwind CDN 等场景。
 * 同时监听 iframe 内 postMessage 导航请求，实现跨会话跳转。
 */
export function PreviewSandbox({ html, onNavigate }: Props) {
  const srcDoc = useMemo(
    () => (html ? finalizePrototypeHtml(html) : ""),
    [html],
  );

  const iframeKey = useMemo(
    () => (srcDoc ? hashString(srcDoc) : "empty"),
    [srcDoc],
  );

  /* 监听 iframe 内 postMessage 导航请求 */
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "navigate" && event.data?.sessionId) {
        onNavigateRef.current?.(event.data.sessionId);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  if (!html) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 text-center text-sm text-slate-500 shadow-inner dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-400">
        <div className="max-w-md space-y-2 px-6">
          <p className="text-base font-semibold text-slate-800 dark:text-slate-100">
            暂无可预览的 HTML
          </p>
          <p className="leading-relaxed">
            请先在对话中生成包含{" "}
            <span className="font-mono text-xs">```html</span> 围栏的完整 HTML；解析成功后在此预览。
            若模型在 <span className="font-mono text-xs">&lt;style&gt;</span> 里写了{" "}
            <span className="font-mono text-xs">@apply</span>，Tailwind CDN 无法编译，预览时会自动剔除这些行以免白屏。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-100 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex items-center justify-between border-b border-slate-200/70 px-4 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span className="font-medium text-slate-700 dark:text-slate-200">
          iframe 沙箱预览
        </span>
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">
          srcDoc · sandbox
        </span>
      </div>
      <div className="relative min-h-0 flex-1 bg-white">
        <iframe
          key={iframeKey}
          title="AI 原型预览"
          className="h-full w-full border-0"
          srcDoc={srcDoc}
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          referrerPolicy="no-referrer"
        />
      </div>
    </div>
  );
}
