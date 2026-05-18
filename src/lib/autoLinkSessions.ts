/**
 * 自动跨会话链接：当新原型生成时，直接在 HTML 底部注入指向其他会话的导航按钮。
 * 不经过 LLM，不修改其他已有会话的页面。
 */

export type SessionLinkInfo = {
  id: string;
  title: string;
  html: string;
};

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&" + "amp;")
    .replace(/"/g, "&" + "quot;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;");
}

/**
 * 直接在当前页面的 HTML 底部注入指向其他页面的导航按钮。
 * 只修改当前页面，不触碰其他页面，不调用 LLM。
 */
export function injectNavLinksToNewPage(
  newSessionId: string,
  allSessions: SessionLinkInfo[],
): string {
  const current = allSessions.find((s) => s.id === newSessionId);
  if (!current) return "";

  const others = allSessions.filter((s) => s.id !== newSessionId);
  if (others.length === 0) return current.html;

  const navBar = `
<!-- 跨会话导航（自动生成） -->
<nav style="position:fixed;bottom:0;left:0;right:0;z-index:9999;background:rgba(255,255,255,0.96);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-top:1px solid #e5e7eb;padding:10px 16px;display:flex;align-items:center;gap:8px;justify-content:center;flex-wrap:wrap;font-family:system-ui,-apple-system,sans-serif;">
  <span style="font-size:12px;color:#6b7280;margin-right:4px;flex-shrink:0;">导航到其他原型：</span>
  ${others
    .map(
      (o) =>
        `<button onclick="window.parent.postMessage({type:'navigate',sessionId:'${escapeHtmlAttr(o.id)}'},'*')" style="padding:5px 14px;border-radius:999px;border:1px solid #d1d5db;background:#f9fafb;color:#374151;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap;transition:all .15s;" onmouseover="this.style.background='#e5e7eb';this.style.borderColor='#9ca3af'" onmouseout="this.style.background='#f9fafb';this.style.borderColor='#d1d5db'">${escapeHtmlAttr(o.title)}</button>`,
    )
    .join("")}
</nav>
<!-- /跨会话导航 -->`;

  const bodyCloseRegex = /<\/body\s*>/i;
  if (bodyCloseRegex.test(current.html)) {
    return current.html.replace(bodyCloseRegex, `${navBar}\n</body>`);
  }
  return current.html + `\n${navBar}`;
}