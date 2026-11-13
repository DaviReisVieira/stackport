# The UI is static files, the same on every architecture: build it once on the
# machine running the build. Building it per platform runs npm under QEMU for
# arm64, which is slow and can hang.
FROM --platform=$BUILDPLATFORM node:20-alpine AS ui-build
WORKDIR /app/ui
COPY ui/package*.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

FROM python:3.12-alpine
WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir --no-compile . \
    && find /usr/local/lib/python3.12 -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null; \
    find /usr/local/lib/python3.12 -type f -name '*.pyc' -delete 2>/dev/null; true
COPY backend/ ./backend/
COPY --from=ui-build /app/ui/dist ./ui/dist
# Inside a container StackPort has to listen on every interface for the port to
# be published; publish it on 127.0.0.1 (-p 127.0.0.1:8080:8080) to keep it local.
ENV STACKPORT_HOST=0.0.0.0
EXPOSE 8080
CMD ["python", "-m", "backend.main"]
