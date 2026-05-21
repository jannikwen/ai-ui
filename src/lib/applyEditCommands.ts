/**
 * 在 HTML 文档上执行 LLM 返回的结构化编辑命令，返回修改后的完整 HTML。
 *
 * 使用浏览器原生 DOMParser + DOM API 实现精确的局部修改，
 * 避免将整个 HTML 发回 LLM 重新生成，大幅节省 token 和响应时间。
 */
import type { EditCommand, EditCommandsResult } from "../types";

/**
 * 从 LLM 回复中提取 JSON 编辑命令。
 * 兼容 LLM 可能包裹的 ```json 围栏、Markdown 说明文字等。
 */
export function extractEditCommands(text: string): EditCommandsResult | null {
  if (!text) return null;

  // 1. 尝试直接解析整段 JSON
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as EditCommandsResult;
    } catch {
      // 继续尝试其他方式
    }
  }

  // 2. 尝试提取 ```json 围栏
  const jsonFence = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  if (jsonFence) {
    try {
      return JSON.parse(jsonFence[1]!.trim()) as EditCommandsResult;
    } catch {
      // 继续尝试
    }
  }

  // 3. 尝试提取第一个 { 到最后一个 } 之间的内容
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as EditCommandsResult;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * 在给定的 HTML 文档上按顺序执行所有编辑命令。
 *
 * @param html - 原始完整 HTML（含 DOCTYPE）
 * @param commands - 要执行的编辑命令数组
 * @returns 修改后的完整 HTML，如果命令为空则返回原 HTML
 */
export function applyEditCommands(html: string, commands: EditCommand[]): string {
  if (!commands || commands.length === 0) return html;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // 规范化：移除 parser 可能添加的默认 html/head/body 包装
  // DOMParser 总是补全结构，这里我们信任输入是完整 HTML

  for (const cmd of commands) {
    try {
      const el = doc.querySelector(cmd.selector);

      if (!el) {
        console.warn(
          `[applyEditCommands] 选择器 "${cmd.selector}" 未匹配到元素，跳过命令: ${cmd.action}`,
        );
        continue;
      }

      switch (cmd.action) {
        case "setStyle": {
          const styleTarget = el as HTMLElement;
          for (const [prop, val] of Object.entries(cmd.styles)) {
            // LLM 返回的 CSS 属性名可能是 camelCase（如 backgroundColor），
            // 需要转换为 kebab-case（如 background-color）才能被 setProperty 正确识别
            const kebabProp = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
            styleTarget.style.setProperty(kebabProp, val);
          }
          break;
        }

        case "setText":
          el.textContent = cmd.value;
          break;

        case "setAttribute":
          el.setAttribute(cmd.name, cmd.value);
          break;

        case "replaceClass":
          el.classList.replace(cmd.oldClass, cmd.newClass);
          break;

        case "setHtml":
          el.innerHTML = cmd.html;
          break;

        case "addClass":
          el.classList.add(cmd.class);
          break;

        case "removeClass":
          el.classList.remove(cmd.class);
          break;

        case "setOuterHtml": {
          const container = doc.createElement("div");
          // innerHTML 方式会让 container 包含子节点
          container.innerHTML = cmd.outerHtml;
          // 取第一个子节点（或 container 本身的文本节点）
          const replacement = container.firstChild || container;
          el.replaceWith(replacement);
          break;
        }

        case "addSibling": {
          const container = doc.createElement("div");
          container.innerHTML = cmd.html;
          const newNode = container.firstElementChild || container.firstChild;
          if (!newNode) break;
          if (cmd.position === "after") {
            el.after(newNode);
          } else {
            el.before(newNode);
          }
          break;
        }

        default:
          console.warn(`[applyEditCommands] 未知 action: ${(cmd as any).action}`);
      }
    } catch (err) {
      console.error(
        `[applyEditCommands] 执行命令失败: ${cmd.action} on "${cmd.selector}"`,
        err,
      );
      // 继续执行后续命令，不因单个失败而中断
    }
  }

  // 序列化回完整 HTML
  const doctype = "<!DOCTYPE html>\n";
  return doctype + doc.documentElement.outerHTML;
}

/**
 * 根据编辑命令生成人类可读的修改说明。
 */
export function generateEditExplanation(commands: EditCommand[]): string {
  if (!commands || commands.length === 0) return "未执行任何修改。";

  const descriptions = commands.map((cmd, i) => {
    const target = cmd.selector;
    switch (cmd.action) {
      case "setStyle": {
        const props = Object.keys(cmd.styles).join("、");
        return `${i + 1}. 修改了「${target}」的样式（${props} 等）`;
      }
      case "setText":
        return `${i + 1}. 将「${target}」的文本替换为"${cmd.value.slice(0, 30)}${cmd.value.length > 30 ? "..." : ""}"`;
      case "setAttribute":
        return `${i + 1}. 设置了「${target}」的 ${cmd.name} 属性`;
      case "replaceClass":
        return `${i + 1}. 将「${target}」的 CSS 类 ${cmd.oldClass} 替换为 ${cmd.newClass}`;
      case "setHtml":
        return `${i + 1}. 替换了「${target}」的内部 HTML`;
      case "addClass":
        return `${i + 1}. 为「${target}」添加了 CSS 类 ${cmd.class}`;
      case "removeClass":
        return `${i + 1}. 移除了「${target}」的 CSS 类 ${cmd.class}`;
      case "setOuterHtml":
        return `${i + 1}. 完全替换了「${target}」元素`;
      case "addSibling":
        return `${i + 1}. 在「${target}」${cmd.position === "after" ? "后" : "前"}添加了新元素`;
      default:
        return `${i + 1}. 执行了未知操作`;
    }
  });

  return descriptions.join("\n");
}
