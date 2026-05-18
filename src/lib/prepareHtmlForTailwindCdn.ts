/**
 * Tailwind Play CDN 不会在浏览器里编译自定义 `<style>` 中的 `@apply`，
 * 轻则样式丢失，重则影响后续脚本执行。预览 / 导出前移除含 `@apply` 的规则行，
 * 保留普通 CSS（例如 `.sidebar-item:hover { ... }`）。
 */
export function prepareHtmlForTailwindCdn(html: string): string {
  return html.replace(
    /<style\b([^>]*)>([\s\S]*?)<\/style>/gi,
    (full, attrs: string | undefined, css: string) => {
      if (!/@apply\b/i.test(css)) return full;

      const kept = css
        .split(/\r?\n/)
        .filter((line) => !/@apply\b/.test(line))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      if (!kept) return "";
      return `<style${attrs ?? ""}>${kept}</style>`;
    },
  );
}

function pickTailwindCdnUrl(): string {
  const fromEnv = String(import.meta.env.VITE_TAILWIND_CDN_URL ?? "").trim();
  if (fromEnv) return fromEnv.replace(/"/g, "");
  return "https://cdn.tailwindcss.com";
}

/** 是否已包含 Tailwind 浏览器运行时（Play CDN 或 @tailwindcss/browser） */
export function hasTailwindRuntimeScript(html: string): boolean {
  return /<script[^>]*\bsrc\s*=\s*["'][^"']*(tailwindcss|@tailwindcss\/browser)[^"']*["']/i.test(
    html,
  );
}

const META_SNIPPET = `<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>`;

/**
 * 若文档缺少 Tailwind Play CDN，则向 <head> 注入脚本；无完整文档结构时自动包裹为 HTML5。
 * 解决模型只输出片段、或漏写 `<script src="https://cdn.tailwindcss.com">` 导致「只有纯文字」的问题。
 */
export function ensureTailwindPlayCdn(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return trimmed;

  if (hasTailwindRuntimeScript(trimmed)) {
    return trimmed;
  }

  const src = pickTailwindCdnUrl();
  const script = `<script src="${src}"></script>`;

  if (/<head[^>]*>/i.test(trimmed)) {
    return trimmed.replace(/<head[^>]*>/i, (open) => `${open}\n${META_SNIPPET}\n${script}\n`);
  }

  if (/<html[\s>]/i.test(trimmed)) {
    return trimmed.replace(
      /<html([^>]*)>/i,
      (_m, attrs) => `<html${attrs}><head>${META_SNIPPET}${script}</head>`,
    );
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
${META_SNIPPET}
${script}
</head>
<body class="min-h-screen antialiased">
${trimmed}
</body>
</html>`;
}

/**
 * 预览 / 导出前最终 HTML：先处理 @apply，再保证 Tailwind CDN 与基础文档结构。
 */
export function finalizePrototypeHtml(raw: string): string {
  return ensureTailwindPlayCdn(prepareHtmlForTailwindCdn(raw.trim()));
}
