export interface OutlineEntry { offset: number; level: number; title: string }
export function documentOutline(content: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  let offset = 0; let fence = "";
  for (const line of content.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = ""; }
    if (!fence) {
      const heading = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(line);
      if (heading) entries.push({ offset, level: heading[1].length, title: heading[2].replace(/[*_`]/g, "") });
    }
    offset += line.length + 1;
  }
  return entries;
}
export function passageOffset(content: string, passage: string): number {
  if (!passage) return -1;
  const exact = content.indexOf(passage);
  return exact >= 0 ? exact : content.indexOf(passage.slice(0, 60));
}
