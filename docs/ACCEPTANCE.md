# 验收方法

验收包括自动回归测试、浏览器操作和真实来源端到端测试。模拟上游的测试用于验证协议、错误处理和权限；真实来源测试单独记录。

## 构建和回归

需要 Node.js 22.9+，建议 24。

```bash
npm ci
npm run typecheck
npm test
npm run build
npm start
```

根目录 `.env` 会在 `npm start` 和 `npm run dev:server` 时读取。默认监听 `0.0.0.0:36080`，数据在根目录 `data/`。Jenkins 部署使用 `/opt/KnowledgeBase/.data/`。

## 真实数据验收

先启动服务，设置以下环境变量（不要把凭据写进仓库）：

| 环境变量 | 用途 |
| --- | --- |
| `KB_BASE_URL` | 默认 `http://127.0.0.1:36080` |
| `KB_ACCOUNT` / `KB_PASSWORD` | 验收账号与密码，密码必填；新环境自动注册，已有账号则登录 |
| `KB_LOCAL_PATH` | Windows UNC 或服务器可读的专业资料目录 |
| `KB_LOCAL_MAX` | 默认 12 份，控制首次抽取成本 |
| `CUBOX_API_LINK` | Cubox API 扩展授权链接 |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | 可用模型配置 |
| `AI_PROTOCOL` | `openai` 或 `anthropic` |

```bash
node scripts/acceptance.mjs
```

Linux 直接连接 NAS 时，改设 `KB_SMB_HOST`、`KB_SMB_SHARE`、`KB_SMB_USERNAME`、`KB_SMB_PASSWORD`、`KB_SMB_PATH`，脚本会使用 SMB 来源。路径为共享下的相对路径。

脚本验证：专业资料和 Cubox 真实同步、正文非空、正文词检索、标题检索、附件检索和原件 Range 读取、日期筛选、密钥不回显、真实模型测试，以及单篇专业资料、单篇 Cubox、单来源、多来源、全部知识库、无来源六种会话。每种会话检查完成帧、引用范围和历史持久化，多来源需在回答中分别引用两个来源。增量重跑不会强制重新抽取未修改文件。

每次运行结果保存为 `artifacts/acceptance-*.json`，失败运行也会保存报告并返回非零退出码。报告包含私人文档标题与回答，已通过 `.gitignore` 排除。首次只取 12 份是抽样验收，并不代表已导入整座资料库；实际使用可在来源设置中扩大上限并开启定时同步。

## 浏览器检查

注册/登录后，依次验证来源添加、连接测试、同步状态、来源记录、关键词与日期过滤、原文打开、模型编辑与测试，以及会话范围保存后刷新仍保持。界面截图同样保存在 `artifacts/`，不提交个人数据。

## 部署验收

Jenkins 任务 `KnowledgeBase` 应使用 SSH 仓库、`JenkinsConfig/Jenkinsfile` 和每 30 分钟 SCM 轮询。以首次构建成功、部署提交与 GitHub 一致、systemd active、监听 `0.0.0.0:36080`、健康响应中 `ok=true` 且 `service=knowledge-base` 为准。

生产环境来源必须从生产服务器重新验证。Windows 可访问 UNC 不能证明 Linux 已能连接 NAS；SMB 密码缺失时必须单独列为待验收，不能用本地抽样结果替代。
