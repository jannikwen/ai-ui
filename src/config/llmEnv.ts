/**
 * 从 Vite 注入的环境变量读取大模型配置。
 *
 * 注意：任何以 VITE_ 开头的变量都会打进前端包，浏览器可见。
 * 生产环境请用后端转发请求，不要把长期有效的 Key 写进纯前端。
 */
export function getLlmEnv() {
  const apiBase = (import.meta.env.VITE_LLM_API_BASE ?? "").trim().replace(/\/+$/, "");
  const apiKey = (import.meta.env.VITE_LLM_API_KEY ?? "").trim();
  const model = (import.meta.env.VITE_LLM_MODEL ?? "gpt-4o-mini").trim();

  return {
    apiBase,
    apiKey,
    model,
    /** 同时配置了地址与 Key 时走真实请求，否则使用 Mock */
    useRealApi: Boolean(apiBase && apiKey),
  };
}
