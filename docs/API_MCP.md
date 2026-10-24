# API 与 MCP 接入说明

## 地址

- OpenAPI：`https://你的域名/api/openapi.json`
- v1 API：`https://你的域名/api/v1`
- MCP（Streamable HTTP）：`https://你的域名/mcp`
- MCP Protected Resource Metadata：`https://你的域名/.well-known/oauth-protected-resource`
- OAuth Authorization Server Metadata：`https://你的域名/.well-known/oauth-authorization-server`
- 匿名公开入口仅有：`GET /api/health`、OpenAPI 文档和两份 OAuth/MCP 元数据。业务数据端点均拒绝匿名请求。

## 凭据与权限

用户登录网页后，通过 `POST /api/api-credentials` 创建独立凭据；令牌只显示一次，服务端只保存 SHA-256 哈希。通过 `GET /api/api-credentials` 查看状态，通过 `DELETE /api/api-credentials/{id}` 撤销。凭据可设置 ISO 8601 过期时间。

可用 scope：`documents:read`、`sources:read`、`sources:write`、`sync:write`、`jobs:read`。

网页 Cookie 登录与现有用户权限保持不变。API/MCP Bearer 凭据映射到创建它的用户，并继续受用户数据隔离和“本地目录仅管理员”规则约束。凭据管理本身只允许网页登录，Bearer 凭据不能创建更多凭据。

```bash
curl -X POST https://kb.example.com/api/api-credentials \
  -H 'Cookie: kb_session=网页登录会话' -H 'Content-Type: application/json' \
  -d '{"name":"my-agent","scopes":["documents:read","sources:read","sources:write","sync:write","jobs:read"],"expiresAt":"2027-01-01T00:00:00.000Z"}'
```

## API 示例

```bash
curl 'https://kb.example.com/api/v1/documents?q=知识管理&page=1&pageSize=20' \
  -H 'Authorization: Bearer kb_只显示一次的令牌'

curl -X POST 'https://kb.example.com/api/v1/sources/src_xxx/sync' \
  -H 'Authorization: Bearer kb_只显示一次的令牌' \
  -H 'Idempotency-Key: sync-src-xxx-20261025-1' -H 'Content-Type: application/json' \
  -d '{"force":false}'

curl 'https://kb.example.com/api/v1/jobs/job_xxx' \
  -H 'Authorization: Bearer kb_只显示一次的令牌'
```

所有 API 写操作都要求 8–128 位 `Idempotency-Key`。同一凭据、路由和键会重放第一次结果；键相同但请求体不同返回 `409`。错误统一为 `{"error":{"code":"...","message":"...","details":...}}`。

## MCP 客户端

服务使用官方 TypeScript SDK v2，提供 Streamable HTTP。

| 工具 | scope | 属性 |
| --- | --- | --- |
| `search_documents` | `documents:read` | 只读、幂等 |
| `get_document` | `documents:read` | 只读、幂等 |
| `list_sources` | `sources:read` | 只读、幂等 |
| `get_sync_job` | `jobs:read` | 只读、幂等 |
| `create_source` | `sources:write` | 写入、非破坏、幂等、需 `confirm=true` |
| `update_source` | `sources:write` | 写入、非破坏、幂等、需 `confirm=true` |
| `start_source_sync` | `sync:write` | 写入、异步、幂等、需 `confirm=true` |

删除、批量修改、发布、Provider 密钥与聊天删除未通过 MCP 开放。

支持官方 MCP TypeScript/Python SDK、MCP Inspector，以及能为 Streamable HTTP 配置 Bearer Header或 OAuth client_credentials 的客户端。不支持只接受授权码网页登录且无法配置预置客户端凭据的客户端。

```json
{
  "mcpServers": {
    "zhiyu": {
      "url": "https://kb.example.com/mcp",
      "headers": { "Authorization": "Bearer kb_只显示一次的令牌" }
    }
  }
}
```

OAuth client_credentials 使用凭据 ID 作为 `client_id`，一次性显示的 `kb_...` 令牌作为 `client_secret`：

```bash
curl -X POST https://kb.example.com/oauth/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=client_credentials&client_id=key_xxx&client_secret=kb_xxx&scope=documents%3Aread%20sources%3Aread'
```

返回的 `mcp_...` access token 有效期为 1 小时；撤销父凭据会立即使所有派生 token 失效。

## 部署与回滚

Jenkins 流水线在停服后、更新代码前，将 `.data` 和 `.env` 一致性备份到 `/opt/KnowledgeBase/.backups/knowledgebase-时间.tar.gz`，保留最近 10 份。数据库变更只有新增表和索引，不修改历史表；服务启动时自动执行幂等迁移。

回滚代码和数据：

1. `sudo systemctl stop knowledgebase.service`。
2. 保存当前 `/opt/KnowledgeBase/.data`，不要覆盖唯一副本。
3. 在临时目录解压目标备份，确认包含 `.data/knowledge.db` 与 `secret.key`。
4. 恢复上一版代码，再把备份的 `.data`、`.env` 恢复到 `/opt/KnowledgeBase`。
5. `sudo systemctl start knowledgebase.service`，验证 `/api/health`、网页登录和一条只读 API。

仅回滚代码时，新表可安全保留；如需彻底回滚数据库，应恢复部署前备份，而不是手工删表。
