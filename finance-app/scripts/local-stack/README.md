# Локальный стенд (без production)

Одноразовый Postgres + заглушка Supabase + все миграции. Нужен для SQL-тестов и прохода
«Запросить доступ у клиента» в браузере.

```bash
# 1. Postgres (любой кластер на 54329), затем:
bash scripts/local-stack/db_reset.sh            # заглушка + миграции (ошибки 0019/0094–0099 ожидаемы: данные прода)
bash scripts/local-stack/vault_intake_test.sh   # SQL-тесты 0101
# 2. Проход в браузере:
node scripts/local-stack/rpc-gateway.mjs        # публичные RPC → psql (роль anon)
# .env.local стенда: NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321, любой ANON_KEY, локальный VAULT_KEY
npx next dev -p 3100
node scripts/local-stack/intake-demo.mjs setup amocrm   # ключ команды + запрос, печатает ссылку
node scripts/local-stack/intake-demo.mjs status
node scripts/local-stack/intake-demo.mjs accept         # владелец расшифровывает и принимает
```
