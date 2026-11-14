# CLAUDE.md

## Project Overview

StackPort is a universal AWS resource browser for local emulators (MiniStack, Floci, LocalStack, Moto, or any AWS-compatible endpoint). Python FastAPI backend with boto3, React frontend served as static files. Single Docker image.

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

Requires a running AWS-compatible emulator (:4566 for most; AWS Emulator serves HTTPS on :9297). No emulator is the default: the root compose file uses MiniStack, `examples/docker-compose.floci.yml` uses Floci, `examples/docker-compose.aws-emulator.yml` uses AWS Emulator, and the docs present them side by side rather than naming a default. The rule lives in `CONTRIBUTING.md#supported-emulators`; keep any emulator-related docs change consistent with it.

## Architecture

**Backend** (`backend/`):
- `main.py` — FastAPI app, CORS, static file mount for SPA, CLI entry point
- `config.py` — All settings from env vars (`AWS_ENDPOINT_URL`, `AWS_REGION`, `STACKPORT_PORT`, `STACKPORT_SERVICES`, `STACKPORT_ENDPOINTS`)
- `aws_client.py` — `get_client(service, **EndpointInfo.client_kwargs())`, clients cached per `(service, ConnectionPlan)`; local endpoints get `inject_host_prefix=False`, a `STACKPORT_PROBE_TIMEOUT` connect timeout and a single attempt
- `connection.py` — `EndpointInfo` → `plan_connection()` → hashable `ConnectionPlan`. Credential and TLS precedence live in its docstring; `ssl_context_for(plan)` for plain HTTP requests to an endpoint
- `aws_emulator.py` — `discover(url)` finds AWS Emulator's `ca.pem` + `emulator_credentials` in `<STACKPORT_AWS_EMULATOR_DIR>/<port>/` for `https://<loopback>:<port>`; their stat stamp is in the plan, so a restarted emulator's new keys are picked up
- `aws_errors.py` — `classify(exc)` → `ClassifiedError` (`not_implemented | credentials | forbidden | tls | unreachable | other`), walking the exception chain
- `error_handlers.py` — Installed in `main.py`: classified boto errors become 501/401/403/502 with `{"detail": str, "error": ClassifiedError}`. An endpoint's 4xx keeps its status and an endpoint 5xx is a 502, also when a route wrapped the `ClientError` in a generic 500 (or 502); a route's own 4xx or 501 is kept
- `origins.py` — Outermost middlewares: `HostGuard` (browser requests must use localhost, an IP, or `STACKPORT_ALLOWED_HOSTS`: DNS rebinding) and `CrossSiteGuard` (refuses cross-site requests to `/api` and `/ws` via Fetch Metadata and Origin, since CORS doesn't cover simple requests or WebSocket handshakes)
- `emulators.py` — `DETECTORS` registry identifying MiniStack, Floci, LocalStack, Moto and AWS Emulator by an unauthenticated GET each; `detect_emulator` (cached) for connection checks, `detect_emulator_quickly` (bounded wait) for `/api/health`
- `routes/common.py` — `get_endpoint_url` FastAPI dependency resolves `?endpoint=` query param → endpoint URL
- `cache.py` — Thread-safe `TTLCache` singleton (dict + timestamps + threading.Lock)
- `routes/stats.py` — `GET /api/stats` — probes 35 services concurrently via ThreadPoolExecutor, cached 5s
- `routes/resources.py` — `GET /api/resources/{svc}` and `GET /api/resources/{svc}/{type}/{id}` — generic list/detail
- `routes/s3.py` — `GET /api/s3/buckets`, `/api/s3/buckets/{name}/objects`, `/api/s3/buckets/{name}/objects/{key}` — S3-specific with download support

**Schemas** (`backend/schemas/`):
- Pydantic request/response models, one module per service: `sqs.py`, `s3.py`, `dynamodb.py`, `tags.py`
- Route files import schemas — they never define `BaseModel` subclasses inline
- When adding a new service with write endpoints, create `backend/schemas/<service>.py`
- Uses `Field(alias="camelCase")` + `populate_by_name: True` for camelCase JSON ↔ snake_case Python

**Key registries in backend:**
- `SERVICE_REGISTRY` (stats.py) — maps service name → list of `(resource_type, boto3_service, method, response_key)` tuples. 35 services.
- `DESCRIBE_REGISTRY` (resources.py) — maps `(service, resource_type)` → boto3 describe call for detail views.
- `_METHOD_KWARGS` (stats.py) — extra params for APIs that require them (cognito `MaxResults`, wafv2 `Scope`, iam `Scope=Local`).
- `_GROUPED_ITEMS` / `_PER_PARENT` (stats.py) — list calls whose resources sit inside groups (EC2 reservations) or that cover one parent per call (EventBridge rules per bus). `list_items()` applies them; the dashboard count, generic listing, CLI and Learn checks all go through it.
- `_DESCRIBE_KWARGS` / `_DESCRIBE_FROM_LISTING` (resources.py) — extra params for detail calls (SQS `AttributeNames`), and detail calls that need more of the resource than its id (a rule's event bus), found through the listing. `describe_resource()` serves both the detail route and `stackport describe`.
- `tests/test_generic_resources.py` creates one resource per detail lookup in moto and opens every listed id: a new `DESCRIBE_REGISTRY` entry needs a creator there.

**Frontend** (`ui/src/`):
- React 18 + Vite 5 + TypeScript + Cloudscape Design System (`@cloudscape-design/components`), Tailwind CSS 3 kept as a small utility layer
- `main.tsx` — BrowserRouter basename `/`, Sonner Toaster, EndpointProvider
- `App.tsx` — Lazy routes: `/` (Dashboard), `/resources/:service?` (ResourceBrowser), `/settings`, `/about`; old `/cloudscape/*` paths redirect
- `components/cloudscape/CloudscapeShell.tsx` — Shared AppLayout shell: TopNavigation (service search, pinned favorites, theme toggle, endpoint menu), SideNavigation, keyboard shortcuts (`g d/r/s/a`, `?`)
- `pages/CloudscapeDashboard.tsx` — Service Cards/Table grid, live stats over WebSocket, favorites-first sort
- `pages/CloudscapeResourceBrowser.tsx` — Service picker + per-type tabs with PropertyFilter tables, detail modal with tag editing, j/k/Enter navigation. Renders `CLOUDSCAPE_SERVICE_VIEWS[service]` when available, falls back to the generic table.
- `components/cloudscape/views/index.ts` — Registry of service-specific views (`s3`, `sqs`, `dynamodb`, `lambda`, `iam`, `rds`, `ec2`, `logs`, `secretsmanager`, `stepfunctions`). Add new service UIs here.
- `components/cloudscape/views/stepfunctions/` — Framework-agnostic ASL graph (dagre + SVG) and execution timeline shared by the Step Functions view
- `lib/api.ts` — `API_BASE = '/api'`, fetch functions for all endpoints
- `lib/types.ts` — `ServiceStats`, `StatsResponse`
- `lib/service-icons.ts` — 35+ service → lucide icon mappings, fallback to `Server`
- `hooks/useFetch.ts` — Generic polling hook with toast on error

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `AWS_ENDPOINT_URL` | *(unset: real AWS)* | AWS-compatible endpoint; overrides the saved `default` endpoint's URL for that run (empty = unset) |
| `AWS_REGION` | `us-east-1` | Region for boto3 clients |
| `AWS_ACCESS_KEY_ID` | *(unset: default chain)* | Credentials |
| `AWS_SECRET_ACCESS_KEY` | *(unset: default chain)* | Credentials |
| `AWS_SESSION_TOKEN` | *(unset)* | Session token for temporary credentials; only sent with the two keys above, never with endpoint or AWS Emulator keys. Read at start-up, so a new token needs a restart |
| `STACKPORT_PORT` | `8080` | HTTP port |
| `STACKPORT_HOST` | `127.0.0.1` | Interface to listen on; the Docker image sets `0.0.0.0` |
| `STACKPORT_S3_MAX_UPLOAD_MB` | `100` | Max S3 upload size per object (whole mebibytes; × 1024²) |
| `STACKPORT_SERVICES` | *(35 services)* | Comma-separated list to probe |
| `STACKPORT_PROBE_TIMEOUT` | `5` | Seconds to wait when connecting to a local emulator; calls to local emulators aren't retried |
| `STACKPORT_CACHE_TTL` | `5` | Seconds to cache service stats |
| `STACKPORT_PROBE_WORKERS` | `10` | ThreadPoolExecutor max workers for concurrent probing |
| `STACKPORT_LEARN` | `true` | Mount the Learn routes and show the tutorial UI |
| `STACKPORT_ALLOWED_HOSTS` | *(empty)* | Extra Host names browsers may use (localhost and IPs always work; `*` for any). Probes and scripts aren't checked |
| `STACKPORT_CORS_ORIGINS` | *(empty)* | Origins allowed to call the API from another site (comma-separated); also checked on WebSocket handshakes. Empty: same-origin only |
| `STACKPORT_AWS_EMULATOR_DIR` | `~/.aws/emulator` | Where StackPort looks for the per-port keys and `ca.pem` AWS Emulator writes; empty disables the lookup |
| `LOG_LEVEL` | `INFO` | Python log level (DEBUG shows healthcheck logs) |

## Learn Module

Guided tutorials that run inside the console, built on Cloudscape's own onboarding trio (`AnnotationContext` + `Hotspot` + the tutorial data model). Gated on `STACKPORT_LEARN`, surfaced to the UI as `learn_enabled` in `GET /api/health`.

**Backend** (`backend/learn/`, `backend/routes/learn.py`, `backend/learn_store.py`):
- Trail content is JSON in `backend/learn/trails/`, validated at import by `backend/learn/content.py` — a bad `verify.type` or an unknown `console.hotspotId` fails in CI, not in front of a learner
- `verify.py` holds the `CHECKS` registry: `(EndpointInfo, params) -> {status, passed, message}`, always with fresh boto3 calls (never the TTL cache), and `service_unreachable` kept distinct from "not done yet"
- Content uses `{{variable}}` placeholders. Lesson-declared variables are generated once and persisted; `{{endpointUrl}}` is filled in by the server per request. Substitution happens when the trail is served and again on the verify path
- `cli_setup.py` holds `CLI_SETUP`: emulator id -> the shell setup its CLI needs beyond `--endpoint-url`. For AWS Emulator that is the credentials file, CA bundle and host-prefix switch, shown only when StackPort itself uses the emulator's files, with paths on the learner's machine when StackPort runs in a container. `GET /api/learn/cli-setup` returns it (null for emulators that need nothing), the context refetches it when a lesson starts or the emulator identity changes (never rebuilding the tutorial), and the panel's CLI tab shows it above the command. Add an emulator by adding an entry
- `POST /api/learn/progress` with `force` records a skip, so verification is a record and never a gate
- `/api/learn` is allowlisted in `ReadOnlyMiddleware` — progress is local state, not an AWS write

**Frontend** (`ui/src/contexts/LearnContext.tsx`, `ui/src/components/cloudscape/learn/`):

Four Cloudscape behaviours dictate the design. Changing any of these breaks a lesson silently:

1. **`LearnProvider` must stay above the router** (in `main.tsx`, not in `CloudscapeShell`). Every page renders its own shell, so a shell-level `AnnotationContext` remounts on navigation and resets the step index
2. **The tutorial object is built once per run.** `AnnotationContext` resets to step 0 whenever `currentTutorial` changes identity, so step `content` is a stable element (`LearnStepContent`) that reads live state from context. Moving to a step is done deliberately, by rebuilding the tutorial sliced from that step, with `run.offset` translating indices back
3. **`completed: true` hides every hotspot.** The object handed to `AnnotationContext` always has `completed: false`; the finished state is rendered by the panel
4. **Next is gated on the next step's hotspot being mounted**, not on app logic. `isHotspotActive` therefore only returns true up to the frontier (the first unfinished step), which is what makes Next wait for verification

Also: `hotspotId` must be unique across the whole app and within a lesson (resolution is first-occurrence-wins), so never anchor inside a table cell or an `items.map`. `LearnHotspot` renders bare children when inactive, so the console is unchanged for anyone who never opens Learn. Handlers given to `AnnotationContext` are retained from mount, so anything reading `useLocation` inside them must go through a ref.

Adding an anchor: add the id to **both** `backend/learn/hotspots.py` and `ui/src/components/cloudscape/learn/hotspots.ts` (a test reads both files and fails on drift), then render `LearnHotspot` or `LearnHotspotMarker` next to the control. Give table-header markers a `direction` that opens away from the column the step asks the learner to click.

## Adding a New Service to the Backend

1. Add entries to `SERVICE_REGISTRY` in `backend/routes/stats.py` — `(resource_type, boto3_service, method, response_key)`
2. If the list API needs extra kwargs, add to `_METHOD_KWARGS` in `stats.py` (and `_GROUPED_ITEMS` / `_PER_PARENT` for grouped or per-parent listings)
3. Add detail lookup to `DESCRIBE_REGISTRY` in `backend/routes/resources.py` (plus `_DESCRIBE_KWARGS` / `_DESCRIBE_FROM_LISTING` if the id alone isn't enough)
4. Add ID field names to `_ID_FIELDS` in `resources.py`, or a `_PREFERRED_ID_FIELD` entry when another field of the item comes first
5. Add the service to `STACKPORT_SERVICES` default in `backend/config.py`
6. Add a creator for each new detail lookup in `tests/test_generic_resources.py`

## Adding a Service-Specific UI View

For services that need richer UX than the generic resource table (like S3's file browser):

1. If the service has write endpoints, add Pydantic request models in `backend/schemas/{service}.py`
2. Add backend endpoints in a new `backend/routes/{service}.py`, register in `main.py`
3. Add fetch functions in `ui/src/lib/api.ts` and TypeScript types in `ui/src/lib/types.ts`
4. Create `ui/src/components/cloudscape/views/{Service}Browser.tsx` — for complex views, extract sub-components into `ui/src/components/cloudscape/views/{service}/`
5. Register in `CLOUDSCAPE_SERVICE_VIEWS` in `ui/src/components/cloudscape/views/index.ts`

CloudscapeResourceBrowser renders `CLOUDSCAPE_SERVICE_VIEWS[service]` when available, falls back to the generic table.

View conventions (match the existing views): deep links via query params (`?queue=`, `?bucket=&prefix=`, ...), `useCollection` for filtering/pagination/sorting, Cloudscape `Modal` for detail/forms, destructive actions confirmed (type-the-name for purge/delete), export via `exportData` from `@/lib/export`, and an integration test in `ui/src/__tests__/` that renders the real route and asserts real request payloads.

## UI Conventions

- UI kit is **Cloudscape Design System** — import components individually (`import Table from '@cloudscape-design/components/table'`). No shadcn/Radix.
- Light/dark/system theme — `useTheme` applies the Cloudscape `Mode` via `applyMode` and toggles the `dark` class for the Tailwind token utilities used by the ASL graph.
- Tailwind stays as a utility layer only (code blocks, the SVG graph, small layout tweaks); prefer Cloudscape components and their props for anything structural.
- Toast notifications via `sonner` — `import { toast } from 'sonner'`.
- Service icons: `import { getServiceIcon } from '@/lib/service-icons'` returns a `LucideIcon`.
- `@/*` path alias maps to `./src/*`.
- `cn()` helper from `@/lib/utils` for conditional class merging (clsx + tailwind-merge).
- Tests use Testing Library against real routes with URL-routed fetch mocks; Cloudscape Selects need `createWrapper()` from `@cloudscape-design/components/test-utils/dom`; Tabs render only the active tab.

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
