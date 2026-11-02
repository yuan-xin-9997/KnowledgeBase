# 安全首次安装与离线体验

需要 Docker Engine / Docker Compose，或 Node.js 24 + npm。示例材料全部虚构，无需 NAS、Jenkins、个人账号或付费模型。保持现有 Apache-2.0 许可证和声明。

## Docker Compose

```sh
git clone https://github.com/yuan-xin-9997/KnowledgeBase.git
cd KnowledgeBase
docker compose --profile demo up -d --build
docker compose exec app npm run init-admin
```

最后一条命令需在交互终端执行，依次输入邮箱、用户名、密码（不回显）。密码不作为命令参数、环境变量或初始化文件保存；仅保存 bcrypt 哈希。输入无效或操作中断可重试。只允许空库初始化；成功标记与管理员在同一 SQLite IMMEDIATE 事务提交，并发初始化只有一次成功。公开注册无法创建首管理员。服务进程与初始化命令须使用同一个 DATA_DIR；Compose 已配置相同持久卷。

打开 <http://localhost:36080> 登录。默认仅绑定本机；需对外提供服务时设置 `BIND_ADDRESS`、`PORT`、`APP_ORIGIN`（例如 `https://kb.example.com`），并自行配置 HTTPS 反向代理。修改配置后运行 `docker compose up -d`。注册默认关闭，需允许普通用户加入时显式设置 `ALLOW_REGISTRATION=true`。普通注册永远是 user，无论请求是否传 role 字段。

应用数据与自动生成的 secret.key 存在本机 Docker 命名卷 `kb-data`，`docker compose down` 保留数据；不要使用 `down -v`。不要更换已有 APP_SECRET 或 secret.key。已有用户库直接升级，无需初始化；迁移只补初始化标记，不改变用户角色或会话。未设置 ALLOW_REGISTRATION 的旧安装升级后将关闭普通注册，按需显式设为 true。

## 接入示例、搜索与核对引用

1. 管理员进入「信息来源」，新增本地目录，路径 `/materials`，名称「虚构资料」，测试后同步。该目录在容器中以 `:ro` 挂载；应用只读取原件，在独立数据卷写索引。普通用户不能创建、更新或测试本地目录来源；可以使用自己的 SMB / API 凭据。不同用户的来源和文档不共享。
2. 检索「海岬」并打开《海岬项目》，核对资料编号 DEMO-001、版本 2026-11-01、试运行日期 2026-12-15 与负责人林澄。
3. 「设置 → AI 模型」新增 OpenAI 兼容配置：Base URL `http://demo-model:38081/v1`，模型 `offline-demo`，API Key 填任意虚构占位值 `demo-only`。这只是协议演示服务，无上游调用、不记录请求，返回固定且显著标注的演示答案，不代表模型推理质量。
4. 打开《海岬项目》的 AI 侧栏，范围选「当前文档」，提问「海岬项目试运行日期和负责人是什么？」。点击 `[1]` 回到原文，核对引用标题、片段、日期与负责人。固定演示答案只适用于该材料；不要用它评估其他问题。刷新会话后核对引用仍可打开。
5. 要体验真实生成，可停用 demo profile，将模型地址改为自己管理的兼容服务（容器内 localhost 指容器本身）。只有你主动发送问题/测试模型时才调用所配置服务；检索片段会发送给该模型，外部服务可能收费。

## 不使用 Docker

```sh
npm ci
npm run typecheck
npm test
npm run build
# 可复制 .env.example 为 .env；使用独立 DATA_DIR
npm run init-admin
npm start
```

管理员接入 `examples/materials` 的绝对路径。可在另一个终端运行 `node scripts/demo-model.mjs`，把 Base URL 改为 `http://127.0.0.1:38081/v1`。若只允许本机访问该演示服务，设置 `DEMO_HOST=127.0.0.1`。本机程序使用 DATA_DIR（默认 ./data）；不要让测试或试用指向生产数据。PowerShell 设置变量示例：`$env:DATA_DIR='E:\kb-trial\data'`。

## 备份与恢复演练

管理员在「设置 → 备份」创建并验证快照。快照包含所有用户的数据库与实际主密钥，按敏感数据保管。验证会检查校验和、SQLite 完整性、外键和配置解密。原件、SMB 缓存、浏览器阅读状态不在应用快照中；来源仍需保留并在恢复后重新同步缓存。

Compose 中可恢复到持久卷内一个**尚不存在**的子目录：

```sh
docker compose exec app node scripts/restore-backup.mjs /app/data/backups/backup-UUID /app/data/recovery-trial
```

用实际备份编号替换 UUID。脚本拒绝覆盖已有目录。可先在隔离试用服务中将 DATA_DIR 指向 `/app/data/recovery-trial` 验证健康、登录、来源、检索和引用；切换正式实例前先停服并保留原卷以便回退。主密钥沿用恢复目录的 secret.key；若有 APP_SECRET 覆盖，需保持与备份一致。独立恢复和回退步骤详见 [阅读与恢复说明](READING_AND_RECOVERY.md)。离机备份应由管理员安全转存整个快照目录，不要只复制运行中的 knowledge.db。

## 离线验证边界

`npm run typecheck`、`npm test`、`npm run build` 是 GitHub Actions 的检查入口。测试使用临时目录、虚构凭据及模拟上游，不读取生产挂载，不运行 `scripts/acceptance.mjs`，不调用付费模型。安装 npm 包及构建镜像仍需要依赖下载网络。

真实来源验收是单独的、由操作者显式配置并运行的流程，见 [验收说明](ACCEPTANCE.md)。
