/**
 * 从用户消息中自动提取关键词标签。
 * 取消息内容中的中英文词组，去重后取前 4 个作为标签。
 */

const TAG_MAX = 4;

/** 提取有意义的关键词片段 */
function extractKeywords(text: string): string[] {
  const candidates: string[] = [];

  // 匹配中文词组（2~6 个连续中文字符）
  const zhMatches = text.match(/[\u4e00-\u9fff]{2,6}/g);
  if (zhMatches) candidates.push(...zhMatches);

  // 匹配英文单词（3 个字符以上）
  const enMatches = text.match(/\b[a-zA-Z]{3,}\b/g);
  if (enMatches) candidates.push(...enMatches.map((w) => w.toLowerCase()));

  // 去重
  const unique = [...new Set(candidates)];

  return unique.slice(0, TAG_MAX);
}

/** 从消息列表中提取标签，优先取最新用户消息 */
export function extractTagsFromMessages(
  messages: { role: string; content: string }[],
): string[] {
  const tags = new Set<string>();

  // 从最新的用户消息往前取
  for (let i = messages.length - 1; i >= 0 && tags.size < TAG_MAX; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    const words = extractKeywords(m.content);
    for (const w of words) {
      if (tags.size >= TAG_MAX) break;
      tags.add(w);
    }
  }

  return [...tags];
}