HOST ?= 0.0.0.0
PORT ?= 4173

.PHONY: serve serve-local dev icons icons-vendor check test smoke

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
