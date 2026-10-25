/** Plain display text; source Markdown stays untouched and no HTML is executed. */
export function researchText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, label?: string) => label || target)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`/g, (_, bold: string, underline: string, code: string) => bold || underline || code)
    .trim();
}
