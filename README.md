<p align="center">
  <img src="https://raw.githubusercontent.com/DaviReisVieira/stackport/main/docs/images/stackport_logo.svg" alt="StackPort — Universal AWS Resource Browser" width="150"/>
</p>

<h1 align="center">StackPort</h1>
<p align="center"><strong>Universal AWS resource browser for local emulators and real AWS accounts.</strong></p>
<p align="center">Browse, inspect, and manage resources across 35 AWS services with dedicated UIs for S3, DynamoDB, Lambda, SQS, IAM, EC2, CloudWatch Logs, and Secrets Manager.</p>

<p align="center">
  <a href="https://github.com/DaviReisVieira/stackport/actions/workflows/ci.yml"><img src="https://github.com/DaviReisVieira/stackport/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://pypi.org/project/stackport/"><img src="https://img.shields.io/pypi/v/stackport" alt="PyPI Version"></a>
  <a href="https://hub.docker.com/r/davireis/stackport"><img src="https://img.shields.io/docker/pulls/davireis/stackport" alt="Docker Pulls"></a>
  <a href="https://hub.docker.com/r/davireis/stackport"><img src="https://img.shields.io/docker/image-size/davireis/stackport/latest" alt="Docker Image Size"></a>
  <a href="https://github.com/DaviReisVieira/stackport/blob/master/LICENSE"><img src="https://img.shields.io/github/license/DaviReisVieira/stackport" alt="License"></a>
  <img src="https://img.shields.io/badge/python-3.12-slim" alt="Python">
  <a href="https://github.com/DaviReisVieira/stackport/stargazers"><img src="https://img.shields.io/github/stars/DaviReisVieira/stackport" alt="GitHub stars"></a>
</p>

## Screenshots

**Dashboard** — Service overview with resource counts and health status
![StackPort Dashboard](https://raw.githubusercontent.com/DaviReisVieira/stackport/main/docs/images/dashboard.jpeg)

**DynamoDB Browser** — Query and scan tables with schema visualization
![DynamoDB Resources](https://raw.githubusercontent.com/DaviReisVieira/stackport/main/docs/images/dynamo.jpeg)

**S3 Browser** — File browser with upload, download, folder navigation, and tagging
![S3 Browser](https://raw.githubusercontent.com/DaviReisVieira/stackport/main/docs/images/s3.jpeg)

## Features

- Browse and inspect resources across **35 AWS services**
- **8 dedicated service UIs** for S3, DynamoDB, Lambda, SQS, IAM, EC2, CloudWatch Logs, and Secrets Manager
- **Write operations** — upload/delete S3 objects, query DynamoDB, invoke Lambda, send/receive SQS messages
- **Real AWS support** — connect to real AWS accounts with read-only mode by default
- **Tag management** — unified tagging across 21 resource types
- **CLI** — `stackport status`, `list`, `describe`, `export` with JSON/CSV/table output
- **Real-time dashboard** with WebSocket-powered live updates
- **Keyboard shortcuts** — 16 shortcuts for fast navigation (press `?` to view)
- Single Docker image, works with MiniStack, LocalStack, Moto, or any AWS-compatible endpoint

## Quick Start

### With a local emulator (recommended)

```bash
# Start MiniStack (or LocalStack, Moto, etc.)
pip install ministack && ministack

# Start StackPort
pip install stackport
stackport
# Open http://localhost:8080
```

### With real AWS

```bash
# Using AWS profile (read-only by default)
AWS_PROFILE=my-profile stackport

# Using explicit credentials
AWS_ACCESS_KEY_ID=AKIA... AWS_SECRET_ACCESS_KEY=... AWS_REGION=us-west-2 stackport

# Disable write operations (read-only mode)
STACKPORT_ALLOW_WRITES=false AWS_PROFILE=my-profile stackport
```

When connected to real AWS, StackPort shows a warning banner and operates in read-only mode unless writes are explicitly enabled.

### Docker Compose (MiniStack + StackPort)

This example uses [MiniStack](https://github.com/Nahuel990/ministack) as the emulator, but you can swap it for LocalStack, Moto, or any AWS-compatible endpoint — just update `AWS_ENDPOINT_URL`.

```bash
curl -O https://raw.githubusercontent.com/DaviReisVieira/stackport/main/examples/docker-compose.yml
docker compose up -d
# Open http://localhost:8080
```

### Docker (standalone)

```bash
docker run -p 8080:8080 -e AWS_ENDPOINT_URL=http://host.docker.internal:4566 davireis/stackport
```

### Other emulators

StackPort works with any AWS-compatible endpoint — just set `AWS_ENDPOINT_URL`:

```bash
# LocalStack
AWS_ENDPOINT_URL=http://localhost:4566 stackport

# Moto
AWS_ENDPOINT_URL=http://localhost:5000 stackport

# MinIO (S3 only)
AWS_ENDPOINT_URL=http://localhost:9000 stackport

# Any custom endpoint
AWS_ENDPOINT_URL=http://my-emulator:4566 stackport
```

### Multiple endpoints

Switch between multiple AWS endpoints from the UI. Configure named endpoints with `STACKPORT_ENDPOINTS`:

```bash
# Connect to a local emulator and a real AWS account (empty URL = real AWS)
STACKPORT_ENDPOINTS="local=http://localhost:4566,nprod=" \
  AWS_PROFILE=nprod AWS_REGION=us-west-1 stackport
```

**Docker Compose (local + real AWS):**

```bash
curl -O https://raw.githubusercontent.com/DaviReisVieira/stackport/main/examples/docker-compose.multi-endpoint.yml
docker compose -f docker-compose.multi-endpoint.yml up -d
# Open http://localhost:8080
```

See [`examples/docker-compose.multi-endpoint.yml`](examples/docker-compose.multi-endpoint.yml) for a full example with MiniStack + real AWS via profile.

The endpoint selector appears in the sidebar when more than one endpoint is configured. Each endpoint is health-checked independently, and all API requests, caches, and WebSocket subscriptions are scoped to the active endpoint.

## Service Browsers

### Dedicated UIs (8 services)

| Service | Browse | Write Operations |
|---------|--------|-----------------|
| **S3** | Buckets, objects, folder navigation, search | Upload, download, delete, batch delete, create folders |
| **DynamoDB** | Tables, schema, items | Query by partition/sort key, scan |
| **Lambda** | Functions, config, aliases, versions, event sources | Invoke with JSON payload, download code |
| **SQS** | Queues, messages, attributes | Send, receive, delete messages, purge queue |
| **IAM** | Users, roles, groups, policies, trust policies | Read-only |
| **EC2** | Instances, VPCs, subnets, security groups, volumes | Read-only |
| **CloudWatch Logs** | Log groups, streams, events with time filtering | Read-only |
| **Secrets Manager** | Secrets with value reveal, rotation status | Read-only |

### Generic Resource Browser (27 services)

All other services use a searchable resource table with JSON detail view, pagination, and export (JSON/CSV).

## Tag Management

Unified tag read/write across 21 resource types:

S3 buckets, DynamoDB tables, Lambda functions, SQS queues, IAM users/roles/policies, EC2 instances/security groups/volumes, CloudWatch log groups, Secrets Manager secrets, RDS instances/clusters, SNS topics, KMS keys, ECR repositories, CloudFormation stacks, Step Functions state machines, Kinesis streams, SSM parameters, ELB load balancers, ElastiCache clusters

## CLI

```bash
# Show service availability and resource counts
stackport status
stackport status --output json

# List resources for a service
stackport list s3
stackport list dynamodb --output csv

# Get resource details
stackport describe s3 buckets my-bucket
stackport describe lambda functions my-func --output json

# Export all resources
stackport export lambda --format json
stackport export ec2 --format csv
```

All CLI commands accept `--endpoint URL` and `--region REGION` overrides.

## Keyboard Shortcuts

Press `?` anywhere to see all shortcuts.

| Key | Action |
|-----|--------|
| `?` | Show shortcuts modal |
| `b` | Toggle sidebar |
| `g d` | Go to Dashboard |
| `g r` | Go to Resources |
| `/` | Focus search |
| `j` / `k` | Navigate up/down in resource list |
| `[` / `]` | Previous/next service |
| `Enter` | Open selected resource |
| `r` | Refresh current view |
| `Esc` | Close panel / clear selection |

## Configuration

| Variable | Default | Description |
|---|---|---|
| `AWS_ENDPOINT_URL` | *(unset)* | AWS endpoint. Unset = real AWS via credential chain |
| `AWS_REGION` | `us-east-1` | AWS region |
| `AWS_ACCESS_KEY_ID` | *(unset)* | AWS access key. Unset = use credential chain |
| `AWS_SECRET_ACCESS_KEY` | *(unset)* | AWS secret key. Unset = use credential chain |
| `AWS_PROFILE` | *(unset)* | AWS named profile from `~/.aws/credentials` |
| `STACKPORT_PORT` | `8080` | StackPort server port |
| `STACKPORT_ALLOW_WRITES` | `true` | Enable write operations (POST/PUT/DELETE) |
| `STACKPORT_S3_MAX_UPLOAD_MB` | `100` | Max S3 upload size per object (MiB) |
| `STACKPORT_SERVICES` | *(35 services)* | Comma-separated list of services to probe |
| `STACKPORT_PROBE_TIMEOUT` | `5` | Seconds before a service probe times out |
| `STACKPORT_CACHE_TTL` | `5` | Seconds to cache service stats |
| `STACKPORT_PROBE_WORKERS` | `10` | Max concurrent workers for service probing |
| `STACKPORT_ENDPOINTS` | *(unset)* | Multiple endpoints: `local=http://localhost:4566,staging=http://...` |
| `LOG_LEVEL` | `INFO` | Python log level (`DEBUG` shows healthcheck logs) |

## Supported Services (35)

ACM, API Gateway, AppSync, Athena, CloudFormation, CloudFront, Cognito (IDP + Identity), DynamoDB, EC2, ECR, ECS, ElastiCache, EFS, ELB, EMR, EventBridge, Firehose, Glue, IAM, Kinesis, KMS, Lambda, CloudWatch Logs, CloudWatch Monitoring, RDS, Route 53, S3, Secrets Manager, SES, SNS, SQS, SSM, Step Functions, STS, WAFv2

## Development

```bash
git clone https://github.com/DaviReisVieira/stackport.git
cd stackport

# Backend
pip install -e .
AWS_ENDPOINT_URL=http://localhost:4566 stackport

# Frontend dev (with hot reload)
cd ui && npm install && npm run dev

# Build frontend for production
cd ui && npm run build

# Run tests
python -m pytest tests/ -x --tb=short    # backend (262 tests)
cd ui && npx vitest run                   # frontend (163 tests)

# Typecheck & lint
cd ui && npx tsc -b
cd ui && npx eslint .
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for full details.

## Architecture

```
backend/
  main.py          FastAPI app, CORS, read-only middleware, SPA mount
  config.py        All settings from environment variables
  aws_client.py    Cached boto3 client factory
  cache.py         Thread-safe TTL cache
  websocket.py     Real-time probe loop for dashboard
  routes/
    stats.py       Service discovery with concurrent probing
    resources.py   Generic list/detail for all services
    tags.py        Unified tag management (21 types)
    s3.py          S3 file browser with write ops
    dynamodb.py    DynamoDB query/scan
    lambda_svc.py  Lambda invoke/config/code
    sqs.py         SQS send/receive/purge
    iam.py         IAM users/roles/groups/policies
    ec2.py         EC2 instances/VPCs/security groups
    logs.py        CloudWatch log streams/events
    secretsmanager.py  Secret value retrieval

ui/src/
  pages/           Dashboard, ResourceBrowser, About
  components/
    service-views/ S3Browser, DynamoDBBrowser, LambdaBrowser, ...
    ui/            shadcn/ui components (Radix-based)
  hooks/           useFetch, useWebSocket, useKeyboardShortcuts, ...
  lib/             API client, types, service icons, utils
```

## Star History

<a href="https://star-history.com/#DaviReisVieira/stackport&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=DaviReisVieira/stackport&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=DaviReisVieira/stackport&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=DaviReisVieira/stackport&type=Date" width="100%" />
 </picture>
</a>

## Contributors

<a href="https://github.com/DaviReisVieira/stackport/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=DaviReisVieira/stackport" alt="Contributors" />
</a>

## License

MIT
