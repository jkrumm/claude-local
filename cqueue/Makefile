up:
	docker compose up -d --build

down:
	docker compose down

rebuild:
	docker compose up -d --build --force-recreate

logs:
	docker compose logs -f

shell:
	docker compose exec cqueue sh

.PHONY: up down rebuild logs shell
