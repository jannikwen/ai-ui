/** Self-contained login page for iframe srcDoc demo (Tailwind CDN). */
export const DEMO_LOGIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>登录 · 原型</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        darkMode: 'class',
        theme: {
          extend: {
            fontFamily: {
              sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
            },
            boxShadow: {
              glass: '0 25px 80px -20px rgba(15, 23, 42, 0.45)',
            },
          },
        },
      };
    </script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
    <style>
      body { font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      .bg-mesh {
        background-color: #0f172a;
        background-image:
          radial-gradient(at 20% 20%, rgba(56, 189, 248, 0.35) 0, transparent 45%),
          radial-gradient(at 80% 0%, rgba(99, 102, 241, 0.45) 0, transparent 40%),
          radial-gradient(at 50% 80%, rgba(236, 72, 153, 0.25) 0, transparent 45%);
      }
    </style>
  </head>
  <body class="bg-mesh min-h-screen flex items-center justify-center p-6 text-slate-900">
    <div
      class="w-full max-w-md rounded-3xl bg-white/90 backdrop-blur-xl shadow-glass border border-white/40 p-8 space-y-6"
    >
      <div class="flex items-center gap-3">
        <div
          class="h-11 w-11 rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white font-semibold shadow-lg shadow-sky-500/30"
        >
          AI
        </div>
        <div>
          <p class="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold">Prototype</p>
          <h1 class="text-xl font-semibold text-slate-900">欢迎回来</h1>
        </div>
      </div>
      <p class="text-sm text-slate-500 leading-relaxed">
        使用工作邮箱登录，体验由 AI 生成的可交互界面原型。
      </p>
      <form class="space-y-4" onsubmit="event.preventDefault();">
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-slate-600">邮箱</label>
          <input
            type="email"
            class="w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm outline-none ring-0 transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            placeholder="you@company.com"
            autocomplete="username"
          />
        </div>
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label class="text-xs font-medium text-slate-600">密码</label>
            <button type="button" class="text-xs font-medium text-sky-600 hover:text-sky-700">
              忘记密码？
            </button>
          </div>
          <input
            type="password"
            class="w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            placeholder="••••••••"
            autocomplete="current-password"
          />
        </div>
        <label class="flex items-center gap-2 text-xs text-slate-600 select-none cursor-pointer">
          <input type="checkbox" class="rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
          记住此设备 30 天
        </label>
        <button
          type="submit"
          class="w-full rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/30 hover:brightness-105 active:scale-[0.99] transition"
        >
          登录
        </button>
      </form>
      <p class="text-center text-xs text-slate-500">
        还没有账号？
        <a href="#" class="font-semibold text-sky-600 hover:text-sky-700">创建组织</a>
      </p>
    </div>
  </body>
</html>`;
