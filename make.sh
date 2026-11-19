#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

ENV_FILE=".env"
TEMPLATE="index.template.js"
GENERATED="index.generated.js"
OUTPUT="index.js"
IMAGE_NAME_FILE=".image.name"

log() { printf '[make] %s\n' "$*"; }
die() { printf '[make] ERROR: %s\n' "$*" >&2; exit 1; }

[[ -f "$TEMPLATE" ]] || die "找不到 $TEMPLATE"
[[ -f "$ENV_FILE" ]] || die "找不到 $ENV_FILE，请先配置 Cloudflare Tunnel 变量"

# 从 .env 读取变量（忽略注释、空行、export 前缀），不把密钥回显到终端
get_env() {
  local key="$1"
  awk -F= -v k="$key" '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    { line=$0; sub(/^[[:space:]]*export[[:space:]]+/, "", line); sub(/^[[:space:]]+/, "", line) }
    index(line, k "=") == 1 {
      v=substr(line, length(k)+2)
      gsub(/^["'\'']|["'\'']$/, "", v)
      print v; exit
    }
  ' "$ENV_FILE"
}

ARGO_DOMAIN="$(get_env ARGO_DOMAIN || true)"
ARGO_AUTH="$(get_env ARGO_AUTH || true)"

[[ -n "${ARGO_DOMAIN:-}" ]] || die ".env 中 ARGO_DOMAIN 不能为空"
[[ -n "${ARGO_AUTH:-}" ]] || die ".env 中 ARGO_AUTH 不能为空"

# 域名做镜像名清洗：小写、只保留 [a-z0-9._-]，GHCR 需要全小写
IMAGE_NAME="$(printf '%s' "$ARGO_DOMAIN" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9._-')"
[[ -n "$IMAGE_NAME" ]] || die "ARGO_DOMAIN 无法转换为合法镜像名"

# Node 生成注入后的临时文件和混淆后的 index.js
node scripts/inject-env.js "$TEMPLATE" "$GENERATED" "$ARGO_DOMAIN" "$ARGO_AUTH"

node scripts/obfuscate.js "$GENERATED" "$OUTPUT"
rm -f "$GENERATED"
printf '%s\n' "$IMAGE_NAME" > "$IMAGE_NAME_FILE"

# 语法检查，确保混淆产物可运行
node --check "$OUTPUT" || die "生成的 index.js 语法检查失败"

# 确认敏感文件不会入库
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git ls-files --error-unmatch .env >/dev/null 2>&1; then
    die ".env 已被 git 跟踪，请执行: git rm --cached .env"
  fi
fi

# 自动提交并推送；只有有变化时才提交
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git add .gitignore make.sh scripts/obfuscate.js index.js index.html Dockerfile package.json .github/workflows "$IMAGE_NAME_FILE" 2>/dev/null || true
  if ! git diff --cached --quiet; then
    git commit -m "build: generate index.js for ${IMAGE_NAME}"
    git push origin HEAD || die "推送失败，请检查 GitHub 权限/网络"
  else
    log "没有需要提交的变更"
  fi
fi

log "镜像名: ${IMAGE_NAME}"
log "完成。GitHub Actions 将构建并推送 ghcr.io/<owner>/${IMAGE_NAME}:latest"
