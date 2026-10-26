import { describe, expect, it } from "vitest";
import { markdownImages, sourceDocumentPath } from "../document-images.js";

describe("document images", () => {
  it("preserves Markdown and converts HTML images in the served copy", () => {
    expect(markdownImages('正文 ![图](a.png) <img src="a%20b.png?x=1&amp;y=2" alt="图片" width="300">'))
      .toBe('正文 ![图](a.png) ![图片](<a%20b.png?x=1&y=2>)');
    expect(markdownImages('<img data-src="images/a.png" onerror="alert(1)">')).toBe('![](<images/a.png>)');
    expect(markdownImages('```ts\nconst n = 1;\n```')).toContain('const n = 1');
  });
  it("resolves SMB documents relative to the configured base exactly once", () => {
    expect(sourceDocumentPath("资料/教程/说明.md", "资料")).toBe("教程/说明.md");
    expect(sourceDocumentPath("资料2/说明.md", "资料")).toBe("资料2/说明.md");
    expect(sourceDocumentPath("教程/说明.md")).toBe("教程/说明.md");
    expect(sourceDocumentPath("资料\\教程\\说明.md", "资料")).toBe("教程/说明.md");
  });
});
