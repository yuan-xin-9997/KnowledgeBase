import { describe, it, expect } from "vitest";
import { documentFormat } from "../document-format.js";
describe("document format", () => {
  it("uses the original format rather than extracted text", () => {
    expect(documentFormat("application/pdf", "a.pdf", null, "text", "file")).toBe("pdf");
    expect(documentFormat(null, "A.MD", null, "text", "file")).toBe("markdown");
    expect(documentFormat("text/plain", "a.mp3", null, "text", "file")).toBe("mp3");
    expect(documentFormat("video/mp4", "123", null, "text", "file")).toBe("mp4");
    expect(documentFormat(null, "123", "https://example.test/a.PDF?download=1", "markdown", "article")).toBe("pdf");
    expect(documentFormat(null, "123", null, "markdown", "article")).toBe("markdown");
  });
});
