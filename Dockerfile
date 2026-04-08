FROM node:20-alpine AS ui-build
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
EXPOSE 8080
CMD ["python", "-m", "backend.main"]
