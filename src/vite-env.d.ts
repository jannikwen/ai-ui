/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 例如 https://api.openai.com/v1 或自建网关，不要末尾斜杠 */
  readonly VITE_LLM_API_BASE?: string;
  /** Bearer Token，与 OpenAI 兼容接口一致 */
  readonly VITE_LLM_API_KEY?: string;
  /** 模型名，如 gpt-4o、gpt-4o-mini */
  readonly VITE_LLM_MODEL?: string;
  /**
   * 设为 `0` 时：助手返回 HTML 后**不**自动打开「预览」，留在「聊天」；
   * 未设置或非 `0` 时默认自动切到「预览」。
   */
  readonly VITE_AUTO_PREVIEW?: string;
  /**
   * Tailwind Play CDN 脚本地址；国内若 cdn.tailwindcss.com 不可达，可换可访问的镜像 URL。
   */
  readonly VITE_TAILWIND_CDN_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
