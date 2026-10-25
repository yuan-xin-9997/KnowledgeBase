# AI 接入设计说明书

## 架构

`/api/v1` 与 `/mcp` 都先把 Bearer 凭据解析为现有用户，再调用 `external-access.ts` 中的共享业务入口。业务入口继续调用原有检索、来源和同步服务，因此用户隔离、本地目录管理员限制、连接器校验和任务规则保持一致。

网页管理入口位于 `/settings/ai-access`，沿用 React 路由、Layout、Cookie 会话、同源 CSRF 防护和现有组件样式。

## 数据

- `api_credentials`：只保存 SHA-256 摘要、非敏感前缀、scope、有效期、撤销和最后使用时间。
- `oauth_access_tokens`：保存短期 token 摘要、父凭据和有效期；父凭据撤销或用户停用后立即失效。
- `idempotency_records`：按凭据、路由和幂等键保存请求摘要和首次响应。
- `audit_logs`：保存身份引用、渠道、动作、目标、结果和时间。
- `users.active`：账号启用状态。旧数据库启动时通过列检查执行向后兼容迁移，默认值为启用。

## 密钥生命周期

创建响应设置 `Cache-Control: no-store` 和 `Pragma: no-cache`。前端只在 React state 中保存完整密钥；关闭一次性提示或离开页面即清除。列表只读取前缀与元数据。代码不写入 Web Storage、URL、日志、埋点或文件。

## MCP 与客户端

官方 SDK v2 提供 Streamable HTTP，支持 Bearer Header 与 OAuth client_credentials。Protected Resource Metadata 和 Authorization Server Metadata 用于发现。已验证官方 TypeScript 客户端；Python SDK、MCP Inspector及其他支持相同协议的客户端属于协议适配，需按客户端版本复核。只支持交互式授权码且不能配置机器凭据的客户端不支持。

## 部署与回滚

Jenkins 在停服前完成安装、类型检查、测试和构建；停服后先备份 `.data` 与 `.env`，再同步并重启。数据库变更为新增表/列；完整回滚使用部署前备份，代码回滚可保留新增结构。
