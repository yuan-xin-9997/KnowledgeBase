# 知屿 · KnowledgeBase

自托管的个人知识中枢：把 NAS 专业资料、Cubox 收藏、语雀文档与本地文件聚合到一处，提供统一检索、来源筛选和「有据可依」的 AI 会话。

- 服务监听：`0.0.0.0:36080`
- 多用户注册 / 登录（第一个账号自动成为管理员）
- 数据全部保存在自己的服务器（SQLite + 本地文件），不依赖第三方云服务
- 部署：Jenkins 每 30 分钟轮询 GitHub，构建通过后停服、同步到 `/opt/KnowledgeBase`、systemd 启动

## 功能

### 阅读工作台

登录后默认进入三栏知识库：左侧按来源、类型与标签组织资料，中间紧凑列表检索，右侧直接阅读正文。可用上下方向键切换文档，保留现有全文、附件和日期筛选；较长正文按需继续载入。

阅读时可展开 AI 侧栏，切换当前文档、当前来源、全部知识库或通用对话，并使用已配置的模型生成带引用回答。会话保存在服务端，也可进入完整会话继续。保存的筛选保存在当前浏览器，按登录用户隔离。手机端切换为列表与阅读页，并保留返回与来源导航。

### 1. 多源聚合

| 类型 | 接入方式 | 说明 |
| --- | --- | --- |
| 本地目录 | 服务器本地路径 / Windows UNC 路径 | 适合已挂载的 NAS、同步盘、资料目录 |
| SMB | 主机、共享名、账号密码 | 直接读取 Samba / NAS 共享，无需预先挂载 |
| Cubox | API 扩展链接（`https://cubox.pro/c/api/save/…`） | 同步收藏、正文 Markdown、高亮标注与 AI 解读 |
| 语雀 | 个人 Token | 同步知识库目录下的文档正文 |

- 手动同步、定时同步（按来源设置间隔）、全量重同步
- 增量更新：按来源更新时间 + 文件大小跳过未变化内容
- 同步任务进度、统计（新增/更新/跳过/删除/错误）与历史记录
- 自动文本抽取：PDF、DOCX、XLSX、PPTX、EPUB、HTML、Markdown、TXT、常见代码文件；自动识别 GBK/GB18030/Big5/UTF-16 编码
- 二进制/媒体文件保留元数据，可按文件名检索

### 2. 检索

- 标题、正文、标签统一全文检索（SQLite FTS5，中文按字符建索引，无需额外分词服务）
- 按来源、类型、标签、时间范围筛选；按相关度 / 最新 / 最早排序
- 摘录高亮、分页、搜索建议
- 原始附件在线预览 / 下载（本地、挂载目录与 SMB 缓存原件）

### 3. AI 会话

- 兼容 OpenAI 与 Anthropic 协议，任意 base URL / 模型 ID
- 多套模型配置，API Key AES-256-GCM 加密存储，界面只显示掩码
- 新建会话时可选择知识范围：
  - 全部知识库
  - 指定一个或多个信息来源
  - 指定单篇或多篇文档
  - 不使用知识库（纯通用对话）
- 基于问题的检索增强（RAG），回答带 `[1] [2]` 引用，可跳回原文
- SSE 流式输出、停止生成、会话重命名 / 删除、历史消息持久化

### 4. 多用户与安全

- 注册 / 登录 / 退出，HttpOnly Cookie 会话，bcrypt 密码哈希
- 所有来源、文档、模型、会话按用户隔离
- 服务器本地目录仅管理员可接入；普通用户通过自己的 SMB 或 API 凭据连接来源
- 密钥加密存储；接口不回显明文
- 同源校验（CSRF 防护）、登录限流

## 技术栈

- 前端：React 19、Vite 7、TypeScript、Tailwind CSS 4、react-router、react-markdown
- 后端：Node.js 22+、Fastify 5、TypeScript、better-sqlite3（WAL + FTS5）
- 文本抽取：unpdf、mammoth、xlsx、jszip、cheerio、chardet、iconv-lite
- 部署：systemd + Jenkins（仓库内 `JenkinsConfig/`）

## 目录

```
server/                 Fastify API、SQLite、连接器、同步、检索、AI
  src/connectors/       local / smb / cubox / yuque + 文本抽取
  src/services/         sources / sync / search / ai / rag
  src/routes/           auth / sources / documents / search / stats / providers / chat
web/                    React 单页应用
JenkinsConfig/          Jenkinsfile、部署脚本、systemd 单元、任务配置
scripts/                验收脚本
```

## 本地开发

前置：Node.js >= 22.9（建议 24）、npm 10+。

```bash
npm ci
npm run build          # 构建前端与服务端
DATA_DIR=./data PORT=36080 HOST=0.0.0.0 npm start
```

开发模式（服务端热重载 + Vite）：

```bash
npm run dev:server     # API :36080
npm run dev:web        # 前端 :5173，/api 代理到 36080
```

打开 `http://localhost:36080`（生产构建）或 `http://localhost:5173`（开发）。首次访问注册的第一个账号即管理员。

> Windows PowerShell 设置环境变量：`$env:DATA_DIR='E:\dev\KnowledgeBase\data'; $env:PORT='36080'`。

## 配置

复制 `.env.example` 为 `.env`（或直接使用部署脚本自动生成的配置）：

根目录 `npm start` 与 `npm run dev:server` 使用 Node 原生功能加载此文件；直接运行 `node server/dist/index.js` 时请自行传入环境变量。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听网卡 |
| `PORT` | `36080` | 监听端口 |
| `DATA_DIR` | `./data` | SQLite 与密钥文件目录 |
| `APP_SECRET` | 自动生成 | 加密来源配置与模型 Key 的主密钥；务必持久化 |
| `APP_ORIGIN` | 空 | 反向代理场景下的外部访问 Origin，如 `https://kb.example.com` |
| `ALLOW_REGISTRATION` | `true` | 是否开放注册 |
| `SESSION_DAYS` | `30` | 登录有效期 |
| `SYNC_SCHEDULER` | `true` | 是否启用定时同步 |
| `API_RATE_LIMIT` | `120` | `/api/v1` 与 `/mcp` 每 IP 每分钟请求上限 |
| `NODE_ENV` | `production` | 生产环境关闭开发日志美化 |

`APP_SECRET` 丢失将无法解密已保存的数据源密码和模型 Key；请与 `.data/` 一起备份。

## 数据源接入

### 本地目录

- `path`：服务器可读的绝对路径，或 Windows UNC（如 `\\192.168.0.100\personal_folder\...`）
- `includeExtensions`：逗号分隔；留空使用默认文档/代码类型
- `excludeGlobs`：逗号分隔，如 `*.tmp,**/cache/**`
- `maxFileSizeMb`：默认 100
- `maxFiles`：默认 20000，防止误扫超大目录

### SMB

填写 `host`、`share`、`username`、`password`，可选 `domain` 与 `basePath`。密码加密存储且不回显；编辑时留空即保持原密码。

采用 SMB 2.0.2 / 2.1 和 NTLMv2，兼容 Node 22+；若 NAS 强制 SMB3 加密，请由管理员预挂载后接入本地目录。原件按用户和来源隔离缓存至 `DATA_DIR/attachments/`，默认每来源最多 1GB，可通过 `maxCacheSizeMb` 调整；达到上限时仍保留正文索引，但原件下载不可用。备份数据目录时需包含这些缓存。

### Cubox

1. Cubox 偏好设置 → 扩展中心和自动化 → API 扩展 → 启用并复制链接
2. 在「信息来源」中粘贴链接（形如 `https://cubox.pro/c/api/save/xxxx`）
3. 可选限制文件夹 / 标签、单次条数（默认 500）、最近天数、是否包含归档
4. `fetchDetails` 默认开启：会同步正文、标注与 AI 解读；关闭则只同步标题与摘要，速度更快

Cubox 读取使用官方 CLI 同源的 `/c/api/cli/*` 接口，链接中的 token 即身份凭证，请勿泄露。

### 语雀

在语雀「个人设置 → Token」创建 Token，填入即可。可选 `login`（默认自动获取）和 `repoIds`（`user/repo` 或 `group/repo` 白名单）。

## AI 配置

「设置 → AI 模型」中新增：

- 协议：OpenAI 兼容 / Anthropic 兼容
- Base URL 示例：
  - OpenAI：`https://api.openai.com/v1`
  - DeepSeek（Anthropic 兼容）：`https://api.deepseek.com/anthropic`
  - 智谱（OpenAI 兼容）：`https://open.bigmodel.cn/api/paas/v4`
  - xAI：`https://api.x.ai/v1`
- 模型 ID、API Key、温度、最大输出 tokens

保存后可在会话中切换。模型 Key 使用 `APP_SECRET` 派生密钥加密。

## 部署（Jenkins）

仓库内已包含：

- `JenkinsConfig/Jenkinsfile`：拉取 → 构建测试 → 停服 → 同步 → 启动 → 健康检查
- `JenkinsConfig/deploy.sh`：四个阶段的部署实现
- `JenkinsConfig/knowledgebase.service`：systemd 单元（`0.0.0.0:36080`）
- `JenkinsConfig/job-config.xml`：Jenkins 流水线任务定义（SSH 仓库、每 30 分钟轮询、`JenkinsConfig/Jenkinsfile`）
- `JenkinsConfig/sudoers.d-knowledgebase-deploy`：允许 Jenkins 用户管理该服务
- `JenkinsConfig/README.md`：首次部署与排障

Jenkins 地址：`http://192.168.0.111:8080/`，任务名 `KnowledgeBase`。

## 检索实现说明

SQLite FTS5 的 `unicode61` 分词器不会切分中文，因此入库时把中日韩字符逐字转为 token（拉丁词保持完整），检索时把中文查询转换为有序短语。这样无需部署 Elasticsearch/Meilisearch，也能获得准确的中文全文匹配与相关度排序；英文支持前缀匹配。标题权重高于正文与标签。

## 安全与隐私

- 服务不向外发送知识库内容，只有调用你配置的模型 API 时才会把检索片段作为上下文发送
- 模型/来源密钥加密存储，API 只返回掩码
- 会话 Cookie 为 HttpOnly + SameSite=Lax；生产建议放在 HTTPS 反向代理后
- 定时任务与同步日志不记录密码或 token
- 部署备份：流水线在停服前用 SQLite Backup API 在线生成一致性快照，并保护性保存配置；手工备份与回滚见接入说明

## 验收

`scripts/acceptance.mjs` 会通过真实 API 完成：注册登录 → 接入 NAS 专业资料并同步 → 正文/附件/时间检索与原件读取 → 接入 Cubox 并验证正文检索 → 配置真实模型 → 验证六种知识范围的引用问答与历史保存。需设置 `KB_PASSWORD`，不提供公共默认密码。运行方式见 [验收说明](docs/ACCEPTANCE.md)。

面向 AI 的 v1 API、OpenAPI、远程 MCP 地址、凭据权限和接入示例见 [API 与 MCP 接入说明](docs/API_MCP.md)。

登录后可在「设置 → AI 接入」直接创建、测试和撤销自动化凭据；完整密钥仅显示一次。需求与设计分别见 [需求规格说明书](docs/REQUIREMENTS.md) 和 [设计说明书](docs/DESIGN.md)。

## 已知限制

- 图片 OCR、音视频转写未内置（保留元数据与文件名检索）
- 旧版 `.doc` / `.ppt` 二进制格式只能按文件名检索
- 本地目录连接器读取的是「服务器可见」的文件；Linux 上访问 NAS 推荐使用 SMB 连接器或预先 CIFS 挂载
- SQLite 适合个人/小团队规模；超大团队建议替换为 PostgreSQL + 专用检索引擎
