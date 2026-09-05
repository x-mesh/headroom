HOST ?= 0.0.0.0
PORT ?= 4173

.PHONY: serve serve-local dev check test smoke

serve:
	RACK_MESH_HOST=$(HOST) RACK_MESH_PORT=$(PORT) npm start

serve-local:
	$(MAKE) serve HOST=$(HOST)

dev:
	RACK_MESH_DEV=1 $(MAKE) serve-local

check:
	npm run check

test:
	npm test

smoke:
	npm run smoke
