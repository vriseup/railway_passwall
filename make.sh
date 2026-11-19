#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

ENV_FILE=".env"
TEMPLATE="index.template.js"
GENERATED="index.generated.js"
OUTPUT="index.js"
SUB_FILE="sub.txt"

log() { printf '[make] %s\n' "$*"; }
die() { printf '[make] ERROR: %s\n' "$*" >&2; exit 1; }

[[ -f "$TEMPLATE" ]] || die "找不到 $TEMPLATE"
[[ -f "$ENV_FILE" ]] || die "找不到 $ENV_FILE，请先配置变量"

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
UUID="$(get_env UUID || true)"
CFIP="$(get_env CFIP || true)"

[[ -n "${ARGO_DOMAIN:-}" ]] || die ".env 中 ARGO_DOMAIN 不能为空"
[[ -n "${ARGO_AUTH:-}" ]] || die ".env 中 ARGO_AUTH 不能为空"
[[ -n "${UUID:-}" ]] || die ".env 中 UUID 不能为空"
[[ -n "${CFIP:-}" ]] || die ".env 中 CFIP 不能为空"

IMAGE_NAME="$(printf '%s' "$ARGO_DOMAIN" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9._-')"
[[ -n "$IMAGE_NAME" ]] || die "ARGO_DOMAIN 无法转换为合法镜像名"

VALUES_JSON="$(node -e '
const [d,a,u,c]=process.argv.slice(1);
process.stdout.write(JSON.stringify({ARGO_DOMAIN:d,ARGO_AUTH:a,UUID:u,CFIP:c}));
' "$ARGO_DOMAIN" "$ARGO_AUTH" "$UUID" "$CFIP")"

node scripts/inject-env.js "$TEMPLATE" "$GENERATED" "$VALUES_JSON"
node scripts/obfuscate.js "$GENERATED" "$OUTPUT"
rm -f "$GENERATED"

node scripts/generate-sub.js "$SUB_FILE" "$VALUES_JSON"

node --check "$OUTPUT" || die "生成的 index.js 语法检查失败"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git ls-files --error-unmatch .env >/dev/null 2>&1; then
    die ".env 已被 git 跟踪，请执行: git rm --cached .env"
  fi
  if git ls-files --error-unmatch "$SUB_FILE" >/dev/null 2>&1; then
    die "$SUB_FILE 已被 git 跟踪，请执行: git rm --cached $SUB_FILE"
  fi
fi

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git add -A -- .gitignore README.md make.sh scripts index.template.js index.js Dockerfile package.json package-lock.json .github/workflows 2>/dev/null || true
  if ! git diff --cached --quiet; then
    git commit -m "build: generate index.js for ${IMAGE_NAME} (no http server)"
    git push origin HEAD || die "推送失败，请检查 GitHub 权限/网络"
  else
    log "没有需要提交的变更"
  fi
fi

log "镜像名: ${IMAGE_NAME}"
log "订阅文件已生成: ${SUB_FILE}（不会提交 GitHub）"
log "完成。代码已提交；如需构建镜像，请手动运行 GitHub Actions: Build and Push Docker Image"
