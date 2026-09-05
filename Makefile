HOST ?= 0.0.0.0
PORT ?= 4173

.PHONY: serve serve-local check test smoke

serve:
	RACK_MESH_HOST=$(HOST) RACK_MESH_PORT=$(PORT) npm start

serve-local:
	$(MAKE) serve HOST=127.0.0.1

check:
	npm run check

test:
	npm test

smoke:
	npm run smoke
