backend-install:
	pip install -e . && cd ui && npm install

frontend-install:
	cd ui && npm install

frontend-run:
	cd ui && npm run dev

frontend-build:
	cd ui && npm run build