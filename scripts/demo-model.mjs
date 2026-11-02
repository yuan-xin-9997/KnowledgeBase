// Offline OpenAI protocol fixture, not an AI model. No upstream calls or request logs.
import http from "node:http";
export const content = "【离线固定演示，非模型推理】海岬项目试运行日期为 2026 年 12 月 15 日，负责人为林澄 [1]。请打开引用核对 DEMO-001。";
export function createDemoServer() {
  return http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end(); return;
    }
    let raw = "";
    for await (const chunk of request) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 1024 * 1024) { response.writeHead(413).end(); return; }
    }
    try {
      const body = JSON.parse(raw);
      if (body.stream) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`);
      } else {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
      }
    } catch { response.writeHead(400).end(); }
  });
}
if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  createDemoServer().listen(38081, process.env.DEMO_HOST || "127.0.0.1");
}
