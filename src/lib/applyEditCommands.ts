/**
 * 在 HTML 文档上执行 LLM 返回的结构化编辑命令，返回修改后的完整 HTML。
 *
 * 使用浏览器原生 DOMParser + DOM API 实现精确的局部修改，
 * 避免将整个 HTML 发回 LLM 重新生成，大幅节省 token 和响应时间。
 */
import type { EditCommand, EditCommandsResult } from "../types";

/**
 * 修复 JSON 字符串值中未转义的双引号（LLM 常在此处出错）。
 * 例如："html": "<div class="foo">" → "html": "<div class=\"foo\">"
 *
 * 策略：html/outerHtml 字段的值是完整 HTML，HTML 总是以 > 结束，
 * JSON 字符串值的结束引号 " 紧跟在该 > 之后。
 * 因此定位 >" 后面是 , 或 } 的位置即为真正的 JSON 结束引号。
 */
function fixUnescapedQuotesInJson(jsonStr: string): string {
  let result = jsonStr;

  // 每次处理一个 html/outerHtml 字段，处理完后重新扫描
  const fieldRegex = /"(html|outerHtml)"\s*:\s*"/g;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const match = fieldRegex.exec(result);
    if (!match) break;

    const valueStart = match.index + match[0].length; // 指向 HTML 内容第一个字符
    // 从末尾往前找：> 后面紧跟 "，且该 " 后面是 , 或 } 或空白+} 
    let closePos = -1;
    for (let i = result.length - 2; i > valueStart; i--) {
      if (result[i] === ">" && result[i + 1] === '"') {
        const after = result.slice(i + 2).trimStart();
        if (after.startsWith(",") || after.startsWith("}") || after === "") {
          closePos = i + 1; // 指向这个结束 "
          break;
        }
      }
    }

    if (closePos === -1) break; // 无法定位，放弃修复

    const rawValue = result.slice(valueStart, closePos);
    // 转义内部未转义的双引号
    const escapedValue = rawValue.replace(/(?<!\\)"/g, '\\"');
    // 重建该字段
    const before = result.slice(0, match.index);
    const after = result.slice(closePos + 1);
    result = `${before}"${match[1]}": "${escapedValue}"${after}`;

    // 重置 lastIndex，从修改后的字符串开头重新扫描
    fieldRegex.lastIndex = 0;
  }

  return result;
}

/** 所有提取 + 解析尝试，都先做一次双引号修复 */
function tryParseEditCommands(jsonText: string): EditCommandsResult | null {
  try {
    return JSON.parse(jsonText) as EditCommandsResult;
  } catch {
    // 尝试修复未转义双引号后重试
    try {
      const fixed = fixUnescapedQuotesInJson(jsonText);
      return JSON.parse(fixed) as EditCommandsResult;
    } catch {
      return null;
    }
  }
}

/**
 * 从 LLM 回复中提取 JSON 编辑命令。
 * 兼容 LLM 可能包裹的 ```json 围栏、Markdown 说明文字等，
 * 以及 HTML 属性双引号未转义（如 `class="foo"` 破坏 JSON）。
 */
export function extractEditCommands(text: string): EditCommandsResult | null {
  if (!text) return null;

  const trimmed = text.trim();

  // 1. 尝试直接解析整段 JSON（以 { 开头）
  if (trimmed.startsWith("{")) {
    const result = tryParseEditCommands(trimmed);
    if (result) return result;
  }

  // 2. 尝试提取 ```json 围栏
  const jsonFence = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  if (jsonFence) {
    const result = tryParseEditCommands(jsonFence[1]!.trim());
    if (result) return result;
  }

  // 3. 尝试提取第一个 { 到最后一个 } 之间的内容
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const result = tryParseEditCommands(trimmed.slice(firstBrace, lastBrace + 1));
    if (result) return result;
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

  // 策略2：回退到 DOM 遍历
  // 将选择器拆解为：base 选择器 + 多个伪类条件，逐级过滤候选元素
  //
  // 支持的伪类类型：
  //   A) 扩展伪类：:contains("text")、:has(selector) — querySelector 不支持
  //   B) 位置伪类：:last-of-type、:first-of-type、:first-child、:last-child、
  //                 :nth-child(n)、:nth-of-type(n)、:only-child、:only-of-type
  //     虽然浏览器支持这些伪类，但 LLM 经常选错，在 DOMParser 文档中匹配不到
  //     因此也走 fallback：用 base 获取所有候选，再按位置伪类选对应的元素
  {
    // 1. 提取所有带括号的伪类：:contains(...)、:has(...)、:nth-child(...)、:nth-of-type(...)
    const bracketPseudos: { raw: string; type: string; arg: string }[] = [];
    const bracketRegex = /:(contains|has|nth-child|nth-of-type)\((["']?)([^)]*?)\2\)/gi;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = bracketRegex.exec(rawSelector)) !== null) {
      bracketPseudos.push({ raw: m[0], type: m[1]!.toLowerCase(), arg: m[3]! });
    }

    // 2. 提取无括号的位置伪类：:first-child、:last-child、:first-of-type、:last-of-type、:only-child、:only-of-type
    const positionPseudos: string[] = [];
    const positionRegex = /:(first-child|last-child|first-of-type|last-of-type|only-child|only-of-type)(?=[\s:,.\[#]|$)/gi;
    // eslint-disable-next-line no-cond-assign
    while ((m = positionRegex.exec(rawSelector)) !== null) {
      positionPseudos.push(m[0].slice(1)); // 去掉前导 ":"
    }

    // 3. 构建 base 选择器：移除所有伪类
    let base = rawSelector;
    // 移除所有 bracket 伪类
    for (const bp of bracketPseudos) {
      base = base.replace(bp.raw, "");
    }
    // 移除所有无括号位置伪类
    for (const pp of new Set(positionPseudos)) {
      base = base.replace(new RegExp(`:${pp}`, "gi"), "");
    }
    // 清理：连续冒号、多余空格
    base = base.replace(/:\s*:/g, ":").replace(/\s+/g, " ").trim();
    // 清理末尾残留的冒号
    base = base.replace(/:$/, "").trim();

    if (!base) return null;

    // 4. 获取所有候选元素
    let candidates: Element[] = [];
    try {
      candidates = Array.from(doc.querySelectorAll(base));
    } catch {
      return null;
    }
    if (candidates.length === 0) return null;

    // 5. 过滤 :has 条件
    for (const bp of bracketPseudos) {
      if (bp.type === "has") {
        candidates = candidates.filter((el) => {
          try { return el.querySelector(bp.arg.trim()); } catch { return false; }
        });
      }
    }

    // 6. 过滤 :contains 条件
    for (const bp of bracketPseudos) {
      if (bp.type === "contains") {
        const searchText = bp.arg;
        candidates = candidates.filter((el) =>
          (el.textContent ?? "").includes(searchText),
        );
      }
    }

    // 保存位置过滤前的候选（用于保底回退）
    const candidatesBeforePos = candidates.slice();

    // 7. 按位置伪类选择对应的元素
    for (const pp of positionPseudos) {
      switch (pp) {
        case "first-child":
          candidates = candidates.filter(
            (el) => el.parentElement?.children[0] === el,
          );
          break;
        case "last-child":
          candidates = candidates.filter(
            (el) => {
              const p = el.parentElement;
              return p && p.children[p.children.length - 1] === el;
            },
          );
          break;
        case "first-of-type":
          candidates = candidates.filter(
            (el) => {
              const siblings = el.parentElement?.children;
              if (!siblings) return false;
              for (let i = 0; i < siblings.length; i++) {
                if (siblings[i]!.tagName === el.tagName) {
                  return siblings[i] === el;
                }
              }
              return false;
            },
          );
          break;
        case "last-of-type":
          candidates = candidates.filter(
            (el) => {
              const siblings = el.parentElement?.children;
              if (!siblings) return false;
              for (let i = siblings.length - 1; i >= 0; i--) {
                if (siblings[i]!.tagName === el.tagName) {
                  return siblings[i] === el;
                }
              }
              return false;
            },
          );
          break;
        case "only-child":
          candidates = candidates.filter(
            (el) => (el.parentElement?.children.length ?? 0) === 1,
          );
          break;
        case "only-of-type":
          candidates = candidates.filter(
            (el) => {
              const siblings = Array.from(el.parentElement?.children ?? []);
              return siblings.filter((s) => s.tagName === el.tagName).length === 1;
            },
          );
          break;
        default:
          break;
      }
    }

    // 8. 处理 :nth-child / :nth-of-type
    for (const bp of bracketPseudos) {
      const n = parseInt(bp.arg, 10);
      if (isNaN(n) || n < 1) continue;
      if (bp.type === "nth-child") {
        candidates = candidates.filter(
          (el) => {
            const idx = Array.from(el.parentElement?.children ?? []).indexOf(el);
            return idx + 1 === n;
          },
        );
      } else if (bp.type === "nth-of-type") {
        candidates = candidates.filter(
          (el) => {
            const siblings = el.parentElement?.children ?? [];
            let count = 0;
            for (let i = 0; i < siblings.length; i++) {
              if (siblings[i]!.tagName === el.tagName) count++;
              if (siblings[i] === el) return count === n;
            }
            return false;
          },
        );
      }
    }

    // 9. 保底：如果严格按位置伪类过滤后为空，且存在位置伪类，
    //    说明 LLM 可能用错了 :last-of-type / :first-of-type 等选择器
    //    （对 LLM 来说通常意思是"最后一个匹配的"，而非"最后一个该标签类型的"）
    //    此时回退：在未过滤的候选中，按位置伪类的直觉含义选取对应元素
    if (candidates.length === 0 && positionPseudos.length > 0 && candidatesBeforePos.length > 0) {
      const lastPos = positionPseudos[positionPseudos.length - 1]!;
      switch (lastPos) {
        case "last-child":
        case "last-of-type":
          candidates = [candidatesBeforePos[candidatesBeforePos.length - 1]!];
          break;
        case "first-child":
        case "first-of-type":
          candidates = [candidatesBeforePos[0]!];
          break;
        // only-child / only-of-type 不保底（要求过于严格，回退无意义）
        default:
          break;
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
