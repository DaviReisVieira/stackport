backend-install:
	pip install -e . && cd ui && npm install

frontend-install:
	cd ui && npm install

frontend-run:
	cd ui && npm run dev

frontend-build:
	cd ui && npm run build

start-emulator:
	pip install ministack && ministack

run-stackport:
	AWS_ENDPOINT_URL=http://localhost:4566 python -m backend.main