up:
	docker compose --env-file ../.env up -d --build

down:
	docker compose --env-file ../.env down

rebuild:
	docker compose --env-file ../.env up -d --build --force-recreate

logs:
	docker compose --env-file ../.env logs -f

shell:
	docker compose --env-file ../.env exec cqueue sh

.PHONY: up down rebuild logs shell
