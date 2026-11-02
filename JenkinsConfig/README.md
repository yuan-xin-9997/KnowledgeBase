# 部署与 Jenkins 配置

部署目标：`deploy.example.com`，目录 `/opt/KnowledgeBase`，systemd 服务 `knowledgebase.service`，监听 `0.0.0.0:36080`。

## 流水线结构

`Jenkinsfile` 调用 `deploy.sh` 的四个阶段：

1. `prepare`：`npm ci` → `typecheck` → `test` → `build` → SQLite 在线一致性备份。此阶段失败不会停止线上服务。
2. `stop`：备份确认成功后才执行 `systemctl stop knowledgebase.service`。
3. `update`：`rsync` 工作区到 `/opt/KnowledgeBase`，保留 `.data/`、`.env`、`node_modules/`。
4. `start`：安装/刷新 systemd 单元，必要时 `npm ci --omit=dev`，启动服务，`health.mjs` 轮询 `/api/health`。

触发器：`pollSCM('H/30 * * * *')`，仓库使用 SSH 地址 `git@github.com:yuan-xin-9997/KnowledgeBase.git`，凭据示例为 `your-github-ssh-credential-id`，导入前替换为自己的 Jenkins 凭据 ID；既有任务无需重新导入。

## 首次准备（在 deploy.example.com 上以有 sudo 权限的账号执行）

```bash
sudo mkdir -p /opt/KnowledgeBase/.data
sudo chown -R jenkins:jenkins /opt/KnowledgeBase

# 安装服务定义（之后 deploy.sh 会自动刷新）
sudo install -m 0644 /opt/KnowledgeBase/JenkinsConfig/knowledgebase.service \
  /etc/systemd/system/knowledgebase.service
sudo systemctl daemon-reload
sudo systemctl enable knowledgebase.service

# 允许 jenkins 用户管理该服务
sudo install -m 0440 /opt/KnowledgeBase/JenkinsConfig/sudoers.d-knowledgebase-deploy \
  /etc/sudoers.d/knowledgebase-deploy
sudo visudo -cf /etc/sudoers.d/knowledgebase-deploy
```

首次启动前可手动生成 `.env`（`deploy.sh start` 也会自动生成）：

```bash
sudo -u jenkins tee /opt/KnowledgeBase/.env >/dev/null <<'EOF'
NODE_ENV=production
HOST=0.0.0.0
PORT=36080
DATA_DIR=/opt/KnowledgeBase/.data
SYNC_SCHEDULER=true
TZ=Asia/Shanghai
EOF
# APP_SECRET 不填时服务会自动生成 .data/secret.key
sudo chmod 600 /opt/KnowledgeBase/.env
```

空库首次启动后，在部署目录用服务运行账号执行 `npm run init-admin`（交互输入管理员密码，需加载同一 `.env`）。旧库无需初始化。普通注册默认关闭，需要时在 `.env` 显式设置 `ALLOW_REGISTRATION=true`。

## 创建 Jenkins 任务

使用仓库内的 `job-config.xml`（需要 Jenkins 管理员账号与 API Token）：

```bash
JENKINS=http://deploy.example.com:8080
AUTH=admin:<API_TOKEN>

# 取 CSRF crumb
CRUMB=$(curl -s -u "$AUTH" "$JENKINS/crumbIssuer/api/json" | python3 -c 'import sys,json;print(json.load(sys.stdin)["crumb"])')

curl -s -u "$AUTH" -H "Jenkins-Crumb: $CRUMB" \
  -H 'Content-Type: application/xml' \
  --data-binary @JenkinsConfig/job-config.xml \
  "$JENKINS/createItem?name=KnowledgeBase"
```

任务已存在时改用：

```bash
curl -s -u "$AUTH" -H "Jenkins-Crumb: $CRUMB" \
  -H 'Content-Type: application/xml' \
  --data-binary @JenkinsConfig/job-config.xml \
  "$JENKINS/job/KnowledgeBase/config.xml"
```

首次构建：

```bash
curl -s -u "$AUTH" -H "Jenkins-Crumb: $CRUMB" -X POST "$JENKINS/job/KnowledgeBase/build"
```

## 验证

```bash
curl -fsS http://deploy.example.com:36080/api/health
sudo systemctl status knowledgebase.service --no-pager
sudo journalctl -u knowledgebase.service -n 100 --no-pager
cat /opt/KnowledgeBase/DEPLOYED_COMMIT
```

## 排障

- **服务起不来**：先看 `journalctl`。常见原因：`APP_SECRET` 变化导致旧数据无法解密（恢复原 `.data/secret.key` 或原 `APP_SECRET`）、端口被占用、数据目录权限不是 `jenkins`。
- **npm ci 失败**：确认服务器 Node >= 22，并且 `package-lock.json` 已提交。
- **健康检查失败**：手动 `sudo -u jenkins bash -lc 'cd /opt/KnowledgeBase && NODE_ENV=production node server/dist/index.js'` 查看启动日志。
- **Cubox 同步失败**：确认 API 扩展链接未刷新失效；链接中的 token 等同密码，不要提交到仓库。
- **NAS 本地目录为空**：`local` 连接器读取的是「服务器可见」的路径；Linux 上请使用 SMB 连接器，或先把 NAS 挂载到 `/mnt/nas` 再填写该路径。

## 回滚

```bash
cd /opt/KnowledgeBase
git log --oneline -5
# 在 Jenkins 中选择历史构建的提交，或手动 checkout 后重新执行部署脚本
sudo systemctl restart knowledgebase.service
```

备份只包含 SQLite 一致性快照、`.env` 和 `secret.key`；附件缓存可从原始来源重新同步，不纳入停服前备份。部署脚本不自动回滚；数据库结构变更均为向后兼容的新增表或列。
