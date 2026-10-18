#!/usr/bin/env bash
# Прогон Фазы 2 против поднятого `docker compose up`.
#
# Запуск:
#   docker compose up -d --build
#   ./scripts/run-phase2.sh
#
# Скрипт:
#   1) логинится под admin (INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD из .env);
#   2) создаёт аналитика с amo_user_id=42;
#   3) кладёт маппинг этапов в settings;
#   4) шлёт серию вебхуков AmoCRM как «реальный» CRM:
#      - добавление сделки → стартует проект;
#      - дубликат → должен пропуститься;
#      - «работа сдана» → проект done, выплата accrued;
#      - повтор «работа сдана» → выплата не дублируется;
#      - «оплачено клиентом» → выплата ready;
#   5) аутентифицирует бухгалтера, помечает выплату paid;
#   6) шлёт «откатный» вебхук — должен заблокироваться;
#   7) проверяет журнал и IP-whitelist.
#
# Все шаги выводят статус ОК/FAIL и ключевые данные. На любой неожиданный ответ — exit 1.

set -euo pipefail

BASE="${BASE:-http://localhost:8000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASS="${ADMIN_PASS:-change-me}"

# ---------- хелперы ----------

ok()    { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail()  { printf '  \033[31m✗\033[0m %s\n  %s\n' "$1" "${2:-}"; exit 1; }
step()  { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

# Опасно полагаться на jq быть установленным — fallback на python
json() {
    if command -v jq >/dev/null 2>&1; then
        jq -r "$1"
    else
        python3 -c "import json,sys; data=json.load(sys.stdin); path='$1'.lstrip('.');
def get(d, p):
    if not p: return d
    parts=p.split('.')
    for x in parts:
        if x.endswith(']'):
            name, idx = x[:-1].split('[')
            d = d[name][int(idx)] if name else d[int(idx)]
        else:
            d = d.get(x) if isinstance(d, dict) else None
    return d
print(get(data, path))"
    fi
}

post() { curl -fsS -X POST "$BASE$1" -H 'Content-Type: application/json' "$@" 2>&1 || true; }
get_()  { curl -fsS "$BASE$1" "$@" 2>&1 || true; }

# ---------- 1. логин ----------

step "Логин админом ($ADMIN_EMAIL)"
LOGIN_RESP=$(curl -fsS -X POST "$BASE/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}") \
    || fail "login failed" "$LOGIN_RESP"
ADMIN_TOKEN=$(echo "$LOGIN_RESP" | json '.access_token')
[ -n "$ADMIN_TOKEN" ] && [ "$ADMIN_TOKEN" != "None" ] || fail "empty access_token" "$LOGIN_RESP"
ok "admin token: ${ADMIN_TOKEN:0:20}..."

H="-H Authorization: Bearer $ADMIN_TOKEN"
HJ="$H -H Content-Type: application/json"

# ---------- 2. аналитик ----------

step "Создаём аналитика с amo_user_id=42"
A_RESP=$(curl -fsS -X POST "$BASE/api/v1/analysts" $HJ \
    -d '{"full_name":"Иван Петров","email":"ivan.petrov@example.com","amo_user_id":42,"default_rate":20000}') \
    || A_RESP=$(curl -fsS "$BASE/api/v1/analysts" $H | python3 -c "
import json,sys
data=json.load(sys.stdin)
for a in data:
    if a.get('amo_user_id')==42:
        print(json.dumps(a)); break")
ANALYST_ID=$(echo "$A_RESP" | json '.id')
[ -n "$ANALYST_ID" ] && [ "$ANALYST_ID" != "None" ] || fail "no analyst id" "$A_RESP"
ok "analyst_id=$ANALYST_ID"

# ---------- 3. маппинг ----------

step "Маппинг статусов: 111→start_project, 222→mark_done, 333→mark_ready_for_payout, 444→cancel"
M_RESP=$(curl -fsS -X PUT "$BASE/api/v1/settings/amo_status_map" $HJ \
    -d '{"111":"start_project","222":"mark_done","333":"mark_ready_for_payout","444":"cancel"}')
ok "settings.amo_status_map: $(echo "$M_RESP" | json '.value' | head -c 100)..."

# ---------- 4. вебхуки ----------

DEAL_ID=$((RANDOM * RANDOM))
echo "  (используем deal_id=$DEAL_ID)"

step "Webhook → стартуем проект"
R=$(curl -fsS -X POST "$BASE/api/v1/amo/webhooks" -H 'Content-Type: application/json' \
    -d "{\"leads\":{\"add\":[{\"id\":\"$DEAL_ID\",\"status_id\":\"111\",\"responsible_user_id\":\"42\",\"name\":\"Договор подписан\",\"price\":\"150000\",\"updated_at\":\"$(date +%s)\"}]}}")
STATUS=$(echo "$R" | json '.status')
[ "$STATUS" = "queued" ] || fail "expected queued, got $STATUS" "$R"
ok "queued, log_id=$(echo "$R" | json '.log_id')"

# обработка асинхронная — даём воркеру миг
sleep 0.5

P_RESP=$(curl -fsS "$BASE/api/v1/projects?status=in_progress" $H)
PROJECT_ID=$(echo "$P_RESP" | python3 -c "
import json,sys
data=json.load(sys.stdin)
for p in data:
    if p.get('amo_deal_id')==$DEAL_ID:
        print(p['id']); break")
[ -n "$PROJECT_ID" ] || fail "project not created within 0.5s — увеличьте sleep или проверьте воркер" "$P_RESP"
ok "project_id=$PROJECT_ID (in_progress)"

step "Webhook → тот же payload (идемпотентность)"
R=$(curl -fsS -X POST "$BASE/api/v1/amo/webhooks" -H 'Content-Type: application/json' \
    -d "{\"leads\":{\"add\":[{\"id\":\"$DEAL_ID\",\"status_id\":\"111\",\"responsible_user_id\":\"42\",\"name\":\"Договор подписан\",\"price\":\"150000\",\"updated_at\":\"$(date +%s -d '1 second ago')\"}]}}")
# updated_at тот же → ключ идемпотентности совпадает. Подменим — берём оригинал.
# фактически для идемпотентности нужен ровно тот же payload — пересылаем
R=$(curl -fsS -X POST "$BASE/api/v1/amo/webhooks" -H 'Content-Type: application/json' \
    -d "{\"leads\":{\"add\":[{\"id\":\"$DEAL_ID\",\"status_id\":\"111\",\"responsible_user_id\":\"42\",\"name\":\"Договор подписан\",\"price\":\"150000\",\"updated_at\":\"frozen\"}]}}")
R2=$(curl -fsS -X POST "$BASE/api/v1/amo/webhooks" -H 'Content-Type: application/json' \
    -d "{\"leads\":{\"add\":[{\"id\":\"$DEAL_ID\",\"status_id\":\"111\",\"responsible_user_id\":\"42\",\"name\":\"Договор подписан\",\"price\":\"150000\",\"updated_at\":\"frozen\"}]}}")
STATUS=$(echo "$R2" | json '.status')
[ "$STATUS" = "duplicate" ] || fail "expected duplicate, got $STATUS" "$R2"
ok "duplicate (skipped)"

step "Webhook → работа сдана (mark_done)"
R=$(curl -fsS -X POST "$BASE/api/v1/amo/webhooks" -H 'Content-Type: application/json' \
    -d "{\"leads\":{\"update\":[{\"id\":\"$DEAL_ID\",\"status_id\":\"222\",\"responsible_user_id\":\"42\",\"updated_at\":\"$(date +%s)\"}]}}")
ok "queued, log_id=$(echo "$R" | json '.log_id')"
sleep 0.5

PAY_RESP=$(curl -fsS "$BASE/api/v1/payments?analyst_id=$ANALYST_ID" $H)
PAYMENT_ID=$(echo "$PAY_RESP" | python3 -c "
import json,sys
data=json.load(sys.stdin)
for p in data:
    if p.get('status')=='accrued':
        print(p['id']); break")
[ -n "$PAYMENT_ID" ] || fail "accrued payment not created" "$PAY_RESP"
ok "payment_id=$PAYMENT_ID (accrued)"

step "Webhook → ещё раз mark_done (НЕ должен задвоить выплату)"
curl -fsS -X POST "$BASE/api/v1/amo/webhooks" -H 'Content-Type: application/json' \
    -d "{\"leads\":{\"update\":[{\"id\":\"$DEAL_ID\",\"status_id\":\"222\",\"responsible_user_id\":\"42\",\"updated_at\":\"$(date +%s)x\"}]}}" >/dev/null
sleep 0.5

PAY_COUNT=$(curl -fsS "$BASE/api/v1/payments?analyst_id=$ANALYST_ID" $H | python3 -c "
import json,sys; data=json.load(sys.stdin)
print(sum(1 for p in data if p['status']!='cancelled'))")
[ "$PAY_COUNT" = "1" ] || fail "ожидалась 1 активная выплата, найдено $PAY_COUNT"
ok "выплат: $PAY_COUNT (без дубля)"

step "Webhook → оплачено клиентом (mark_ready_for_payout)"
curl -fsS -X POST "$BASE/api/v1/amo/webhooks" -H 'Content-Type: application/json' \
    -d "{\"leads\":{\"update\":[{\"id\":\"$DEAL_ID\",\"status_id\":\"333\",\"updated_at\":\"$(date +%s)\"}]}}" >/dev/null
sleep 0.5

PAY_STATUS=$(curl -fsS "$BASE/api/v1/payments/?analyst_id=$ANALYST_ID&status=ready" $H | python3 -c "
import json,sys; data=json.load(sys.stdin)
for p in data:
    if p['id']=='$PAYMENT_ID': print(p['status']); break")
[ "$PAY_STATUS" = "ready" ] || fail "ожидался ready, получено $PAY_STATUS"
ok "выплата → ready"

# ---------- 5. бухгалтер платит ----------

step "Создаём бухгалтера и платим"
# admin создаёт пользователя — на текущем API нет UserCreate-эндпоинта, поэтому пропускаем,
# если у бухгалтера уже есть учётка (например, заведена руками).
ACC_EMAIL="${ACC_EMAIL:-acc@example.com}"
ACC_PASS="${ACC_PASS:-change-me}"
ACC_LOGIN=$(curl -fsS -X POST "$BASE/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$ACC_EMAIL\",\"password\":\"$ACC_PASS\"}" || echo '{}')
ACC_TOKEN=$(echo "$ACC_LOGIN" | json '.access_token' || echo '')
if [ -z "$ACC_TOKEN" ] || [ "$ACC_TOKEN" = "None" ]; then
    echo "  ℹ нет бухгалтера ($ACC_EMAIL). Помечаем выплату от имени admin (роль admin тоже может)."
    ACC_TOKEN="$ADMIN_TOKEN"
fi

PR=$(curl -fsS -X POST "$BASE/api/v1/payments/$PAYMENT_ID/mark-paid" \
    -H "Authorization: Bearer $ACC_TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"comment":"перевод #12345"}')
PAID_STATUS=$(echo "$PR" | json '.status')
[ "$PAID_STATUS" = "paid" ] || fail "не удалось поставить paid" "$PR"
ok "выплата → paid"

# ---------- 6. откат ----------

step "Webhook → «откатный» mark_done (должен блокироваться)"
curl -fsS -X POST "$BASE/api/v1/amo/webhooks" -H 'Content-Type: application/json' \
    -d "{\"leads\":{\"update\":[{\"id\":\"$DEAL_ID\",\"status_id\":\"222\",\"updated_at\":\"$(date +%s)\"}]}}" >/dev/null
sleep 0.5

PAY_STATUS=$(curl -fsS "$BASE/api/v1/payments?analyst_id=$ANALYST_ID" $H | python3 -c "
import json,sys; data=json.load(sys.stdin)
for p in data:
    if p['id']=='$PAYMENT_ID': print(p['status']); break")
[ "$PAY_STATUS" = "paid" ] || fail "выплата сбилась в $PAY_STATUS"
ok "выплата осталась paid (rollback заблокирован)"

# ---------- 7. журнал ----------

step "Журнал вебхуков"
LOG_RESP=$(curl -fsS "$BASE/api/v1/webhook-log?processed=true&limit=20" $H)
LOG_COUNT=$(echo "$LOG_RESP" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
ok "обработанных записей: $LOG_COUNT"
echo "$LOG_RESP" | python3 -c "
import json,sys; data=json.load(sys.stdin)
for x in data[:8]:
    print(f\"    {x['received_at']:30s} {x['event_type']:20s} processed={x['processed']} error={x['error']}\")"

# ---------- 8. IP whitelist ----------

step "IP whitelist: блокируем чужой адрес"
curl -fsS -X PUT "$BASE/api/v1/settings/amo_webhook_allowed_ips" $HJ \
    -d '{"ips":["10.0.0.0/8"]}' >/dev/null
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/v1/amo/webhooks" \
    -H 'Content-Type: application/json' \
    -H 'X-Forwarded-For: 8.8.8.8' \
    -d '{"leads":{"add":[{"id":"7777","status_id":"111"}]}}')
[ "$CODE" = "403" ] || fail "ожидалось 403 для чужого IP, получено $CODE"
ok "403 для 8.8.8.8 (вне whitelist)"

# восстановим — снимаем whitelist обратно
curl -fsS -X PUT "$BASE/api/v1/settings/amo_webhook_allowed_ips" $HJ -d '{"ips":[]}' >/dev/null
ok "whitelist снят (для следующего прогона)"

echo
printf '\033[32m\n=== Все шаги Фазы 2 прошли ===\033[0m\n'
