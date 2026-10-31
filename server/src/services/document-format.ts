export function documentFormat(mime: string | null, externalId: string, url: string | null, contentFormat: string, kind: string): string {
  const type = (mime || "").split(";")[0].trim().toLowerCase();
  const formats: Record<string, string> = {
    "application/pdf": "pdf", "text/markdown": "markdown", "text/x-markdown": "markdown",
    "text/html": "html", "application/xhtml+xml": "html", "audio/mpeg": "mp3",
    "video/mp4": "mp4", "audio/mp4": "m4a", "audio/x-wav": "wav", "audio/wav": "wav",
    "image/jpeg": "jpg", "image/png": "png", "video/webm": "webm",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  };
  if (formats[type]) return formats[type];
  const location = kind === "file" ? externalId : url || "";
  const extension = location.split(/[?#]/)[0].match(/\.([a-z0-9]{1,12})$/i)?.[1].toLowerCase();
  if (extension) return ({ md: "markdown", markdown: "markdown", htm: "html", jpeg: "jpg" } as Record<string, string>)[extension] || extension;
  if (type === "text/plain") return "txt";
  if (contentFormat === "markdown") return "markdown";
  if (contentFormat === "html") return "html";
  return "txt";
}
