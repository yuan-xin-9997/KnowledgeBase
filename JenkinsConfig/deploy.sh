#!/usr/bin/env bash
# 知屿 KnowledgeBase 部署脚本（系统 Node + systemd，无需 Docker）
# 用法（在 Jenkins 工作区，即仓库根目录执行）：
#   bash JenkinsConfig/deploy.sh prepare|stop|update|start
#
#   prepare  安装依赖、类型检查、测试、构建（失败时不会停止现有服务）
#   stop     停止现有服务
#   update   把工作区代码同步到 /opt/KnowledgeBase（保留 .data/.env）
#   start    安装/刷新 systemd 单元、启动服务并做健康检查
#
# 约定：部署根目录 /opt/KnowledgeBase（属主 jenkins:jenkins）
#       服务 knowledgebase.service，监听 0.0.0.0:36080
set -euo pipefail

deploy_root=/opt/KnowledgeBase
service=knowledgebase.service
health_script=JenkinsConfig/health.mjs
source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

log() { printf '[deploy] %s\n' "$*"; }

hint() {
  printf '\n[deploy] 排查提示：\n' >&2
  printf '  * 服务状态：sudo systemctl status %s --no-pager\n' "$service" >&2
  printf '  * 最近日志：sudo journalctl -u %s -n 200 --no-pager\n' "$service" >&2
  printf '  * 部署目录：%s，数据目录：%s/.data，环境变量：%s/.env\n' "$deploy_root" "$deploy_root" "$deploy_root" >&2
  printf '  * 当前提交：%s/DEPLOYED_COMMIT\n' "$deploy_root" >&2
}
on_error() { printf '\n[deploy] 执行失败（命令退出码 %s）。\n' "$1" >&2; hint; }
trap 'on_error $?' ERR

die() { printf '[deploy] 错误：%s\n' "$*" >&2; exit 1; }

require_node() {
  command -v node >/dev/null 2>&1 || die "服务器未安装 Node.js（需要 >= 22）"
  local version
  version="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "$version" -ge 22 ]] || die "Node.js 版本过低：$(node -v)，需要 >= 22"
}

write_env_if_missing() {
  if [[ ! -f "$deploy_root/.env" ]]; then
    log "未发现 $deploy_root/.env，生成默认配置（0.0.0.0:36080，随机 APP_SECRET）"
    local secret
    secret="$(openssl rand -hex 48)"
    (
      umask 077
      cat > "$deploy_root/.env" <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=36080
DATA_DIR=$deploy_root/.data
APP_SECRET=$secret
SYNC_SCHEDULER=true
TZ=Asia/Shanghai
EOF
    )
    chmod 600 "$deploy_root/.env"
  fi
}

backup_live_data() {
  [[ -f "$deploy_root/.data/knowledge.db" ]] || return 0
  local backup_root="$deploy_root/.backups"
  local stamp stage backup_file
  stamp="$(date +%Y%m%d-%H%M%S)"
  stage="$backup_root/.stage-$stamp"
  backup_file="$backup_root/knowledgebase-$stamp.tar.gz"
  install -d -m 700 "$backup_root" "$stage"
  log "在线备份 SQLite 与受保护配置到 $backup_file（服务保持运行）"
  SNAPSHOT_PATH="$stage/knowledge.db" DATABASE_PATH="$deploy_root/.data/knowledge.db" \
    node --input-type=module -e \
    'import Database from "better-sqlite3"; const db = new Database(process.env.DATABASE_PATH); await db.backup(process.env.SNAPSHOT_PATH); db.close();'
  [[ ! -f "$deploy_root/.data/secret.key" ]] || install -m 600 "$deploy_root/.data/secret.key" "$stage/secret.key"
  [[ ! -f "$deploy_root/.env" ]] || install -m 600 "$deploy_root/.env" "$stage/.env"
  tar -C "$stage" -czf "$backup_file" .
  chmod 600 "$backup_file"
  rm -rf -- "$stage"
  find "$backup_root" -maxdepth 1 -type f -name 'knowledgebase-*.tar.gz' -printf '%T@ %p\n' \
    | sort -nr | tail -n +11 | cut -d' ' -f2- | xargs -r rm -f --
}

case "${1:-}" in
  prepare)
    log "阶段 1/4：构建与测试（不会停止当前服务）"
    require_node
    cd "$source_root"
    node -v
    npm -v
    [[ -f package-lock.json ]] || die "仓库根缺少 package-lock.json，无法 npm ci"
    log "npm ci"
    npm ci --no-audit --no-fund
    log "npm run typecheck"
    npm run typecheck
    log "npm test"
    npm test
    log "npm run build"
    npm run build
    [[ -f server/dist/index.js ]] || die "服务端构建产物缺失：server/dist/index.js"
    [[ -f web/dist/index.html ]] || die "前端构建产物缺失：web/dist/index.html"
    backup_live_data
    log "阶段 1/4 完成：构建与测试通过，尚未停止服务"
    ;;

  stop)
    log "阶段 2/4：停止 $service"
    if systemctl is-active --quiet "$service"; then
      sudo -n systemctl stop "$service"
      log "已停止 $service"
    else
      log "$service 未运行，跳过"
    fi
    ;;

  update)
    log "阶段 3/4：同步工作区到 $deploy_root"
    mkdir -p "$deploy_root"
    [[ "$source_root" != "$deploy_root" ]] || die "工作区与部署目录相同，拒绝同步"
    actual_git_url="$(git -C "$source_root" remote get-url origin)"
    [[ "$actual_git_url" = "git@github.com:yuan-xin-9997/KnowledgeBase.git" ]] \
      || die "origin 不是预期仓库：$actual_git_url"

    [[ -w "$deploy_root" ]] || die "部署目录不可写：$deploy_root（请先 sudo chown -R jenkins:jenkins $deploy_root）"

    rsync -a --delete \
      --exclude='.git/' \
      --exclude='.data/' \
      --exclude='.backups/' \
      --exclude='data/' \
      --exclude='.env' \
      --exclude='.env.*' \
      --exclude='.deps-lock-hash' \
      --exclude='node_modules/' \
      --exclude='coverage/' \
      --exclude='test-results/' \
      --exclude='artifacts/' \
      --exclude='playwright-report/' \
      "$source_root/" "$deploy_root/"

    git -C "$source_root" rev-parse HEAD > "$deploy_root/DEPLOYED_COMMIT"
    log "已写入 DEPLOYED_COMMIT：$(< "$deploy_root/DEPLOYED_COMMIT")"
    ;;

  start)
    log "阶段 4/4：启动 $service 并做健康检查"
    cd "$deploy_root"
    require_node
    install -d -m 700 "$deploy_root/.data"
    write_env_if_missing

    lock_hash="$(sha256sum package-lock.json | awk '{print $1}')"
    marker="$deploy_root/.deps-lock-hash"
    if [[ ! -d node_modules ]] || [[ ! -f "$marker" ]] || [[ "$(cat "$marker")" != "$lock_hash" ]]; then
      log "安装生产依赖（npm ci --omit=dev）"
      npm ci --omit=dev --no-audit --no-fund
      printf '%s\n' "$lock_hash" > "$marker"
    else
      log "生产依赖未变化，跳过 npm ci"
    fi

    if ! cmp -s "$deploy_root/JenkinsConfig/knowledgebase.service" "/etc/systemd/system/$service"; then
      log "安装 systemd 单元 $service"
      sudo -n install -m 0644 "$deploy_root/JenkinsConfig/knowledgebase.service" "/etc/systemd/system/$service"
      sudo -n systemctl daemon-reload
    fi
    sudo -n systemctl enable "$service" >/dev/null
    sudo -n systemctl restart "$service"

    log "等待健康检查…"
    node "$deploy_root/$health_script"
    log "阶段 4/4 完成：$service 已启动，http://0.0.0.0:36080"
    ;;

  *)
    die "未知阶段：${1:-}（可用：prepare|stop|update|start）"
    ;;
esac
