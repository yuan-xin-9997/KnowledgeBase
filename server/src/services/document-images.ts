import * as cheerio from "cheerio";

// Normalize only the served copy; source files and indexed content stay untouched.
export function markdownImages(content: string): string {
  return content.replace(/<img\b[^>]*>/gi, (tag) => {
    const image = cheerio.load(tag)("img");
    const src = image.attr("src") || image.attr("data-src");
    if (!src) return "";
    const alt = (image.attr("alt") || "").replace(/[\[\]\r\n]/g, " ");
    return `![${alt}](<${src.replace(/</g, "%3C").replace(/>/g, "%3E").replace(/\r?\n/g, "")}>)`;
  });
}

export function sourceDocumentPath(externalId: string, basePath = ""): string {
  const base = basePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const file = externalId.replace(/\\/g, "/");
  return base && file.startsWith(base + "/") ? file.slice(base.length + 1) : file;
}
