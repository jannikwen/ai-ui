import { useEffect, useMemo, useRef } from "react";
import { finalizePrototypeHtml } from "../lib/prepareHtmlForTailwindCdn";
import type { SelectedElement } from "../types";

type Props = {
  html: string | null;
  /** 当 iframe 内通过 postMessage 请求导航到其他会话预览页时触发 */
  onNavigate?: (sessionId: string) => void;
  /** 是否开启编辑模式（元素选择） */
  editMode: boolean;
  /** 编辑模式下选中元素时的回调 */
  onElementSelect?: (element: SelectedElement) => void;
};

function hashString(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** 注入到 iframe 文档中的元素选择脚本 */
const ELEMENT_PICKER_SCRIPT = `
<script>
(function() {
  if (window.__elementPickerInstalled) return;
  window.__elementPickerInstalled = true;

  var overlay = document.createElement('div');
  overlay.id = '__element-picker-overlay';
  overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:99999;border:2px dashed #3b82f6;background:rgba(59,130,246,0.08);display:none;border-radius:4px;transition:all 0.1s ease;';
  document.body.appendChild(overlay);

  var selectedOverlay = document.createElement('div');
  selectedOverlay.id = '__element-picker-selected';
  selectedOverlay.style.cssText = 'position:fixed;pointer-events:none;z-index:99998;border:2px solid #f97316;background:rgba(249,115,22,0.08);display:none;border-radius:4px;';
  document.body.appendChild(selectedOverlay);

  var selectedEl = null;

  function isVisible(el) {
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    return true;
  }

  function updateOverlay(el) {
    var r = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = r.top + 'px';
    overlay.style.left = r.left + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
  }

  function updateSelectedOverlay(el) {
    var r = el.getBoundingClientRect();
    selectedOverlay.style.display = 'block';
    selectedOverlay.style.top = r.top + 'px';
    selectedOverlay.style.left = r.left + 'px';
    selectedOverlay.style.width = r.width + 'px';
    selectedOverlay.style.height = r.height + 'px';
  }

  function extractElementInfo(el) {
    return {
      tagName: el.tagName.toLowerCase(),
      id: el.id || '',
      className: typeof el.className === 'string' ? el.className : '',
      textContent: (el.textContent || '').trim().slice(0, 100),
      outerHtml: el.outerHTML.slice(0, 2000)
    };
  }

  document.addEventListener('mouseover', function(e) {
    if (!e.target || e.target === document.documentElement || e.target === document.body) return;
    if (e.target.id === '__element-picker-overlay' || e.target.id === '__element-picker-selected') return;
    if (!isVisible(e.target)) { overlay.style.display = 'none'; return; }
    updateOverlay(e.target);
  }, true);

  document.addEventListener('mouseout', function(e) {
    overlay.style.display = 'none';
  }, true);

  document.addEventListener('click', function(e) {
    if (!e.target || e.target === document.documentElement || e.target === document.body) return;
    if (e.target.id === '__element-picker-overlay' || e.target.id === '__element-picker-selected') return;
    if (!isVisible(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    selectedEl = e.target;
    updateSelectedOverlay(selectedEl);
    window.parent.postMessage({
      type: 'element-selected',
      element: extractElementInfo(selectedEl)
    }, '*');
  }, true);

  window.addEventListener('scroll', function() {
    if (selectedEl) updateSelectedOverlay(selectedEl);
  }, true);

  window.addEventListener('resize', function() {
    if (selectedEl) updateSelectedOverlay(selectedEl);
  }, true);
})();
</script>
`;

/** 在 HTML 的 </body> 前注入元素选择脚本 */
function injectPickerScript(html: string): string {
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, ELEMENT_PICKER_SCRIPT + "\n</body>");
  }
  return html + "\n" + ELEMENT_PICKER_SCRIPT;
}

/**
 * 使用 iframe + srcDoc 在浏览器侧沙箱渲染从 Markdown 中抽取的完整 HTML 文档。
 * 通过 `sandbox` 限制顶层导航等能力，同时允许脚本以支持 Tailwind CDN 等场景。
 * 同时监听 iframe 内 postMessage 导航请求，实现跨会话跳转。
 * 编辑模式下可悬停/点击选中页面元素。
 */
export function PreviewSandbox({ html, onNavigate, editMode, onElementSelect }: Props) {
  const baseSrcDoc = useMemo(
    () => (html ? finalizePrototypeHtml(html) : ""),
    [html],
  );

  /** 编辑模式下注入元素选择脚本 */
  const srcDoc = useMemo(() => {
    if (!baseSrcDoc) return "";
    return editMode ? injectPickerScript(baseSrcDoc) : baseSrcDoc;
  }, [baseSrcDoc, editMode]);

  const iframeKey = useMemo(
    () => (srcDoc ? hashString(srcDoc) : "empty"),
    [srcDoc],
  );

  /* 监听 iframe 内 postMessage 导航请求 */
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const onElementSelectRef = useRef(onElementSelect);
  onElementSelectRef.current = onElementSelect;

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "navigate" && event.data?.sessionId) {
        onNavigateRef.current?.(event.data.sessionId);
      }
      if (event.data?.type === "element-selected" && event.data?.element) {
        onElementSelectRef.current?.(event.data.element);
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
            若模型在 <span className="font-mono text-xs">{"<style>"}</span> 里写了{" "}
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
        <div className="flex items-center gap-2">
          {editMode && (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-300">
              编辑模式 · 点击组件
            </span>
          )}
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">
            srcDoc · sandbox
          </span>
        </div>
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
