# 本地修复与验证记录（2026-11-02）

## 核查基线

- `origin` 为 `git@github.com:yuan-xin-9997/KnowledgeBase.git`，与目标仓库一致。
- 本次基线 HEAD：`cc7c25fc22f8c8f5a4a0d2e3eede5caf2e478d4e`，并非旧审查的 `69df766`。
- 原工作区 `E:\dev\KnowledgeBase` 状态干净，没有未提交修改；所有改动位于独立 worktree `E:\dev\KnowledgeBase-safe-onboarding`，分支 `codex/safe-onboarding`。
- 仓库根没有实体 AGENTS.md，遵循用户提供的 AGENTS 指引。没有读取个人凭据索引、生产目录或候选密钥。
- 已读当前 README、测试、auth/config/db、来源服务与路由、连接器同步、备份创建/验证/恢复链路。
- 当前 LICENSE 为 Apache-2.0，原文件未改动；未替权利人更换许可。

## 当前问题与修复

1. 当前代码仍存在空库公开注册成为管理员的窗口。新增 `server/src/initialize.ts` 与 `scripts/init-admin.mjs`，通过 `npm run init-admin` 在本机交互输入账号与不回显密码。复用注册验证及 bcrypt；SQLite IMMEDIATE 事务在持锁后复核用户和标记，一次提交管理员与 `admin_initialized`。失败全部回滚；成功后重启、删空用户也不会重新开放初始化。初始化不创建会话。
2. `server/src/routes/auth.ts` 拒绝空库普通注册，普通注册角色固定 user；`server/src/config.ts` 与 `.env.example` 默认关闭注册。`server/src/db.ts` 对已有用户库幂等补标记，不修改用户、会话、密码或主密钥。注册/密码修改共用校验抽到 `registration.ts`。登录页同步修正首用户管理员提示。
3. `services/sources.ts` 的本地目录管理员检查原本有效，未重写。新增失去管理员权限后更新及两类测试路径的回归用例；已有创建/测试、用户隔离、只读原件和备份恢复检查保留。
4. 新增 Dockerfile、Compose、本地持久数据卷、只读挂载的 `examples/materials`。demo profile 提供固定响应的本机 OpenAI 协议桩，无任何上游调用；界面回答显著标明非模型推理，只用于示例文档的引用核对。真实模型服务仍由用户配置。
5. 保留 Jenkins/systemd 运维；个人主机地址、来源默认路径和凭据 ID 改成示例或显式输入。真实验收脚本不再自动注册或默认扫描个人 NAS，且不纳入 CI。
6. 新增 `.github/workflows/offline.yml`，仅复用安装、typecheck、test、build，无部署步骤、生产挂载或模型凭据。

## 已验证

环境：Windows，Node.js `v24.13.0`，npm `11.19.0`。

| 命令/检查 | 本次结果 |
| --- | --- |
| `npm ci --no-audit --no-fund` | 成功，安装 411 个包；有依赖弃用提示 |
| `npm run typecheck` | 服务端与前端通过 |
| `npm test` | 11 个服务端测试文件、66 项测试通过；阅读器检查通过 |
| `npm run build` | 前后端构建通过；Vite 提示前端主包大于 500 kB，未做无关拆包 |
| `docker compose --profile demo config --quiet` | Compose 配置解析通过，仅属配置验证 |
| `git diff --check` | 通过；Git 提示 Jenkinsfile 换行将归一化为 LF |
| 构建产物进程冒烟 | 临时虚构数据目录中启动 `server/dist/index.js`，健康检查、前端 HTML、初始化管理员登录、关闭注册均通过，进程与临时数据已清理 |

初始化测试涵盖：开放注册情况下的空库攻击、非法初始化密码、错误登录密码、同一进程与独立进程并发初始化、并发普通注册、插入标记失败回滚、进程在未提交事务内退出后的恢复、重启持久性、已有用户/会话迁移、默认关闭注册。采用本机命令机制，因此不存在需校验的一次性 HTTP 初始化令牌。

端到端离线 API 回归实际读取仓库虚构材料，执行本地连接器同步与中文检索，通过 loopback HTTP 调用演示协议服务（含非流式测试与流式问答），读取会话历史、引用和原文，并比较原件内容及 mtime。备份回归验证管理员边界、恢复到独立目录、拒绝覆盖及篡改检测。

## 仅静态检查 / 未执行

- Dockerfile 已按现有 npm 构建链编写，但 Docker Engine 管道不存在，`docker version` 无法连接 daemon。**未构建镜像、未启动容器、未验证容器内权限/命名卷/恢复切换**。
- 初始化服务逻辑已测试；交互式 CLI 的真实终端不回显体验仅静态检查，未做人工终端交互验收。
- GitHub Actions 工作流已配置并在本地执行同等命令，未在 GitHub 上运行。未进行浏览器人工点击验收。
- 未运行真实 NAS、Cubox、语雀或付费模型验收；未运行 Jenkins、部署、发布、推送、远程可见性修改、生产凭据轮换或历史改写。

## 兼容性与外部后续

- 已有数据库无需重新初始化。若旧安装未显式设置 ALLOW_REGISTRATION，升级后普通注册将关闭；需要时显式设置 true。原会话及 APP_SECRET/secret.key 均沿用。
- 应用快照仍只覆盖数据库与有效主密钥，不包括来源原件和 SMB 缓存；恢复后需要原来源或重新同步。未改变已有恢复格式。
- 在可用 Docker 主机按 [首次安装指南](QUICKSTART.md) 执行 build/up、交互初始化、引用点击与恢复演练。需要真实生成时由管理员配置自有服务，明确其数据发送及费用边界。
- 推送与发布由用户另行安排；远端 CI 结果和部署成功不能由本地结果替代。
