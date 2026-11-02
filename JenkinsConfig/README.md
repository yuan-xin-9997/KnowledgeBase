# 部署与 Jenkins 配置

部署目标：`deploy.example.com`，目录 `/opt/KnowledgeBase`，systemd 服务 `knowledgebase.service`，监听 `0.0.0.0:36080`。

## 流水线结构

`Jenkinsfile` 调用 `deploy.sh` 的四个阶段：

1. `prepare`：`npm ci` → `typecheck` → `test` → `build` → SQLite 在线一致性备份。此阶段失败不会停止线上服务。
2. `stop`：备份确认成功后才执行 `systemctl stop knowledgebase.service`。
3. `update`：`rsync` 工作区到 `/opt/KnowledgeBase`，保留 `.data/`、`.env`、`node_modules/`。
4. `start`：校验生产 systemd 单元由 `root:root` 持有且部署账号不可写，必要时 `npm ci --omit=dev`，重启固定服务，`health.mjs` 轮询 `/api/health`。

触发器：`pollSCM('H/30 * * * *')`，仓库使用 SSH 地址 `git@github.com:yuan-xin-9997/KnowledgeBase.git`，凭据示例为 `your-github-ssh-credential-id`，导入前替换为自己的 Jenkins 凭据 ID；既有任务无需重新导入。

## 安全边界与部署约束

- `/opt/KnowledgeBase` 及 `JenkinsConfig/` 归 `jenkins:jenkins`，属于应用可写目录；其中的 `knowledgebase.service` 和 `sudoers.d-knowledgebase-deploy` 只是参考副本，不是生产配置。
- 生产 unit 固定为 `/etc/systemd/system/knowledgebase.service`，由 `root:root` 持有；Jenkins 没有 `/etc/systemd/system`、`/etc/sudoers.d` 或 `/usr/local/sbin` 的写权限。
- Jenkins 的 sudo 权限只包含对该固定 unit 的 `stop`、`start`、`restart`。禁止恢复 `install`、`daemon-reload`、`enable` 或任意文件路径参数。
- 部署脚本不执行应用目录中的脚本作为 root，也不继承 Jenkins 环境变量作为 root 命令的配置。

## 首次准备（仅 root 执行）

生产 unit 和 sudoers 由 root 安装、持有和维护。`JenkinsConfig/` 中的副本仅供审阅，部署账号不能安装它们。

```bash
sudo mkdir -p /opt/KnowledgeBase/.data
sudo chown -R jenkins:jenkins /opt/KnowledgeBase

# 1. 在 root 控制的目录中准备并审核 unit/sudoers 模板。
#    不要给 jenkins 增加 install/daemon-reload/enable 的免密权限。
sudo install -d -m 0700 /root/knowledgebase-unit
sudo install -m 0600 /opt/KnowledgeBase/JenkinsConfig/knowledgebase.service \
  /root/knowledgebase-unit/knowledgebase.service
sudo install -m 0600 /opt/KnowledgeBase/JenkinsConfig/sudoers.d-knowledgebase-deploy \
  /root/knowledgebase-unit/sudoers.d-knowledgebase-deploy
sudo chown root:root /root/knowledgebase-unit/*
# 审核内容后再继续。

# 2. 安装固定生产 unit，保持 root:root 0644。
sudo install -m 0644 /root/knowledgebase-unit/knowledgebase.service \
  /etc/systemd/system/knowledgebase.service
sudo systemctl daemon-reload
sudo systemctl enable knowledgebase.service

# 3. 安装最小 sudo 规则：仅允许 jenkins 对固定 unit 执行 stop/start/restart。
sudo install -m 0440 /root/knowledgebase-unit/sudoers.d-knowledgebase-deploy \
  /etc/sudoers.d/knowledgebase-deploy
sudo visudo -cf /etc/sudoers.d/knowledgebase-deploy
```

安装后的权限边界应为：

```text
/etc/systemd/system/knowledgebase.service       root:root 0644
/etc/sudoers.d/knowledgebase-deploy             root:root 0440
/usr/local/sbin                                 root:root 0755（无 KnowledgeBase 包装脚本）
```

`deploy.sh` 只执行 `systemctl stop|start|restart knowledgebase.service`，并在启动前检查生产 unit 的属主和可写性。它不会安装 unit、执行 `daemon-reload`、`enable`，也不会执行应用目录中的任何文件作为 root。

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

- 应用版本：在 Jenkins 中选择历史构建的提交并重新构建；或恢复上一版本的 `server/dist`、`web/dist` 后执行 `sudo systemctl restart knowledgebase.service`。
- 权限配置：本次加固前的 root 备份位于 `/var/backups/security-remediation-*`。恢复 `/etc/systemd/system/knowledgebase.service`、`/etc/sudoers.d/knowledgebase-deploy` 后，执行 `sudo visudo -cf /etc/sudoers.d/knowledgebase-deploy` 和 `sudo systemctl daemon-reload`。
- 注意：旧 sudo 规则包含“jenkins 可安装应用可写 unit”的提权路径。回滚权限配置会重新引入该风险，只应在明确需要时短时使用，并尽快重新加固。

备份只包含 SQLite 一致性快照、`.env` 和 `secret.key`；附件缓存可从原始来源重新同步，不纳入停服前备份。部署脚本不自动回滚；数据库结构变更均为向后兼容的新增表或列。
