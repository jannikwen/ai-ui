import { useCallback, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  GripVertical,
  LayoutDashboard,
  Pin,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import type { Session } from "../types";

type Props = {
  collapsed: boolean;
  onToggleCollapse: () => void;
  sessions: Session[];
  activeId: string;
  onSelect: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onReorderSessions: (orderedIds: string[]) => void;
  onTogglePin: (id: string) => void;
  onRenameSession: (id: string, newTitle: string) => void;
  checkedIds: Set<string>;
  onToggleCheck: (id: string) => void;
  onSelectAll: (selectAll: boolean) => void;
  onImportFiles: () => void;
  onBatchExport: () => void;
};

function formatTime(ts: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

/** 缩短会话 ID 显示 */
function shortId(id: string): string {
  return id.slice(0, 8);
}

export function Sidebar({
  collapsed,
  onToggleCollapse,
  sessions,
  activeId,
  onSelect,
  onNewSession,
  onDeleteSession,
  onReorderSessions,
  onTogglePin,
  onRenameSession,
  checkedIds,
  onToggleCheck,
  onSelectAll,
  onImportFiles,
  onBatchExport,
}: Props) {
  /* ── 复制反馈状态 ── */
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  const startEditing = useCallback((id: string, currentTitle: string) => {
    setEditingId(id);
    setEditingTitle(currentTitle);
    // focus after render
    requestAnimationFrame(() => editInputRef.current?.select());
  }, []);

  const finishEditing = useCallback(() => {
    if (editingId != null && editingTitle.trim()) {
      onRenameSession(editingId, editingTitle.trim());
    }
    setEditingId(null);
    setEditingTitle("");
  }, [editingId, editingTitle, onRenameSession]);


  const copySessionId = useCallback(async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = id;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    }
  }, []);

  /* ── 拖拽排序状态 ── */
  const dragIdx = useRef<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent, idx: number) => {
      dragIdx.current = idx;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(idx));
    },
    [],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, idx: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOverIdx(idx);
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, toIdx: number) => {
      e.preventDefault();
      const from = dragIdx.current;
      setOverIdx(null);
      dragIdx.current = null;
      if (from === null || from === toIdx) return;

      const ids = sessions.map((s) => s.id);
      const [moved] = ids.splice(from, 1);
      ids.splice(toIdx, 0, moved!);
      onReorderSessions(ids);
    },
    [sessions, onReorderSessions],
  );

  const handleDragEnd = useCallback(() => {
    dragIdx.current = null;
    setOverIdx(null);
  }, []);

  const allChecked = sessions.length > 0 && sessions.every((s) => checkedIds.has(s.id));

  return (
    <aside
      className={`relative flex h-full shrink-0 flex-col border-r border-slate-200/80 bg-white/80 backdrop-blur-md transition-[width] duration-200 ease-out dark:border-slate-800/80 dark:bg-slate-950/70 ${
        collapsed ? "w-16" : "w-[min(24vw,320px)] min-w-[240px]"
      }`}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/70 px-3 py-3 dark:border-slate-800/80">
        {!collapsed && (
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-xs font-bold text-white shadow-md shadow-sky-500/30">
              UI
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                原型工作台
              </p>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                AI 驱动 · 安全预览
              </p>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          title={collapsed ? "展开侧栏" : "收起侧栏"}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* ── New Session Button ── */}
      <div className="p-3">
        <button
          type="button"
          onClick={onNewSession}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-medium text-white shadow-md shadow-slate-900/25 transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          title="新建原型"
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span>新建原型</span>
        </button>
      </div>

      {/* ── 导入 / 导出 操作栏 ── */}
      {!collapsed && (
        <div className="flex items-center gap-2 border-b border-slate-200/70 px-3 py-2 dark:border-slate-800/80">
          <button
            type="button"
            onClick={onImportFiles}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 transition hover:border-sky-300 hover:text-sky-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-sky-600 dark:hover:text-sky-400"
            title="导入 HTML 文件"
          >
            <Upload className="h-3.5 w-3.5" />
            导入
          </button>
          <button
            type="button"
            onClick={onBatchExport}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 transition hover:border-emerald-300 hover:text-emerald-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-emerald-600 dark:hover:text-emerald-400"
            title="批量导出已勾选的会话"
          >
            <Download className="h-3.5 w-3.5" />
            导出 ({checkedIds.size})
          </button>
        </div>
      )}

      {/* ── Session List ── */}
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {!collapsed && (
          <div className="mb-2 flex items-center justify-between px-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              会话列表（{sessions.length}）
            </p>
            {/* 全选 / 取消全选 */}
            {sessions.length > 0 && (
              <button
                type="button"
                onClick={() => onSelectAll(!allChecked)}
                className="text-[10px] text-slate-400 hover:text-sky-600 dark:text-slate-500 dark:hover:text-sky-400"
              >
                {allChecked ? "取消全选" : "全选"}
              </button>
            )}
          </div>
        )}
        <ul className="space-y-1">
          {sessions.map((s, idx) => {
            const active = s.id === activeId;
            const isOver = overIdx === idx;
            const checked = checkedIds.has(s.id);

            return (
              <li
                key={s.id}
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
                className={`group relative rounded-xl transition-all ${
                  isOver ? "scale-[1.02] ring-2 ring-sky-400" : ""
                }`}
              >
                <div
                  className={`flex items-start gap-1.5 rounded-xl px-2 py-2 transition ${
                    active
                      ? "bg-sky-50 text-sky-900 ring-1 ring-sky-100 dark:bg-sky-500/10 dark:text-sky-50 dark:ring-sky-500/30"
                      : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900/80"
                  }`}
                >
                  {/* 置顶按钮 */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePin(s.id);
                    }}
                    className={`mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded transition ${
                      s.pinnedAt
                        ? "text-sky-500"
                        : "text-slate-300 opacity-0 group-hover:opacity-60 hover:text-sky-400 dark:text-slate-600"
                    }`}
                    title={s.pinnedAt ? "取消置顶" : "置顶"}
                  >
                    <Pin className={`h-3 w-3 ${s.pinnedAt ? "fill-sky-500" : ""}`} />
                  </button>

                  {/* 钩选按钮 */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleCheck(s.id);
                    }}
                    className={`mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                      checked
                        ? "border-sky-500 bg-sky-500 text-white"
                        : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800"
                    }`}
                    title={checked ? "取消勾选" : "勾选用于导出"}
                  >
                    {checked && (
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m5 12 5 5L20 7"/></svg>
                    )}
                  </button>

                  {/* 拖拽手柄 */}
                  <button
                    type="button"
                    className="mt-0.5 inline-flex h-6 w-4 shrink-0 cursor-grab items-center justify-center rounded text-slate-300 opacity-0 transition hover:text-slate-500 group-hover:opacity-100 dark:text-slate-600 dark:hover:text-slate-400"
                    title="拖拽排序"
                    onMouseDown={(e) => {
                      (e.currentTarget.closest("li") as HTMLElement)?.setAttribute(
                        "draggable",
                        "true",
                      );
                    }}
                  >
                    <GripVertical className="h-3.5 w-3.5" />
                  </button>

                  {/* 主内容 */}
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    className="flex min-w-0 flex-1 flex-col items-start text-left"
                  >
                      {/* 标题行 */}
                      <span className="flex w-full items-center gap-1.5">
                        <LayoutDashboard className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
                        {editingId === s.id ? (
                          <input
                            ref={editInputRef}
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onBlur={finishEditing}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Enter") finishEditing();
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="min-w-0 flex-1 rounded bg-white px-1.5 py-0.5 text-sm font-medium leading-snug text-slate-900 outline-none ring-2 ring-sky-400 dark:bg-slate-800 dark:text-slate-100"
                            autoFocus
                          />
                        ) : (
                          <span
                            className="min-w-0 flex-1 truncate text-sm font-medium leading-snug cursor-text"
                            title="双击重命名"
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              startEditing(s.id, s.title);
                            }}
                          >
                            {s.title}
                            {s.titleLocked && (
                              <span className="ml-1 text-[9px] text-slate-400 group-hover:inline hidden">🔒</span>
                            )}
                          </span>
                        )}
                      {s.lastHtml && (
                        <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                          原型
                        </span>
                      )}
                    </span>

                    {/* ID + 时间 */}
                    <span className="mt-0.5 flex w-full items-center gap-2 px-0.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          copySessionId(s.id);
                        }}
                        className="group/copy inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 transition hover:bg-sky-100 hover:text-sky-600 dark:bg-slate-800 dark:text-slate-500 dark:hover:bg-sky-500/10 dark:hover:text-sky-400"
                        title="点击复制完整会话 ID"
                      >
                        {copiedId === s.id ? "已复制!" : shortId(s.id)}
                        <Copy className="h-3 w-3 opacity-0 transition group-hover/copy:opacity-60" />
                      </button>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">
                        {formatTime(s.updatedAt)}
                      </span>
                    </span>

                    {/* 标签 */}
                    {s.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1 px-0.5">
                        {s.tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center rounded-full bg-sky-100/70 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>

                  {/* 删除按钮 */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(s.id);
                    }}
                    className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:text-slate-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                    title="删除会话"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}