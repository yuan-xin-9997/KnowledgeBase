const error = { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, details: {} } } } };
const bearer = [{ bearerAuth: [] }];
const responses = { "400": { description: "参数或幂等键无效", content: { "application/json": { schema: error } } }, "401": { description: "无凭据、错误或过期凭据", content: { "application/json": { schema: error } } }, "403": { description: "权限范围不足", content: { "application/json": { schema: error } } }, "429": { description: "超过调用频率限制" } };

export default {
  openapi: "3.1.0",
  info: { title: "知屿 KnowledgeBase API", version: "1.0.0", description: "供 AI 与自动化程序使用的稳定 API。所有业务端点均需用户级 Bearer 凭据。" },
  servers: [{ url: "/", description: "当前服务" }],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "kb_ personal access token" } },
    schemas: {
      Source: { type: "object", required: ["id", "name", "type", "enabled"], properties: { id: { type: "string", example: "src_abc123" }, name: { type: "string", example: "我的 Cubox" }, type: { enum: ["local", "smb", "cubox", "yuque"] }, enabled: { type: "boolean" }, syncIntervalMinutes: { type: "integer" }, docCount: { type: "integer" } } },
      Job: { type: "object", required: ["id", "sourceId", "status"], properties: { id: { type: "string", example: "job_abc123" }, sourceId: { type: "string" }, status: { enum: ["queued", "running", "success", "error"] }, stats: {}, error: { type: ["string", "null"] }, startedAt: { type: ["string", "null"], format: "date-time" }, finishedAt: { type: ["string", "null"], format: "date-time" } } },
    },
  },
  paths: {
    "/api/api-credentials": {
      get: { summary: "分页列出当前登录用户自己的自动化凭据元数据", description: "仅支持网页登录 Cookie，不返回完整密钥。", parameters: [{ name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } }, { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 10 } }], responses: { "200": { description: "凭据元数据、分页信息和当前可选 scope" }, "401": { description: "未登录" }, "403": { description: "拒绝使用 Bearer 凭据管理凭据" } } },
      post: { summary: "为当前登录用户创建自动化凭据", description: "完整密钥只在本响应返回一次，响应禁止缓存。", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["name", "scopes"], properties: { name: { type: "string", maxLength: 100 }, scopes: { type: "array", minItems: 1, items: { enum: ["documents:read", "sources:read", "sources:write", "sync:write", "jobs:read"] } }, expiresAt: { type: ["string", "null"], format: "date-time" } } }, example: { name: "my-agent", scopes: ["documents:read"], expiresAt: "2027-01-01T00:00:00.000Z" } } } }, responses: { "201": { description: "凭据与一次性完整密钥" }, "400": { description: "scope 或有效期无效" }, "401": { description: "未登录" } } },
    },
    "/api/api-credentials/{id}": { delete: { summary: "撤销当前登录用户自己的凭据", description: "同时使所有关联的短期 OAuth token 立即失效。", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "已撤销" }, "404": { description: "凭据不存在或不属于当前用户" } } } },
    "/api/v1/documents": { get: { summary: "分页检索文档", security: bearer, parameters: [
      { name: "q", in: "query", schema: { type: "string", maxLength: 500 }, example: "向量数据库" }, { name: "sourceId", in: "query", schema: { type: "string" } }, { name: "tag", in: "query", schema: { type: "string" } }, { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } }, { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
    ], responses: { "200": { description: "检索结果（items、total、page、pageSize）" }, ...responses } } },
    "/api/v1/documents/{id}": { get: { summary: "获取文档详情和正文", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "文档详情" }, "404": { description: "文档不存在", content: { "application/json": { schema: error } } }, ...responses } } },
    "/api/v1/sources": {
      get: { summary: "列出信息来源", security: bearer, responses: { "200": { description: "来源列表" }, ...responses } },
      post: { summary: "创建信息来源", security: bearer, parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 8, maxLength: 128 }, example: "create-cubox-20261024" }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["name", "type", "config"], properties: { name: { type: "string" }, type: { enum: ["local", "smb", "cubox", "yuque"] }, config: { type: "object", additionalProperties: true }, enabled: { type: "boolean" }, syncIntervalMinutes: { type: "integer", minimum: 0 } } }, example: { name: "Cubox", type: "cubox", config: { apiLink: "https://cubox.pro/c/api/save/REDACTED" }, syncIntervalMinutes: 360 } } } }, responses: { "201": { description: "已创建", content: { "application/json": { schema: { type: "object", properties: { source: { $ref: "#/components/schemas/Source" } } } } } }, "409": { description: "幂等键冲突" }, ...responses } },
    },
    "/api/v1/sources/{id}": { patch: { summary: "修改信息来源", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" }, config: { type: "object" }, enabled: { type: "boolean" }, syncIntervalMinutes: { type: "integer" } } }, example: { enabled: false } } } }, responses: { "200": { description: "已修改" }, ...responses } } },
    "/api/v1/sources/{id}/sync": { post: { summary: "异步启动同步", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" }, example: "sync-source-20261024-1" }], requestBody: { content: { "application/json": { schema: { type: "object", properties: { force: { type: "boolean", default: false } } }, example: { force: false } } } }, responses: { "202": { description: "任务已接受", content: { "application/json": { schema: { type: "object", properties: { job: { $ref: "#/components/schemas/Job" } } } } } }, "409": { description: "来源已有同步任务或幂等冲突" }, ...responses } } },
    "/api/v1/jobs/{id}": { get: { summary: "查询任务进度、结果和失败原因", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "任务状态", content: { "application/json": { schema: { type: "object", properties: { job: { $ref: "#/components/schemas/Job" } } } } } }, ...responses } } },
  },
} as const;
