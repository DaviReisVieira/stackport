# CLAUDE.md

## Project Overview

StackPort is a universal AWS resource browser for local emulators (MiniStack, LocalStack, Moto, or any AWS-compatible endpoint). Python FastAPI backend with boto3, React frontend served as static files. Single Docker image.

## Commands

```bash
# Backend
pip install -e .
AWS_ENDPOINT_URL=http://localhost:4566 stackport        # or: python -m backend.main

# Frontend dev
cd ui && npm install && npm run dev                      # dev server with proxy to :8080
cd ui && npm run build                                   # production build → ui/dist/

# Typecheck & lint
cd ui && npx tsc -b
cd ui && npx eslint .

# Docker
docker compose up                                        # StackPort + MiniStack
```

Requires a running AWS-compatible emulator (MiniStack on :4566 by default).

## Architecture

**Backend** (`backend/`):
- `main.py` — FastAPI app, CORS, static file mount for SPA, CLI entry point
- `config.py` — All settings from env vars (`AWS_ENDPOINT_URL`, `AWS_REGION`, `STACKPORT_PORT`, `STACKPORT_SERVICES`)
- `aws_client.py` — `get_client(service)` with `@lru_cache(maxsize=64)`
- `cache.py` — Thread-safe `TTLCache` singleton (dict + timestamps + threading.Lock)
- `routes/stats.py` — `GET /api/stats` — probes 35 services concurrently via ThreadPoolExecutor, cached 5s
- `routes/resources.py` — `GET /api/resources/{svc}` and `GET /api/resources/{svc}/{type}/{id}` — generic list/detail
- `routes/s3.py` — `GET /api/s3/buckets`, `/api/s3/buckets/{name}/objects`, `/api/s3/buckets/{name}/objects/{key}` — S3-specific with download support

**Key registries in backend:**
- `SERVICE_REGISTRY` (stats.py) — maps service name → list of `(resource_type, boto3_service, method, response_key)` tuples. 35 services.
- `DESCRIBE_REGISTRY` (resources.py) — maps `(service, resource_type)` → boto3 describe call for detail views. 19 entries.
- `_METHOD_KWARGS` (stats.py) — extra params for APIs that require them (cognito `MaxResults`, wafv2 `Scope`).

**Frontend** (`ui/src/`):
- React 18 + Vite 5 + TypeScript + Tailwind CSS 3 + shadcn/ui (Radix-based)
- `main.tsx` — BrowserRouter basename `/`, TooltipProvider, Sonner Toaster
- `App.tsx` — Routes: `/` (Dashboard), `/resources/:service?` (ResourceBrowser), `*` → redirect
- `components/Layout.tsx` — Sidebar nav (Dashboard, Resources)
- `pages/Dashboard.tsx` — Service grid with status badges, resource counts, links to browser
- `pages/ResourceBrowser.tsx` — Service sidebar + resource table + detail Sheet. Renders `SERVICE_VIEWS[service]` when available, falls back to generic table.
- `components/service-views/index.ts` — Registry: `{ s3: S3Browser }`. Add new service UIs here.
- `components/service-views/S3Browser.tsx` — Full S3 file browser: bucket list, folder navigation, object detail, search, pagination, download.
- `lib/api.ts` — `API_BASE = '/api'`, fetch functions for all endpoints
- `lib/types.ts` — `ServiceStats`, `StatsResponse`
- `lib/service-icons.ts` — 35+ service → lucide icon mappings, fallback to `Server`
- `hooks/useFetch.ts` — Generic polling hook with toast on error

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `AWS_ENDPOINT_URL` | `http://localhost:4566` | AWS-compatible endpoint |
| `AWS_REGION` | `us-east-1` | Region for boto3 clients |
| `AWS_ACCESS_KEY_ID` | `test` | Credentials |
| `AWS_SECRET_ACCESS_KEY` | `test` | Credentials |
| `STACKPORT_PORT` | `8080` | HTTP port |
| `STACKPORT_SERVICES` | *(35 services)* | Comma-separated list to probe |
| `LOG_LEVEL` | `INFO` | Python log level (DEBUG shows healthcheck logs) |

## Adding a New Service to the Backend

1. Add entries to `SERVICE_REGISTRY` in `backend/routes/stats.py` — `(resource_type, boto3_service, method, response_key)`
2. If the list API needs extra kwargs, add to `_METHOD_KWARGS` in `stats.py`
3. Add detail lookup to `DESCRIBE_REGISTRY` in `backend/routes/resources.py`
4. Add ID field names to `_ID_FIELDS` in `resources.py`
5. Add the service to `STACKPORT_SERVICES` default in `backend/config.py`

## Adding a Service-Specific UI View

For services that need richer UX than the generic resource table (like S3's file browser):

1. Add backend endpoints in a new `backend/routes/{service}.py`, register in `main.py`
2. Add fetch functions in `ui/src/lib/api.ts`
3. Create `ui/src/components/service-views/{Service}Browser.tsx`
4. Register in `SERVICE_VIEWS` in `ui/src/components/service-views/index.ts`

ResourceBrowser renders `SERVICE_VIEWS[service]` when available, falls back to generic table.

## UI Conventions

- shadcn components are in `src/components/ui/` — **Radix-based** (not Base UI). Do NOT use `npx shadcn@latest` as it installs v4/Base UI incompatible with Tailwind v3. Copy classic Radix-based component code instead.
- Dark theme only — CSS variables under `.dark` class in `index.css`, HSL format.
- Toast notifications via `sonner` — `import { toast } from 'sonner'`.
- `<TooltipProvider>` wraps the app in `main.tsx`.
- Service icons: `import { getServiceIcon } from '@/lib/service-icons'` returns a `LucideIcon`.
- `@/*` path alias maps to `./src/*`.
- `cn()` helper from `@/lib/utils` for conditional class merging (clsx + tailwind-merge).

## Code Conventions

- Backend: sync route handlers (FastAPI auto-threadpools them, avoids async+boto3 issues)
- Backend: registry pattern for service discovery — add entries, not code
- Backend: graceful degradation — probe failures return `resources: {}`, not 500s
- Frontend: TypeScript strict mode, no `any`
- Frontend: `useFetch` hook with polling for all data fetching
- `ui/dist/` is committed — rebuild with `cd ui && npm run build` after frontend changes
- Dockerfile is two-stage (node builds UI, python runs backend)

## Supported Services (35)

acm, apigateway, appsync, athena, cloudformation, cloudfront, cognito-idp, cognito-identity, dynamodb, ec2, ecr, ecs, elasticache, elasticfilesystem, elasticloadbalancing, elasticmapreduce, events, firehose, glue, iam, kinesis, kms, lambda, logs, monitoring, rds, route53, s3, secretsmanager, ses, sns, sqs, ssm, stepfunctions, wafv2
