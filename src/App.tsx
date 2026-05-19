import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatArea } from "./components/ChatArea";
import { InputBox } from "./components/InputBox";
import { Sidebar } from "./components/Sidebar";
import { StyleSelector } from "./components/StyleSelector";
import { ElementEditPanel } from "./components/ElementEditPanel";
import { chatWithLLM, chatWithLLMStream } from "./lib/chatWithLLM";
import { extractFirstHtmlCodeBlock } from "./lib/extractHtmlFromMarkdown";
import { extractTagsFromMessages } from "./lib/extractTags";
import { finalizePrototypeHtml } from "./lib/prepareHtmlForTailwindCdn";
import { injectNavLinksToNewPage } from "./lib/autoLinkSessions";
import type { ChatMessage, MainViewMode, SelectedElement, Session } from "./types";
import type { StylePresetId } from "./config/styles";
import { DEFAULT_STYLE_ID } from "./config/styles";

function newId() {
  return crypto.randomUUID();
}

function createSession(title = "新原型会话"): Session {
  const now = Date.now();
  return {
    id: newId(),
    title,
    updatedAt: now,
    messages: [],
    lastHtml: null,
    tags: [],
    referenceId: null,
    pinnedAt: null,
    titleLocked: false,
    subPages: [],
  };
}

export default function App() {
  const seed = useRef<Session | null>(null);
  if (!seed.current) {
    seed.current = createSession();
  }

  const [sessions, setSessions] = useState<Session[]>(() => [seed.current!]);
  const [activeId, setActiveId] = useState(() => seed.current!.id);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<MainViewMode>("chat");
  const [isSending, setIsSending] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<StylePresetId>(DEFAULT_STYLE_ID);
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [editMode, setEditMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const resumeParamsRef = useRef<{ text: string; images: string[]; refId: string | null } | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add("dark");
    else root.classList.remove("dark");
  }, [dark]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? sessions[0]!,
    [sessions, activeId],
  );

  /** 每个会话独立存储最新生成的 HTML */
  const extractedHtml = activeSession.lastHtml;

  const upsertSession = (id: string, fn: (s: Session) => Session) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));
  };

  const onNewSession = () => {
    const s = createSession();
    setSessions((prev) => {
      const pinCount = prev.filter((x) => x.pinnedAt !== null).length;
      const copy = [...prev];
      copy.splice(pinCount, 0, s);
      return copy;
    });
    setActiveId(s.id);
    setViewMode("chat");
  };

  const onDeleteSession = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) {
        const fresh = createSession();
        return [fresh];
      }
      return next;
    });
    setActiveId((prevActive) => {
      const exists = sessions.find((s) => s.id === prevActive);
      if (!exists || prevActive === id) {
        return sessions.find((s) => s.id !== id)?.id ?? newId();
      }
      return prevActive;
    });
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [sessions]);

  const onReorderSessions = useCallback((orderedIds: string[]) => {
    setSessions((prev) => {
      const map = new Map(prev.map((s) => [s.id, s]));
      // 只重排非置顶会话
      const pinned = prev.filter((s) => s.pinnedAt !== null);
      const pinnedIds = new Set(pinned.map((s) => s.id));
      const reordered = orderedIds
        .filter((id) => !pinnedIds.has(id))
        .map((id) => map.get(id)!)
        .filter(Boolean);
      // 置顶的放最前面
      return [...pinned, ...reordered];
    });
  }, []);

  const onTogglePin = useCallback((id: string) => {
    setSessions((prev) => {
      const s = prev.find((x) => x.id === id);
      if (!s) return prev;
      if (s.pinnedAt !== null) {
        return prev.map((x) =>
          x.id === id ? { ...x, pinnedAt: null } : x,
        );
      }
      return prev.map((x) =>
        x.id === id ? { ...x, pinnedAt: Date.now() } : x,
      );
    });
  }, []);

  const onRenameSession = useCallback((id: string, newTitle: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, title: newTitle.trim() || s.title, titleLocked: true, updatedAt: Date.now() }
          : s,
      ),
    );
  }, []);

  /** 排序：置顶排在前面（按置顶时间倒序），其余按原顺序 */
  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      if (a.pinnedAt !== null && b.pinnedAt !== null) return b.pinnedAt - a.pinnedAt;
      if (a.pinnedAt !== null) return -1;
      if (b.pinnedAt !== null) return 1;
      return 0;
    });
  }, [sessions]);

  /** 点击会话：如果有 HTML 则优先显示预览 */
  const onSelectSession = (id: string) => {
    setActiveId(id);
    const target = sessions.find((s) => s.id === id);
    if (target?.lastHtml) {
      setViewMode("preview");
    } else {
      setViewMode("chat");
    }
  };

  const onPreviewNavigate = (sessionId: string) => {
    setActiveId(sessionId);
    setViewMode("preview");
  };

  /* ── 钩选 ── */
  const onToggleCheck = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /* ── 导入 HTML 文件 ── */
  const onImportFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportFiles = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files?.length) return;
      const fileList = Array.from(files);

      // 清除 input value，允许重复选择同一文件
      e.target.value = "";

      let completed = 0;
      const total = fileList.length;
      const newSessions: Session[] = [];
      const errors: string[] = [];

      for (const file of fileList) {
        const reader = new FileReader();

        reader.onload = () => {
          const html = String(reader.result ?? "");
          if (!html.trim()) {
            errors.push(`文件 ${file.name} 内容为空，已跳过`);
            completed++;
            checkDone();
            return;
          }

          const name =
            file.name.replace(/\.html$/i, "").trim() || "导入原型";
          const now = Date.now();
          const s: Session = {
            id: newId(),
            title: name,
            updatedAt: now,
            messages: [
              {
                id: newId(),
                role: "user" as const,
                content: `导入原型文件：${file.name}`,
                createdAt: now,
              },
              {
                id: newId(),
                role: "assistant" as const,
                content: `已导入原型文件。\n\n\`\`\`html\n${html}\n\`\`\``,
                createdAt: now + 1,
              },
            ],
            lastHtml: html,
            tags: extractTagsFromMessages([
              { role: "user" as const, content: name },
            ]),
            referenceId: null,
            pinnedAt: null,
            titleLocked: false,
            subPages: [],
          };
          newSessions.push(s);
          completed++;
          checkDone();
        };

        reader.onerror = () => {
          errors.push(`读取文件 ${file.name} 失败（可能编码不受支持，请使用 UTF-8 编码）`);
          completed++;
          checkDone();
        };

        reader.readAsText(file, "UTF-8");
      }

      function checkDone() {
        if (completed < total) return;
        if (errors.length > 0) {
          setActiveId(() => {
            // 用一个新的临时会话展示导入错误信息
            const errorSession: Session = {
              id: newId(),
              title: "导入报告",
              updatedAt: Date.now(),
              messages: [
                {
                  id: newId(),
                  role: "assistant" as const,
                  content: `**导入完成**\n\n成功导入 ${newSessions.length} 个文件。\n\n${errors.length > 0 ? `以下文件导入失败：\n${errors.map((e) => `- ${e}`).join("\n")}` : ""}`,
                  createdAt: Date.now(),
                },
              ],
              lastHtml: null,
              tags: [],
              referenceId: null,
              pinnedAt: null,
              titleLocked: false,
              subPages: [],
            };
            setSessions((prev) =>
              newSessions.length > 0
                ? [...newSessions, errorSession, ...prev]
                : [errorSession, ...prev],
            );
            return errorSession.id;
          });
        } else if (newSessions.length > 0) {
          setSessions((prev) => [...newSessions, ...prev]);
          // 展示导入结果
          setActiveId(newSessions[newSessions.length - 1].id);
        }
      }
    },
    [],
  );

  /* ── 单个会话导出 ── */
  const exportSingle = useCallback((s: Session) => {
    const out = finalizePrototypeHtml(s.lastHtml!);
    const blob = new Blob([out], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (s.title || "原型") + ".html";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  /* ── 批量导出 ── */
  const onBatchExport = useCallback(() => {
    const checked = sessions.filter((s) => checkedIds.has(s.id) && s.lastHtml);
    if (checked.length === 0) {
      alert("请勾选至少一个包含原型页面的会话");
      return;
    }
    if (checked.length === 1) {
      exportSingle(checked[0]!);
      return;
    }
    // 多个导出：生成一个包含所有 HTML 的索引页面
    const parts = checked.map((s) => {
      const html = finalizePrototypeHtml(s.lastHtml!);
      const escapedHtml = html.replace(/"/g, "&" + "quot;").replace(/\n/g, " ");
      const tagsHtml = s.tags.length
        ? s.tags
            .map(
              (t) =>
                '<span style="display:inline-block;background:#e0f2fe;color:#0369a1;border-radius:12px;padding:2px 10px;font-size:11px;margin-right:4px;">' +
                t +
                "</span>",
            )
            .join("")
        : "";
      return (
        '<section style="margin-bottom:40px;border-bottom:2px dashed #ccc;padding-bottom:20px;">' +
        '<h2 style="font-size:18px;margin-bottom:8px;color:#333;">' +
        s.title +
        "</h2>" +
        '<p style="font-size:12px;color:#999;margin-bottom:12px;">ID: ' +
        s.id +
        " · " +
        new Date(s.updatedAt).toLocaleString("zh-CN") +
        "</p>" +
        (tagsHtml ? '<p style="margin-bottom:8px;">' + tagsHtml + "</p>" : "") +
        '<iframe srcdoc="' +
        escapedHtml +
        '" style="width:100%;height:600px;border:1px solid #e5e7eb;border-radius:8px;"></iframe>' +
        "</section>"
      );
    });

    const indexHtml =
      '<!DOCTYPE html>' +
      '<html lang="zh-CN">' +
      "<head><meta charset=\"UTF-8\"><title>批量导出原型</title>" +
      "<style>body{font-family:sans-serif;max-width:960px;margin:0 auto;padding:20px;color:#333;}h1{font-size:24px;margin-bottom:4px;}p.desc{color:#666;font-size:13px;margin-bottom:20px;}</style></head>" +
      "<body>" +
      "<h1>📦 批量导出原型</h1>" +
      '<p class="desc">共 ' +
      checked.length +
      " 个原型页面 · 生成时间：" +
      new Date().toLocaleString("zh-CN") +
      "</p>" +
      parts.join("\n") +
      "</body></html>";

    const blob = new Blob([indexHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "批量导出原型.html";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [sessions, checkedIds, exportSingle]);

  const onSend = async (text: string, images: string[], refId: string | null) => {
    const sid = activeId;
    const userMsg: ChatMessage = {
      id: newId(),
      role: "user",
      content: text,
      imageDataUrls: images.length ? images : undefined,
      createdAt: Date.now(),
    };

    // 先插入一条空的助手消息（占位，流式更新）
    const placeholderId = newId();
    const placeholderMsg: ChatMessage = {
      id: placeholderId,
      role: "assistant",
      content: "",
      createdAt: Date.now() + 1,
    };

    const historyForLlm: ChatMessage[] = [...activeSession.messages, userMsg];

    upsertSession(sid, (s) => ({
      ...s,
      title: s.titleLocked
        ? s.title
        : text.trim().slice(0, 40) ||
          (images.length ? `图片附件 · ${images.length}` : s.title),
      updatedAt: Date.now(),
      messages: [...s.messages, userMsg, placeholderMsg],
      tags: extractTagsFromMessages([...s.messages, userMsg]),
    }));

    const controller = new AbortController();
    abortRef.current = controller;
    setIsPaused(false);
    setIsSending(true);
    try {
      const sessionsContext = sessions.map((s) => ({
        id: s.id,
        title: s.title,
        hasHtml: !!s.lastHtml,
      }));

      const refSession = refId ? sessions.find((s) => s.id === refId) : null;
      const refHtml = refSession?.lastHtml ?? null;

      const { content: replyContent, tags: aiTags } = await chatWithLLMStream(
        historyForLlm,
        images,
        selectedStyle,
        sessionsContext,
        refHtml,
        // 每收到一个 token 就更新占位助手消息
        (streamedText) => {
          upsertSession(sid, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === placeholderId ? { ...m, content: streamedText, createdAt: m.createdAt } : m,
            ),
          }));
        },
        controller.signal,
      );

      // 最终写入完整的助手回复
      upsertSession(sid, (s) => ({
        ...s,
        updatedAt: Date.now(),
        tags: aiTags.length > 0 ? aiTags : s.tags,
        messages: s.messages.map((m) =>
          m.id === placeholderId ? { ...m, content: replyContent, createdAt: Date.now() } : m,
        ),
      }));

      const newHtml = extractFirstHtmlCodeBlock(replyContent) ?? null;

      upsertSession(sid, (s) => ({
        ...s,
        lastHtml: newHtml ?? s.lastHtml,
      }));

      const autoPreview =
        String(import.meta.env.VITE_AUTO_PREVIEW ?? "").trim() !== "0";
      if (newHtml && autoPreview) {
        setViewMode("preview");
      }

      // ── 自动添加导航链接到新页面（后台，不阻塞用户） ──
      if (newHtml) {
        const allWithHtml = sessions
          .filter((s) => s.lastHtml)
          .map((s) => ({
            id: s.id,
            title: s.title,
            html: s.id === sid ? newHtml : s.lastHtml!,
          }));

        if (allWithHtml.length > 1) {
          const linkedHtml = injectNavLinksToNewPage(sid, allWithHtml);
          if (linkedHtml !== newHtml) {
            upsertSession(sid, (s) => ({
              ...s,
              lastHtml: linkedHtml,
              updatedAt: Date.now(),
            }));
          }
        }
      }
    } catch (err: any) {
      // 如果是用户主动暂停，不显示错误
      if (err?.name === "AbortError" || isPaused) {
        // 保持已收到的部分内容
      } else {
        throw err;
      }
    } finally {
      if (isPaused) {
        // 暂停状态：不清除 isSending 和 isPaused，等待恢复
        abortRef.current = null;
      } else {
        setIsSending(false);
        setIsPaused(false);
        abortRef.current = null;
        resumeParamsRef.current = null;
      }
    }
  };

  /** 暂停/继续发送 */
  const onTogglePause = useCallback(() => {
    if (isPaused) {
      // 恢复：使用保存的参数重新发送
      const params = resumeParamsRef.current;
      if (params) {
        resumeParamsRef.current = null;
        setIsPaused(false);
        void onSend(params.text, params.images, params.refId);
      }
      return;
    }
    // 暂停：中断当前请求（参数已在 onSend 开头保存）
    setIsPaused(true);
    abortRef.current?.abort();
  }, [isPaused, onSend]);

  /** 编辑模式下选中元素 */
  const handleElementSelect = useCallback((element: SelectedElement) => {
    setSelectedElement(element);
  }, []);

  /** 编辑模式下发送修改请求 */
  const handleEditSend = useCallback(
    async (instruction: string) => {
      if (!activeSession.lastHtml || !selectedElement) return;

      const editPrompt = `【当前页面完整 HTML】
\`\`\`html
${activeSession.lastHtml}
\`\`\`

【用户选中的组件】
标签：${selectedElement.tagName}
CSS 类：${selectedElement.className}
HTML 片段：
\`\`\`html
${selectedElement.outerHtml}
\`\`\`

【修改要求】
${instruction}

请仅修改指定的组件，同时保持页面其他部分不变，输出修改后的**完整 HTML 文档**（含 \`\`\`html 围栏）。`;

      const userMsg: ChatMessage = {
        id: newId(),
        role: "user",
        content: editPrompt,
        createdAt: Date.now(),
      };

      const historyForLlm: ChatMessage[] = [...activeSession.messages, userMsg];

      upsertSession(activeId, (s) => ({
        ...s,
        updatedAt: Date.now(),
        messages: [...s.messages, userMsg],
      }));

      setIsSending(true);
      try {
        const sessionsContext = sessions.map((s) => ({
          id: s.id,
          title: s.title,
          hasHtml: !!s.lastHtml,
        }));

        const { content: replyContent, tags: aiTags } = await chatWithLLM(
          historyForLlm,
          [],
          selectedStyle,
          sessionsContext,
          null,
        );

        const assistant: ChatMessage = {
          id: newId(),
          role: "assistant",
          content: replyContent,
          createdAt: Date.now(),
        };

        upsertSession(activeId, (s) => ({
          ...s,
          updatedAt: Date.now(),
          tags: aiTags.length > 0 ? aiTags : s.tags,
          messages: [...s.messages, assistant],
        }));

        const newHtml = extractFirstHtmlCodeBlock(replyContent) ?? null;
        if (newHtml) {
          upsertSession(activeId, (s) => ({
            ...s,
            lastHtml: newHtml,
          }));
        }

        // 清除选中状态
        setSelectedElement(null);
      } finally {
        setIsSending(false);
      }
    },
    [activeId, activeSession, selectedElement, sessions, selectedStyle, upsertSession],
  );

  return (
    <div className="h-full min-h-0 bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-50">
      <input
        ref={fileInputRef}
        type="file"
        accept=".html,.htm"
        multiple
        className="hidden"
        onChange={handleImportFiles}
      />
      <div className="flex h-full min-h-0 overflow-hidden">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          sessions={sortedSessions}
          activeId={activeSession.id}
          onSelect={onSelectSession}
          onNewSession={onNewSession}
          onDeleteSession={onDeleteSession}
          onReorderSessions={onReorderSessions}
          onTogglePin={onTogglePin}
          onRenameSession={onRenameSession}
          checkedIds={checkedIds}
          onToggleCheck={onToggleCheck}
          onSelectAll={(selectAll: boolean) => {
            if (selectAll) {
              setCheckedIds(new Set(sessions.map((s) => s.id)));
            } else {
              setCheckedIds(new Set());
            }
          }}
          onImportFiles={onImportFiles}
          onBatchExport={onBatchExport}
        />

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <StyleSelector selected={selectedStyle} onSelect={setSelectedStyle} />

          <ChatArea
            busy={isSending}
            messages={activeSession.messages}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            extractedHtml={extractedHtml}
            appDark={dark}
            onToggleTheme={() => setDark((d) => !d)}
            onPreviewNavigate={onPreviewNavigate}
            editMode={editMode}
            onEditModeChange={(enabled) => {
              setEditMode(enabled);
              if (!enabled) setSelectedElement(null);
            }}
            onElementSelect={handleElementSelect}
          />

          <InputBox disabled={isSending && !isPaused} sessions={sessions} isSending={isSending} isPaused={isPaused} onTogglePause={onTogglePause} onSend={onSend} />

          {/* 编辑模式浮动面板 */}
          {editMode && selectedElement && (
            <ElementEditPanel
              element={selectedElement}
              busy={isSending}
              onSend={handleEditSend}
              onClose={() => setSelectedElement(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}