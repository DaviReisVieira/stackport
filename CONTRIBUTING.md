# Contributing to StackPort

Thanks for taking a look. StackPort is a small project and every contribution helps, from a typo fix to a whole new service view. If you are unsure whether an idea fits, open an issue first and we can figure it out together.

## Development Setup

```bash
# Clone
git clone https://github.com/DaviReisVieira/stackport.git
cd stackport

# Backend (editable install with test dependencies)
pip install -e ".[dev]"

# Frontend
cd ui && npm install && cd ..

# Start an emulator on :4566 (pick one)
docker run -d -p 4566:4566 ministackorg/ministack
# or: pip install ministack && ministack
# or: docker run -d -p 4566:4566 floci/floci
# or: docker run -d -p 4566:4566 -e LOCALSTACK_AUTH_TOKEN=<your-token> localstack/localstack
# or: pip install "moto[server]" && moto_server -p 4566
# or, on Linux: aws-emulator -p 4566   (it serves HTTPS, so use AWS_ENDPOINT_URL=https://127.0.0.1:4566 below)

# Run StackPort
AWS_ENDPOINT_URL=http://localhost:4566 stackport   # or: python -m backend.main

# Frontend dev (hot reload, proxies to :8080)
cd ui && npm run dev
```

`AWS_ENDPOINT_URL` matters: without it, StackPort talks to real AWS through your credential chain.

## Running the checks

These are the same checks CI runs, plus lint:

```bash
python -m pytest -x --tb=short   # backend tests
cd ui && npx vitest run          # frontend tests
cd ui && npx tsc -b              # TypeScript
cd ui && npx eslint .            # lint
cd ui && npm run build           # production build into ui/dist/
```

`ui/dist/` is committed, so rebuild it after frontend changes.

## Supported emulators

StackPort only speaks the standard AWS API, so any emulator can sit behind it and there is no reason for the project to prefer one. A few ground rules keep the docs that way:

- Supported emulators are documented side by side. Each one gets a way to run it next to StackPort and notes on anything that works differently with it. Compose examples and seeds are added as people contribute them, and an emulator that needs extra setup gets the longer notes that setup takes.
- Lists follow one fixed order (MiniStack, Floci, LocalStack, Moto, AWS Emulator, then others). MiniStack goes first because the project grew out of a MiniStack pull request, not because it is preferred.
- The root `docker-compose.yml` uses MiniStack for the same historical reason. It is a working example, not a recommendation.
- Pull requests that add or improve support for an emulator are very welcome. Changes that reorder the list, reword the docs, or pick a default so one emulator stands out are declined with a pointer to this section. That applies to the maintainer as much as to anyone else.

If you maintain an emulator and something in StackPort works worse against it than against the others, please open an issue. That is exactly the kind of gap this project wants to close.

## Good first contributions

Issues labelled [`good first issue`](https://github.com/DaviReisVieira/stackport/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) are scoped so you can finish them without knowing the whole codebase. Comment on one to claim it, and ask questions in the issue whenever you get stuck.

Some paths that tend to be friendly for a first PR:

- **Add a service** to the backend registries. Most of the work is a few table entries, see [Adding a New AWS Service](#adding-a-new-aws-service).
- **Build a service view** for a service that only has the generic table today. Copy the shape of an existing view, see [Adding a Service-Specific View](#adding-a-service-specific-view).
- **Write a Learn lesson** in `backend/learn/trails/`. It is mostly JSON and prose, see [Adding a Learn Lesson](#adding-a-learn-lesson).
- **Improve the docs**: a clearer explanation, a missing example, a fact that has drifted from the code.

StackPort takes part in Hacktoberfest. Pull requests are welcome all year, and in October they count toward it too.

## Adding a New AWS Service

### Backend

1. **`backend/routes/stats.py`**: add to `SERVICE_REGISTRY`:
   ```python
   "myservice": [("resource_type", "boto3_service", "list_method", "ResponseKey")],
   ```
2. If the list API needs extra parameters, add them to `_METHOD_KWARGS` in the same file.
3. **`backend/routes/resources.py`**: add to `DESCRIBE_REGISTRY`:
   ```python
   ("myservice", "resource_type"): ("boto3_service", "describe_method", "IdParam", "ResponseKey"),
   ```
4. Add the resource's ID field names to `_ID_FIELDS` in `resources.py`.
5. **`backend/config.py`**: add the service to the `STACKPORT_SERVICES` default string.

### Frontend

Add an icon mapping in `ui/src/lib/service-icons.ts` (it falls back to a generic icon otherwise).

## Adding a Service-Specific View

For services that need richer UX than the generic resource table (like S3's file browser):

1. If the service has write endpoints, add Pydantic request models in `backend/schemas/{service}.py`
2. Add backend endpoints in `backend/routes/{service}.py` and register the router in `backend/main.py`
3. Add fetch functions in `ui/src/lib/api.ts` with types in `ui/src/lib/types.ts`
4. Create `ui/src/components/cloudscape/views/{Service}Browser.tsx` (bigger views can keep sub-components in `views/{service}/`)
5. Register it in `CLOUDSCAPE_SERVICE_VIEWS` in `ui/src/components/cloudscape/views/index.ts`
6. Add an integration test in `ui/src/__tests__/` that renders the real route and checks the request payloads

The existing views share a few habits worth keeping: deep links through query params, `useCollection` for filtering and pagination, a Cloudscape `Modal` for details and forms, type-the-name confirmation for destructive actions, and export through `exportData` from `@/lib/export`.

## Adding a Learn Lesson

Lessons live in `backend/learn/trails/*.json`. Each step has an instruction, an optional console anchor (`console.hotspotId`), a CLI command, and a `verify` check from the `CHECKS` registry in `backend/learn/verify.py`. Use `{{variable}}` placeholders for names the learner picks and `{{endpointUrl}}` for their endpoint.

Content is validated when it loads and again in `tests/test_learn_content.py`, so `python -m pytest tests/test_learn_content.py` tells you quickly if a check type or hotspot id is wrong. If a step needs a new anchor in the UI, add the id to both `backend/learn/hotspots.py` and `ui/src/components/cloudscape/learn/hotspots.ts`.

## Code Style

- **Python**: type hints, sync route handlers (FastAPI runs them in a threadpool), registry pattern over custom code, and graceful degradation (a failed probe returns empty results rather than a 500)
- **TypeScript**: strict mode, no `any`, shared types in `ui/src/lib/types.ts`, `@/` path aliases
- **UI components**: [Cloudscape Design System](https://cloudscape.design/), imported per component (`import Table from '@cloudscape-design/components/table'`). Tailwind is only a small utility layer

## Submitting Changes

1. Fork the repo and create a branch
2. Make your changes, with tests for new behaviour
3. Run the checks above (at least `python -m pytest`, `cd ui && npx vitest run`, and `cd ui && npx tsc -b && npm run build`)
4. Open a PR with a clear description, and a screenshot if the UI changed
