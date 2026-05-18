import { useEffect, useMemo, useRef } from "react";
import hljs from "highlight.js/lib/core";
import xml from "highlight.js/lib/languages/xml";
import { Download } from "lucide-react";
import { finalizePrototypeHtml } from "../lib/prepareHtmlForTailwindCdn";
import "highlight.js/styles/github.css";

hljs.registerLanguage("xml", xml);

type Props = {
  code: string;
  dark: boolean;
};

export function CodePanel({ code, dark }: Props) {
  const preRef = useRef<HTMLPreElement>(null);

  const highlighted = useMemo(() => {
    try {
      return hljs.highlight(code, { language: "xml" }).value;
    } catch {
      return hljs.highlightAuto(code).value;
    }
  }, [code]);

  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = 0;
    }
  }, [code]);

  const onDownload = () => {
    const out = finalizePrototypeHtml(code);
    const blob = new Blob([out], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "index.html";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 px-4 py-3 dark:border-slate-800">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            代码视图
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            高亮展示从 Markdown 中解析出的 HTML 片段
          </p>
        </div>
        <button
          type="button"
          onClick={onDownload}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          <Download className="h-4 w-4" />
          导出代码
        </button>
      </div>
      <pre
        ref={preRef}
        className={`min-h-0 flex-1 overflow-auto p-4 text-[13px] leading-relaxed ${
          dark ? "bg-slate-950" : "bg-slate-50"
        }`}
      >
        <code
          className="hljs language-xml block whitespace-pre rounded-xl"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
}
