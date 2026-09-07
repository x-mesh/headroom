HOST ?= 0.0.0.0
PORT ?= 4173

.PHONY: serve serve-local dev icons icons-vendor check test smoke image up down

serve:
	RACK_MESH_HOST=$(HOST) RACK_MESH_PORT=$(PORT) npm start

serve-local:
	$(MAKE) serve HOST=$(HOST)

dev:
	RACK_MESH_DEV=1 $(MAKE) serve-local

icons:
	npm run icons

# 네트워크를 쓰는 유일한 타겟. 업스트림 스텐실을 다시 가져올 때만 실행한다.
logos-vendor:
	npm run logos:vendor

icons-vendor:
	npm run icons:vendor

check:
	npm run check

test:
	npm test

smoke:
	npm run smoke

# 컨테이너. 운영은 compose.yml 만 읽어 이미지 안의 것을 내보내고, 개발은 compose.override.yml 이
# 겹쳐 읽히며 public/ 을 마운트한다. 마운트는 개발 도구이지 배포 방식이 아니다.
image:
	docker build -t rack-mesh:local .

up:
	docker compose -f compose.yml up --build -d

down:
	docker compose -f compose.yml down
