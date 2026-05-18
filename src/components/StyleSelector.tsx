import { Check, Palette } from "lucide-react";
import { STYLE_PRESETS } from "../config/styles";
import type { StylePresetId } from "../config/styles";

type Props = {
  selected: StylePresetId;
  onSelect: (id: StylePresetId) => void;
};

export function StyleSelector({ selected, onSelect }: Props) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-slate-200/70 bg-slate-50/90 px-4 py-2.5 dark:border-slate-800/80 dark:bg-slate-950/80">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
        <Palette className="h-3.5 w-3.5" />
        <span>风格</span>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto py-0.5 scrollbar-thin">
        {STYLE_PRESETS.map((style) => {
          const isActive = style.id === selected;
          return (
            <button
              key={style.id}
              type="button"
              onClick={() => onSelect(style.id)}
              title={`${style.name}：${style.description}`}
              className={`group relative flex shrink-0 items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all ${
                isActive
                  ? "border-sky-400 bg-white text-sky-700 shadow-sm ring-1 ring-sky-200 dark:border-sky-500 dark:bg-slate-900 dark:text-sky-300 dark:ring-sky-500/30"
                  : "border-slate-200/80 bg-white/70 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-800 dark:border-slate-700/80 dark:bg-slate-900/50 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-900 dark:hover:text-slate-200"
              }`}
            >
              {/* 色块条 */}
              <span className="flex h-5 w-5 shrink-0 overflow-hidden rounded-lg ring-1 ring-inset ring-black/5">
                <span
                  className="flex-1"
                  style={{ backgroundColor: style.colors[0] }}
                />
                <span
                  className="flex-1"
                  style={{ backgroundColor: style.colors[1] }}
                />
                <span
                  className="w-1"
                  style={{ backgroundColor: style.accent }}
                />
              </span>

              <span className="whitespace-nowrap">{style.name}</span>

              {isActive && (
                <Check className="h-3.5 w-3.5 shrink-0 text-sky-500" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}