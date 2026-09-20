#!/usr/bin/env bash
# Проверка готовности интеграции с AmoCRM.
#
# Запуск:
#   BASE=https://basa.example.com ADMIN_EMAIL=admin@... ADMIN_PASS=... ./scripts/amo-check.sh
#
# Что проверяем:
#   1) Сервис отвечает на /healthz.
#   2) Логин под админом проходит.
#   3) /amo/oauth/status — env заполнен и интеграция подключена.
#   4) /amo/oauth/ping — реально достаём пользователей из AmoCRM.
#   5) Есть хотя бы один аналитик с amo_user_id и есть amo_status_map.

set -euo pipefail

BASE="${BASE:?BASE is required, e.g. https://basa.example.com}"
ADMIN_EMAIL="${ADMIN_EMAIL:?ADMIN_EMAIL is required}"
ADMIN_PASS="${ADMIN_PASS:?ADMIN_PASS is required}"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n  %s\n' "$1" "${2:-}"; exit 1; }
step() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

step "1/5 Health"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/healthz" || true)
[ "$code" = "200" ] || fail "/healthz не отвечает 200 (получено $code)"
ok "/healthz OK"

step "2/5 Логин"
TOK=$(curl -fsS -X POST "$BASE/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])") \
    || fail "не смогли войти под $ADMIN_EMAIL"
ok "получен access_token"

H="-H Authorization: Bearer $TOK"

step "3/5 Статус OAuth-интеграции"
STATUS=$(curl -fsS "$BASE/api/v1/amo/oauth/status" $H)
echo "$STATUS" | python3 -m json.tool
CONFIGURED=$(echo "$STATUS" | python3 -c "import json,sys; print(json.load(sys.stdin)['configured'])")
CONNECTED=$(echo "$STATUS" | python3 -c "import json,sys; print(json.load(sys.stdin)['connected'])")
[ "$CONFIGURED" = "True" ] || fail "env не настроен — заполните AMO_* в .env и перезапустите контейнер"
ok "env настроен"
if [ "$CONNECTED" = "True" ]; then
    ok "интеграция подключена"
else
    warn "интеграция ещё не подключена — пройдите OAuth (см. AMOCRM_SETUP.md шаг 4)"
    exit 0
fi

step "4/5 Тестовый запрос к AmoCRM"
PING=$(curl -fsS -X POST "$BASE/api/v1/amo/oauth/ping" $H || true)
[ -n "$PING" ] || fail "/amo/oauth/ping не ответил"
echo "  $PING"
echo "$PING" | grep -q '"status":\s*"ok"' || fail "AmoCRM API недоступен" "$PING"
ok "AmoCRM API отвечает"

step "5/5 Маппинги"
ANALYSTS=$(curl -fsS "$BASE/api/v1/analysts" $H)
MAPPED=$(echo "$ANALYSTS" | python3 -c "
import json,sys; data=json.load(sys.stdin)
print(sum(1 for a in data if a.get('amo_user_id')))")
echo "  аналитиков с amo_user_id: $MAPPED"
if [ "$MAPPED" = "0" ]; then
    warn "ни у одного аналитика не задан amo_user_id — автосоздание проектов работать не будет"
fi

MAP=$(curl -fsS "$BASE/api/v1/settings/amo_status_map" $H)
MAP_KEYS=$(echo "$MAP" | python3 -c "
import json,sys; data=json.load(sys.stdin)
val=data.get('value') or {}
print(len(val) if isinstance(val, dict) else 0)")
echo "  этапов в amo_status_map: $MAP_KEYS"
if [ "$MAP_KEYS" = "0" ]; then
    warn "amo_status_map пуст — без него действия по статусам не сработают"
fi

echo
printf '\033[32m=== готовность подтверждена ===\033[0m\n'
