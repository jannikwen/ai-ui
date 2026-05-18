/**
 * 风格预设定义：每种风格包含名称、描述、色板以及给 LLM 的样式指令。
 * 色板用于缩略图展示；指令会注入到 System Prompt 中指导模型按风格输出。
 */

export type StylePresetId =
  | "modern"
  | "dark"
  | "glassmorphism"
  | "neon"
  | "minimal"
  | "vintage"
  | "gradient"
  | "material";

export type StylePreset = {
  id: StylePresetId;
  name: string;
  description: string;
  /** 主色（用于缩略图背景渐变） */
  colors: [string, string];
  /** 强调色 */
  accent: string;
  /** 注入到 System Prompt 的样式指令 */
  instruction: string;
};

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "modern",
    name: "现代简约",
    description: "干净、留白、圆角卡片，适合企业级中后台",
    colors: ["#f8fafc", "#e2e8f0"],
    accent: "#3b82f6",
    instruction:
      "采用现代简约风格：大量留白，白色/浅灰背景，圆角卡片（rounded-2xl），柔和阴影（shadow-sm / shadow-md），主色使用蓝色系（blue-500/600），文字使用 slate-900/600/400 层级，交互元素用蓝色点缀。",
  },
  {
    id: "dark",
    name: "深色模式",
    description: "深色背景 + 高对比文字，适合工具型 / 开发者面板",
    colors: ["#0f172a", "#1e293b"],
    accent: "#38bdf8",
    instruction:
      "采用深色模式风格：深色背景（bg-slate-900 / bg-slate-950），浅色文字（text-slate-100 / text-slate-300），卡片采用半透明白色叠加（bg-white/5）并带边框（border-slate-800），交互元素使用亮蓝或青色（sky-400/500），辅以微妙的发光效果。",
  },
  {
    id: "glassmorphism",
    name: "玻璃拟态",
    description: "毛玻璃背景 + 柔和光影，科技感强",
    colors: ["#0f172a", "#1e1b4b"],
    accent: "#818cf8",
    instruction:
      "采用玻璃拟态（Glassmorphism）风格：深色或紫色渐变背景配径向渐变网点装饰，卡片为半透明白/灰（bg-white/10 backdrop-blur-xl），圆角（rounded-2xl/3xl），边框半透明（border-white/10 border-white/20），阴影柔和发散（shadow-xl shadow-black/10），整体具有「毛玻璃」质感和景深感。",
  },
  {
    id: "neon",
    name: "霓虹赛博",
    description: "高饱和荧光色 + 发光边框，视觉冲击力强",
    colors: ["#0d0221", "#150734"],
    accent: "#f43f5e",
    instruction:
      "采用霓虹赛博风格：深紫黑背景（bg-gray-950），使用高饱和荧光色（粉色 fuchsia-400/500、青色 cyan-400/500、玫红 rose-500），边框和文字带发光效果（shadow-lg shadow-cyan-500/50），直角或微圆角，粗边框（border-2），字体可搭配等宽字体，整体具有赛博朋克视觉风格。",
  },
  {
    id: "minimal",
    name: "极简主义",
    description: "纯白背景、细边框、极少装饰，专注内容",
    colors: ["#ffffff", "#f1f5f9"],
    accent: "#64748b",
    instruction:
      "采用极简主义风格：纯白背景（bg-white），极致留白，细边框（border border-slate-200），极小阴影或无阴影，文字仅用 slate 色系（slate-900/700/400），无渐变无装饰元素，交互元素采用浅灰色背景 hover 效果，整体干净、安静、专注内容。",
  },
  {
    id: "vintage",
    name: "复古暖调",
    description: "暖色系、微肌理、衬线字体点缀，怀旧感",
    colors: ["#fef3c7", "#fde68a"],
    accent: "#d97706",
    instruction:
      "采用复古暖调风格：暖色系背景（amber-50/100），使用暖棕/橙色（amber-600/700 orange-500）作为主色，卡片使用米白/暖白背景配暖色边框（amber-200），圆角较小（rounded-lg），文字使用 warm gray / 棕色系，可使用衬线字体（font-serif）作为标题装饰，整体温暖、怀旧、有质感。",
  },
  {
    id: "gradient",
    name: "渐变炫彩",
    description: "大面积渐变背景，现代品牌感强",
    colors: ["#667eea", "#764ba2"],
    accent: "#a855f7",
    instruction:
      "采用渐变风格：大面积渐变背景（例如 from-indigo-500 via-purple-500 to-pink-500），卡片采用半透明白色背景（bg-white/90）配模糊（backdrop-blur），圆角（rounded-2xl），阴影（shadow-lg），白色或浅色文字，渐变也用于按钮和装饰元素，整体现代、活泼、品牌感强。",
  },
  {
    id: "material",
    name: "Material Design",
    description: "Google Material 风格， elevation 层级清晰",
    colors: ["#f5f5f5", "#e0e0e0"],
    accent: "#6366f1",
    instruction:
      "采用 Material Design 风格：浅灰背景（bg-gray-50/100），白色卡片使用阴影层级（shadow-sm / shadow-md / shadow-lg）表达 elevation，主色使用 indigo 或 blue，圆角中等（rounded-lg），文字层级清晰（headline / body / caption），按钮使用 filled / outlined 样式，遵循 Material 布局规范。",
  },
];

/** 默认风格 ID */
export const DEFAULT_STYLE_ID: StylePresetId = "modern";

export function getStyleById(id: StylePresetId | string): StylePreset {
  return (
    STYLE_PRESETS.find((s) => s.id === id) ??
    STYLE_PRESETS.find((s) => s.id === DEFAULT_STYLE_ID)!
  );
}