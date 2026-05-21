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
 * 清洗 LLM 返回的选择器中非标准 CSS 伪类（如 :contains()、:has()），
 * 将其转换为 document.querySelector 兼容的选择器。
 * 若清洗后变得无法精确匹配，返回 null 由调用方回退到文本遍历匹配。
 */
function sanitizeSelectorForQuery(selector: string): string | null {
  // 移除 :contains('xxx') —— jQuery 扩展，标准 CSS 不支持
  let cleaned = selector.replace(/:contains\((["'])(?:\\.|(?!\1).)*?\1\)/g, "");

  // 移除 :has(...) —— CSS4 尚未被所有浏览器支持，且 DOMParser 下 querySelector 不支持
  // 简单策略：移除 :has(...) 及其括号内内容
  let prev = "";
  while (prev !== cleaned) {
    prev = cleaned;
    cleaned = cleaned.replace(/:has\(([^()]*\([^()]*\)[^()]*|[^()]*?)\)/g, () => {
      return "";
    });
  }

  // 如果清洗后选择器为空，返回 null
  if (!cleaned.trim()) return null;

  // 清理可能残留的多余空格（如 ".class " 变成 ".class"）
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // 清理连续的伪类分隔符（如 ": :"）
  cleaned = cleaned.replace(/:\s*:/g, ":");

  return cleaned;
}

/**
 * 当 querySelector 因无效选择器抛异常时，使用 DOM 遍历作为回退匹配。
 * 支持 :contains('text') 和 :has(selector) 两种扩展伪类。
 */
function querySelectorWithFallback(doc: Document, rawSelector: string): Element | null {
  // 先尝试原始选择器（可能被清洗后用）
  const sanitized = sanitizeSelectorForQuery(rawSelector);

  // 策略1：如果清洗后选择器有效，尝试标准 querySelector
  if (sanitized) {
    try {
      const el = doc.querySelector(sanitized);
      if (el) return el;
    } catch {
      // 清洗后仍无效，继续回退
    }
  }

  // 策略2：回退到 DOM 遍历，支持 :contains('text') 和 :has(selector)
  // 提取 base 选择器（伪类之前的部分）和扩展伪类
  const containsMatch = rawSelector.match(/:contains\((["'])((?:\\.|(?!\1).)*?)\1\)/g);
  const hasMatches: string[] = [];
  // 提取所有 :has(...)（需要平衡括号）
  let hasSearchStr = rawSelector;
  // 简化：提取所有 :has(...) 并移除，得到 base
  {
    let depth = 0;
    let start = -1;
    const parts: { start: number; end: number }[] = [];
    for (let i = 0; i < hasSearchStr.length; i++) {
      if (hasSearchStr.slice(i, i + 4) === ":has" && hasSearchStr[i + 4] === "(") {
        start = i;
        depth = 0;
        i += 4; // skip "has"
      }
      if (start >= 0) {
        if (hasSearchStr[i] === "(") depth++;
        else if (hasSearchStr[i] === ")") {
          depth--;
          if (depth === 0) {
            const inner = hasSearchStr.slice(start + 5, i); // strip ":has("
            hasMatches.push(inner);
            parts.push({ start, end: i });
            start = -1;
          }
        }
      }
    }

    // 构建 base 选择器（移除所有 :has(...) 和 :contains(...)）
    let base = rawSelector;
    for (const part of parts.reverse()) {
      base = base.slice(0, part.start) + base.slice(part.end + 1);
    }
    // 也移除 :contains
    base = base.replace(/:contains\((["'])(?:\\.|(?!\1).)*?\1\)/g, "").trim();
    // 清理多余伪类分隔符和空格
    base = base.replace(/:\s*:/g, ":").replace(/\s+/g, " ").trim();

    if (!base || base === ":") return null;

    // 获取所有匹配 base 选择器的元素
    let candidates: Element[] = [];
    try {
      candidates = Array.from(doc.querySelectorAll(base));
    } catch {
      return null;
    }

    // 过滤 :has 条件
    for (const hasInner of hasMatches) {
      candidates = candidates.filter((el) => el.querySelector(hasInner.trim()));
    }

    // 过滤 :contains 条件
    for (const cm of containsMatch ?? []) {
      const textMatch = cm.match(/:contains\((["'])((?:\\.|(?!\1).)*?)\1\)/);
      if (textMatch) {
        const searchText = textMatch[2]!;
        candidates = candidates.filter((el) =>
          (el.textContent ?? "").includes(searchText),
        );
      }
    }

    if (candidates.length > 0) {
      return candidates[0]!;
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
      let el = querySelectorWithFallback(doc, cmd.selector);

      // 自动修正常见的 CSS 伪类选择器陷阱
      // `:last-child` 要求元素必须是父容器最后一个子元素，但 DOM 结构中后面通常还有其他元素
      // 自动回退为 `:last-of-type`（匹配同类型的最后一个元素，不要求是最后一个子元素）
      if (!el && cmd.selector.includes(":last-child")) {
        const fallbackSelector = cmd.selector.replace(/:last-child/g, ":last-of-type");
        // 清洗回退选择器
        const sanitizedFallback = sanitizeSelectorForQuery(fallbackSelector);
        if (sanitizedFallback) {
          try {
            el = doc.querySelector(sanitizedFallback);
          } catch { /* fallback also invalid, continue */ }
        }
        if (!el) {
          el = querySelectorWithFallback(doc, fallbackSelector);
        }
        if (el) {
          console.info(
            `[applyEditCommands] 选择器 "${cmd.selector}" → "${fallbackSelector}" 自动修正成功`,
          );
        }
      }

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
