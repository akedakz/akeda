# AKEDA: размещение на сервере в Казахстане

Подготовлены Dockerfile, compose.yaml и Caddyfile. DNS пока не изменён. Docker-сборка должна выполняться на Linux; Windows node_modules на сервер не копировать.

1. Выбрать VPS в Казахстане с Docker Compose, публичным IPv4, диском от 25 ГБ. Для сборки Next.js желательно 4 ГБ RAM либо сборка образа на отдельной машине. Тариф до оплаты согласовать с владельцем.
2. Разместить текущий код AKEDA. Создать .env.local на сервере с тремя ключами только проекта duqcanjmsvakmuzhyksa; ограничить доступ chmod 600 .env.local. SUPABASE_SECRET_KEY нужен только во время работы, не передаётся Docker build и исключён из build context.
3. Выполнить `docker compose --env-file .env.local build app` и `docker compose --env-file .env.local up -d app`.
4. Проверить приложение по SSH-туннелю к 127.0.0.1:3000 до смены DNS.
5. После проверки создать в DNS-зоне Hoster.kz A-запись @ → фактический IPv4 сервера и CNAME www → akeda.kz. Сохранить ns1/ns2/ns3.hoster.kz. Не удалять чужие MX/TXT. Если есть устаревшая AAAA-запись, проверить её назначение перед изменением.
6. Открыть TCP 80/443 и запустить `docker compose --env-file .env.local up -d`. Caddy выпустит TLS-сертификат после корректного DNS.
7. В Supabase Auth настроить Site URL https://akeda.kz и только нужные Redirect URLs; проверить вход, роли, материалы и полный тест на HTTPS. Не запускать historical migrations на установленной базе.

Изменение DNS не переносит базу Supabase из Frankfurt. Перед приёмом реальных данных учеников отдельно определить требования к размещению и обработке этих данных.

Команды и конфигурация подготовлены, но удалённый сервер ещё не куплен и Docker deployment на нём не проверен.
