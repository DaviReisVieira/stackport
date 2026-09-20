# Contributing to StackPort

## Development Setup

```bash
# Clone
git clone https://github.com/DaviReisVieira/stackport.git
cd stackport

# Backend
pip install -e .

# Frontend
cd ui && npm install

# Start an emulator on :4566 (pick one)
docker run -d -p 4566:4566 ministackorg/ministack
# or: docker run -d -p 4566:4566 floci/floci
# or: pip install ministack && ministack
# or: docker run -d -p 4566:4566 localstack/localstack

# Run StackPort
AWS_ENDPOINT_URL=http://localhost:4566 python -m backend.main

# Frontend dev (hot reload, proxies to :8080)
cd ui && npm run dev
```

## Emulator neutrality

StackPort exists to give the whole local-AWS community one browser that works the same against any emulator. It talks to them only through the standard AWS API, and it does not recommend one over another. In practice:

- Supported emulators are documented side by side, with the same depth. If one gets a Compose example, a seed, or a Quick Start line, the others get the equivalent.
- Lists follow one fixed order (MiniStack, Floci, LocalStack, Moto, then others) so nobody has to argue about position. MiniStack goes first because the project grew out of a MiniStack pull request, not because it is preferred.
- The root `docker-compose.yml` uses MiniStack for the same historical reason. It is a working example, not a recommendation.
- Pull requests that add or improve support for an emulator are very welcome. Pull requests that change the order, the wording, or the default to favour one emulator over another will be closed with a link to this section, whoever opens them.

If you maintain an emulator and something in StackPort works worse against it than against the others, please open an issue. That is the kind of gap this project wants to close.

## Adding a New AWS Service

### Backend (3 files)

1. **`backend/routes/stats.py`** — Add to `SERVICE_REGISTRY`:
   ```python
   "myservice": [("resource_type", "boto3_service", "list_method", "ResponseKey")],
   ```

2. **`backend/routes/resources.py`** — Add to `DESCRIBE_REGISTRY`:
   ```python
   ("myservice", "resource_type"): ("boto3_service", "describe_method", "IdParam", "ResponseKey"),
   ```

3. **`backend/config.py`** — Add to `STACKPORT_SERVICES` default string.

### Frontend (1 file)

Add an icon mapping in `ui/src/lib/service-icons.ts`.

## Adding a Service-Specific Browser (like S3)

For services that need richer UX than the generic resource table:

1. Add backend endpoints in `backend/routes/{service}.py`, register in `main.py`
2. Add fetch functions in `ui/src/lib/api.ts` with types in `ui/src/lib/types.ts`
3. Create `ui/src/components/service-views/{Service}Browser.tsx`
4. Register in `SERVICE_VIEWS` in `ui/src/components/service-views/index.ts`

## Code Style

- **Python**: Type hints, sync handlers (FastAPI auto-threadpools), registry pattern
- **TypeScript**: Strict mode, shared types in `types.ts`, `@/` path aliases
- **UI components**: shadcn/ui (Radix-based, Tailwind v3). Do NOT use `npx shadcn@latest`

## Building

```bash
cd ui && npm run build    # Build frontend → ui/dist/
npx tsc -b                # TypeScript check
```

## Submitting Changes

1. Fork the repo and create a branch
2. Make your changes
3. Ensure `cd ui && npx tsc -b && npm run build` passes
4. Submit a PR with a clear description
