import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatArea } from "./components/ChatArea";
import { InputBox } from "./components/InputBox";
import { Sidebar } from "./components/Sidebar";
import { StyleSelector } from "./components/StyleSelector";
import { ElementEditPanel } from "./components/ElementEditPanel";
import { chatWithLLM, chatWithLLMForEditStream, chatWithLLMStream } from "./lib/chatWithLLM";
import { extractEditCommands, applyEditCommands, generateEditExplanation } from "./lib/applyEditCommands";
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
  const editAbortRef = useRef<AbortController | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  /** 编辑模式 JSON 解析失败时的弹窗状态 */
  const [editJsonError, setEditJsonError] = useState<{
    rawReply: string;
    instruction: string;
    placeholderId: string;
  } | null>(null);

  /** 暂停后恢复续传所需的核心上下文，按会话 ID 独立存储 */
  const streamContextMapRef = useRef<
    Map<
      string,
      {
        sid: string;
        historyForLlm: ChatMessage[];
        images: string[];
        sessionsContext: { id: string; title: string; hasHtml: boolean }[];
        refHtml: string | null;
        placeholderId: string;
      }
    >
  >(new Map());

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
    const target = sessions.find((s) => s.id === sessionId);
    if (!target?.lastHtml) return; // 目标会话不存在或无 HTML，不做跳转
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

  /** 执行流式请求（首次发送 & 恢复续传共用）
   *  @param resumeFrom - 恢复续传时传入已生成的部分内容，流式回调会在此内容后追加新文本
   */
  const doStream = async (
    sid: string,
    historyForLlm: ChatMessage[],
    images: string[],
    sessionsContext: { id: string; title: string; hasHtml: boolean }[],
    refHtml: string | null,
    placeholderId: string,
    resumeFrom = "",
    resumeMode = false,
  ) => {
    const controller = new AbortController();
    abortRef.current = controller;

    // 保存暂停恢复所需的上下文（按会话 ID 独立存储）
    streamContextMapRef.current.set(sid, {
      sid,
      historyForLlm,
      images,
      sessionsContext,
      refHtml,
      placeholderId,
    });

    setIsSending(true);
    setIsPaused(false);
    isPausedRef.current = false;
    try {
      const { content: replyContent, tags: aiTags } = await chatWithLLMStream(
        historyForLlm,
        images,
        selectedStyle,
        sessionsContext,
        refHtml,
        (streamedText) => {
          upsertSession(sid, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === placeholderId
                ? { ...m, content: resumeFrom + streamedText, createdAt: m.createdAt }
                : m,
            ),
          }));
        },
        controller.signal,
        resumeMode,
      );

      // 最终写入完整的助手回复
      const fullContent = resumeFrom + replyContent;
      upsertSession(sid, (s) => ({
        ...s,
        updatedAt: Date.now(),
        tags: aiTags.length > 0 ? aiTags : s.tags,
        messages: s.messages.map((m) =>
          m.id === placeholderId ? { ...m, content: fullContent, createdAt: Date.now() } : m,
        ),
      }));

      const newHtml = extractFirstHtmlCodeBlock(fullContent) ?? null;

      upsertSession(sid, (s) => ({
        ...s,
        lastHtml: newHtml ?? s.lastHtml,
      }));

      const autoPreview =
        String(import.meta.env.VITE_AUTO_PREVIEW ?? "").trim() !== "0";
      if (newHtml && autoPreview) {
        setViewMode("preview");
      }

      // 自动添加导航链接到新页面
      if (newHtml) {
        const currentSessions = sessions; // 在闭包中捕获当前 sessions
        const allWithHtml = currentSessions
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
      if (err?.name === "AbortError" || isPausedRef.current) {
        // 用户主动暂停，保持已收到的部分内容
      } else {
        throw err;
      }
    } finally {
      if (isPausedRef.current) {
        // 暂停状态：不清除 isSending 和 isPaused，等待恢复
        abortRef.current = null;
      } else {
        setIsSending(false);
        setIsPaused(false);
        isPausedRef.current = false;
        abortRef.current = null;
        streamContextMapRef.current.delete(sid);
      }
    }
  };

  const onSend = async (text: string, images: string[], refId: string | null) => {
    const sid = activeId;
    const userMsg: ChatMessage = {
      id: newId(),
      role: "user",
      content: text,
      imageDataUrls: images.length ? images : undefined,
      createdAt: Date.now(),
    };

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

    const sessionsContext = sessions.map((s) => ({
      id: s.id,
      title: s.title,
      hasHtml: !!s.lastHtml,
    }));

    const refSession = refId ? sessions.find((s) => s.id === refId) : null;
    const refHtml = refSession?.lastHtml ?? null;

    await doStream(sid, historyForLlm, images, sessionsContext, refHtml, placeholderId);
  };

  /** 暂停/继续发送 */
  const onTogglePause = useCallback(() => {
    if (isPaused) {
      // 恢复：按当前活跃会话获取独立的上下文
      const ctx = streamContextMapRef.current.get(activeId);
      if (!ctx) return;
      streamContextMapRef.current.delete(activeId);

      const currentSession = sessionsRef.current.find((s) => s.id === ctx.sid);
      const placeholderMsg = currentSession?.messages.find((m) => m.id === ctx.placeholderId);
      const partialContent = placeholderMsg?.content?.trim() || "";

      // 把已生成内容作为 assistant 消息插入历史，再加简短续写指令
      // 这样不会触发 system prompt 的"用户给出原型就生成 HTML"逻辑
      const historyForLlm: ChatMessage[] = [
        ...ctx.historyForLlm,
        {
          id: "__resume_assistant__",
          role: "assistant",
          content: partialContent,
          createdAt: Date.now(),
        },
        {
          id: "__resume_user__",
          role: "user",
          content: "【续写】接上，从断点直接继续。不要打招呼、不解释、不重复已写内容，只输出续写。",
          createdAt: Date.now(),
        },
      ];

      void doStream(
        ctx.sid,
        historyForLlm,
        ctx.images,
        ctx.sessionsContext,
        ctx.refHtml,
        ctx.placeholderId,
        partialContent, // 前端恢复时先拼接已有内容
        true, // resumeMode
      );
      return;
    }
    // 暂停：中断当前请求
    setIsPaused(true);
    isPausedRef.current = true;
    abortRef.current?.abort();
  }, [isPaused]);

  /** 编辑模式下选中元素 */
  const handleElementSelect = useCallback((element: SelectedElement) => {
    setSelectedElement(element);
  }, []);

  /** 编辑模式下停止输出 */
  const handleEditStop = useCallback(() => {
    editAbortRef.current?.abort();
    setIsSending(false);
    setSelectedElement(null);
  }, []);

  /** JSON 解析失败 — 弹窗选项1：全部重新生成（完整 HTML） */
  const handleEditRetryFull = useCallback(async () => {
    if (!editJsonError || !activeSession.lastHtml || !selectedElement) return;

    const { rawReply, instruction, placeholderId } = editJsonError;
    setEditJsonError(null);
    setIsSending(true);

    // 将 LLM 已输出的原始回复附加到占位消息后，作为失败记录
    upsertSession(activeId, (s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.id === placeholderId
          ? { ...m, content: `❌ 修改指令解析失败，正在重新生成完整页面…\n\n原始回复：\n\`\`\`\n${rawReply.slice(0, 500)}\n\`\`\``, createdAt: Date.now() }
          : m,
      ),
    }));

    const newPlaceholderId = newId();
    const newPlaceholderMsg: ChatMessage = {
      id: newPlaceholderId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };

    upsertSession(activeId, (s) => ({
      ...s,
      updatedAt: Date.now(),
      messages: [...s.messages, newPlaceholderMsg],
    }));

    const fallbackPrompt = `【当前页面完整 HTML】
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

    const sessionsContext = sessions.map((s) => ({
      id: s.id,
      title: s.title,
      hasHtml: !!s.lastHtml,
    }));

    const fallbackHistory: ChatMessage[] = [
      ...activeSession.messages.filter((m) => m.id !== placeholderId),
      {
        id: newId(),
        role: "user",
        content: fallbackPrompt,
        createdAt: Date.now(),
      },
    ];

    try {
      const { content: replyContent, tags: aiTags } = await chatWithLLM(
        fallbackHistory,
        [],
        selectedStyle,
        sessionsContext,
        null,
      );

      upsertSession(activeId, (s) => ({
        ...s,
        updatedAt: Date.now(),
        tags: aiTags.length > 0 ? aiTags : s.tags,
        messages: s.messages.map((m) =>
          m.id === newPlaceholderId
            ? { ...m, content: replyContent, createdAt: Date.now() }
            : m,
        ),
      }));

      const newHtml = extractFirstHtmlCodeBlock(replyContent) ?? null;
      if (newHtml) {
        upsertSession(activeId, (s) => ({
          ...s,
          lastHtml: newHtml,
        }));
      }

      setViewMode("preview");
    } catch (err: any) {
      upsertSession(activeId, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === newPlaceholderId
            ? { ...m, content: `⚠️ 重新生成失败：${err.message || "未知错误"}`, createdAt: Date.now() }
            : m,
        ),
      }));
    } finally {
      setIsSending(false);
      setSelectedElement(null);
    }
  }, [editJsonError, activeSession, selectedElement, sessions, selectedStyle, activeId, upsertSession]);

  /** JSON 解析失败 — 弹窗选项2：只重新生成修改方案（重新让 LLM 生成 JSON 命令） */
  const handleEditRetryCommands = useCallback(async () => {
    if (!editJsonError || !activeSession.lastHtml || !selectedElement) return;

    const { rawReply, instruction, placeholderId } = editJsonError;
    setEditJsonError(null);
    setIsSending(true);

    // 将 LLM 已输出的原始回复附加到占位消息后
    upsertSession(activeId, (s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.id === placeholderId
          ? { ...m, content: `⚠️ 修改指令解析失败，正在重新生成修改方案…\n\n原始回复：\n\`\`\`\n${rawReply.slice(0, 500)}\n\`\`\``, createdAt: Date.now() }
          : m,
      ),
    }));

    const newPlaceholderId = newId();
    const newPlaceholderMsg: ChatMessage = {
      id: newPlaceholderId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };

    upsertSession(activeId, (s) => ({
      ...s,
      updatedAt: Date.now(),
      messages: [...s.messages, newPlaceholderMsg],
    }));

    const retryPrompt = `【当前页面完整 HTML】
\`\`\`html
${activeSession.lastHtml}
\`\`\`

【用户选中的组件】
标签：${selectedElement.tagName}
CSS 类：${selectedElement.className}
HTML 片段（用于提取选择器）：
\`\`\`html
${selectedElement.outerHtml}
\`\`\`

【修改要求】
${instruction}

【重要】你上次返回的 JSON 格式有误无法解析，请严格按照以下 JSON 格式返回编辑命令，且只需返回 JSON，不要任何额外文字。
返回格式：
\`\`\`json
{
  "commands": [
    {
      "action": "操作类型",
      "selector": "CSS选择器",
      ...
    }
  ],
  "explanation": "简要说明"
}
\`\`\`

可用的 action 及参数：
- addSibling: { "action": "addSibling", "selector": "CSS选择器", "position": "after|before", "html": "新增的HTML" }
- setOuterHtml: { "action": "setOuterHtml", "selector": "CSS选择器", "outerHtml": "完整的替换HTML" }
- setStyle: { "action": "setStyle", "selector": "CSS选择器", "styles": { "color": "red" } }
- setText: { "action": "setText", "selector": "CSS选择器", "value": "新文本" }
- setAttribute: { "action": "setAttribute", "selector": "CSS选择器", "name": "属性名", "value": "属性值" }
- replaceClass: { "action": "replaceClass", "selector": "CSS选择器", "oldClass": "旧类名", "newClass": "新类名" }
- addClass: { "action": "addClass", "selector": "CSS选择器", "class": "类名" }
- removeClass: { "action": "removeClass", "selector": "CSS选择器", "class": "类名" }
- setHtml: { "action": "setHtml", "selector": "CSS选择器", "html": "新的内部HTML" }

【关键规则】
1. JSON 中 html/outerHtml 字段内若包含 HTML 属性双引号，必须转义为 \\"，否则 JSON 解析会失败。
   正确示例：{"html": "<div class=\\"btn\\">文本</div>"}
2. 选择器尽量简单可靠，优先使用 .class 或 #id，避免复杂的伪类选择器。`;

    const controller = new AbortController();
    editAbortRef.current = controller;

    try {
      const rawReply2 = await chatWithLLMForEditStream(
        activeSession.lastHtml,
        selectedElement,
        retryPrompt,
        (streamedText) => {
          upsertSession(activeId, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === newPlaceholderId
                ? { ...m, content: streamedText }
                : m,
            ),
          }));
        },
        controller.signal,
      );

      const commandsResult = extractEditCommands(rawReply2);

      if (commandsResult && commandsResult.commands.length > 0) {
        const newHtml = applyEditCommands(activeSession.lastHtml, commandsResult.commands);

        upsertSession(activeId, (s) => ({
          ...s,
          lastHtml: newHtml,
        }));

        const explanation = commandsResult.explanation ?? generateEditExplanation(commandsResult.commands);
        upsertSession(activeId, (s) => ({
          ...s,
          updatedAt: Date.now(),
          messages: s.messages.map((m) =>
            m.id === newPlaceholderId
              ? { ...m, content: `✅ 已按要求修改组件\n\n${explanation}\n\n\`\`\`json\n${JSON.stringify(commandsResult, null, 2)}\n\`\`\``, createdAt: Date.now() }
              : m,
          ),
        }));
      } else {
        // 再次失败，标记失败
        upsertSession(activeId, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === newPlaceholderId
              ? { ...m, content: `❌ 再次解析修改指令失败，请手动修改或重新提出要求。\n\n原始回复：\n\`\`\`\n${rawReply2.slice(0, 500)}\n\`\`\``, createdAt: Date.now() }
              : m,
          ),
        }));
      }

      setViewMode("preview");
    } catch (err: any) {
      const isAbort = err?.name === "AbortError";
      if (isAbort) {
        upsertSession(activeId, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === newPlaceholderId
              ? { ...m, content: m.content || "⏹ 已停止编辑", createdAt: Date.now() }
              : m,
          ),
        }));
      } else {
        upsertSession(activeId, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === newPlaceholderId
              ? { ...m, content: `⚠️ 重新生成修改方案失败：${err.message || "未知错误"}`, createdAt: Date.now() }
              : m,
          ),
        }));
      }
    } finally {
      setIsSending(false);
      setSelectedElement(null);
      editAbortRef.current = null;
    }
  }, [editJsonError, activeSession, selectedElement, activeId, upsertSession]);

  /** 编辑模式下发送修改请求（流式版：LLM 实时返回 JSON 并在聊天区逐字展示） */
  const handleEditSend = useCallback(
    async (instruction: string) => {
      if (!activeSession.lastHtml || !selectedElement) return;

      // 记录用户修改指令到聊天
      const userMsg: ChatMessage = {
        id: newId(),
        role: "user",
        content: `【编辑模式】修改选中组件（${selectedElement.tagName}${selectedElement.id ? `#${selectedElement.id}` : ""}）：${instruction}`,
        createdAt: Date.now(),
      };

      // 创建流式占位消息，实时展示 LLM 返回的 JSON
      const placeholderId = newId();
      const placeholderMsg: ChatMessage = {
        id: placeholderId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      };

      upsertSession(activeId, (s) => ({
        ...s,
        updatedAt: Date.now(),
        messages: [...s.messages, userMsg, placeholderMsg],
      }));

      const controller = new AbortController();
      editAbortRef.current = controller;

      setIsSending(true);
      try {
        // 流式调用编辑模式 LLM，每收到一个 token 就实时更新聊天区
        const rawReply = await chatWithLLMForEditStream(
          activeSession.lastHtml,
          selectedElement,
          instruction,
          (streamedText) => {
            // 实时更新助手消息为当前累积的 JSON 文本
            upsertSession(activeId, (s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.id === placeholderId
                  ? { ...m, content: streamedText }
                  : m,
              ),
            }));
          },
          controller.signal,
        );

        // 流式结束后，解析完整的 JSON 命令
        const commandsResult = extractEditCommands(rawReply);

        if (commandsResult && commandsResult.commands.length > 0) {
          // 本地执行 DOM 修改命令
          const newHtml = applyEditCommands(activeSession.lastHtml, commandsResult.commands);

          // 更新 HTML
          upsertSession(activeId, (s) => ({
            ...s,
            lastHtml: newHtml,
          }));

          // 将修改说明记录为最终的助手回复
          const explanation = commandsResult.explanation ?? generateEditExplanation(commandsResult.commands);
          upsertSession(activeId, (s) => ({
            ...s,
            updatedAt: Date.now(),
            messages: s.messages.map((m) =>
              m.id === placeholderId
                ? { ...m, content: `✅ 已按要求修改组件\n\n${explanation}\n\n\`\`\`json\n${JSON.stringify(commandsResult, null, 2)}\n\`\`\``, createdAt: Date.now() }
                : m,
            ),
          }));
        } else {
          // JSON 解析失败：弹窗让用户选择
          console.warn("[handleEditSend] 无法解析 LLM 返回的编辑命令");

          // 先将已流式输出的内容保留，恢复 isSending 为 false，让 UI 不卡住
          setIsSending(false);
          setEditJsonError({
            rawReply,
            instruction,
            placeholderId,
          });
        }

        // 自动进入预览模式
        setViewMode("preview");
      } catch (err: any) {
        const isAbort = err?.name === "AbortError";
        // 用户主动停止时不显示错误，只标记已停止
        if (!isAbort) {
          upsertSession(activeId, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === placeholderId
                ? { ...m, content: `⚠️ 编辑请求失败：${err.message || "未知错误"}`, createdAt: Date.now() }
                : m,
            ),
          }));
        } else {
          // 停止时更新占位消息为已停止
          upsertSession(activeId, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === placeholderId
                ? { ...m, content: m.content || "⏹ 已停止编辑", createdAt: Date.now() }
                : m,
            ),
          }));
        }
      } finally {
        setIsSending(false);
        setSelectedElement(null);
        editAbortRef.current = null;
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

          {editMode && selectedElement ? (
            <ElementEditPanel
              element={selectedElement}
              busy={isSending}
              onSend={handleEditSend}
              onStop={handleEditStop}
              onClose={() => setSelectedElement(null)}
            />
          ) : (
            <InputBox disabled={isSending && !isPaused} sessions={sessions} isSending={isSending} isPaused={isPaused} onTogglePause={onTogglePause} onSend={onSend} />
          )}
        </div>
      </div>

      {/* 编辑模式 JSON 解析失败弹窗 */}
      {editJsonError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-800">
            <div className="mb-4 flex items-start gap-3">
              <span className="mt-0.5 text-2xl">⚠️</span>
              <div>
                <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  修改指令解析失败
                </div>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  LLM 返回的 JSON 格式有误，无法自动执行修改。请选择重新生成方式。
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                onClick={handleEditRetryCommands}
              >
                再试一次
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700"
                onClick={handleEditRetryFull}
              >
                全部重新生成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}