## Summary

Implements **full SQS queue management** in the StackPort UI: create/delete queues, edit queue attributes, send/receive/delete messages (single & batch), dead-letter queue (DLQ) auto-creation, and **save favorite messages** for quick reuse. Compatible with LocalStack, MiniStack, Moto, or any AWS-compatible endpoint.

---

## What changed

### Backend (`backend/routes/sqs.py`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/sqs/queues` | List all queues with metadata |
| `POST` | `/api/sqs/queues` | Create queue (Standard/FIFO, DLQ, encryption, tags) |
| `GET` | `/api/sqs/queues/{queue_name}` | Get queue detail (attributes, redrive policy, tags) |
| `DELETE` | `/api/sqs/queues/{queue_name}` | Delete queue |
| `PUT` | `/api/sqs/queues/{queue_name}/attributes` | Update queue attributes |
| `PUT` | `/api/sqs/queues/{queue_name}/redrive-policy` | Set/remove DLQ redrive policy |
| `POST` | `/api/sqs/queues/{queue_name}/purge` | Purge all messages |
| `POST` | `/api/sqs/queues/{queue_name}/messages` | Send single message |
| `POST` | `/api/sqs/queues/{queue_name}/messages/batch` | Send up to 10 messages (batch) |
| `GET` | `/api/sqs/queues/{queue_name}/messages` | Receive up to 10 messages |
| `DELETE` | `/api/sqs/queues/{queue_name}/messages` | Delete single message |
| `DELETE` | `/api/sqs/queues/{queue_name}/messages/batch` | Batch delete messages |

**Key features:**
- **DLQ auto-creation**: When creating a queue with DLQ enabled, a DLQ queue named `{queueName}-dlq` is automatically created
- **Redrive policy management**: Set or remove DLQ configuration on existing queues
- **FIFO queue support**: Content-based deduplication, message group ID, deduplication ID
- **Encryption**: SQS-managed SSE or custom KMS key
- **Tagging**: Create/update tags on queue creation
- **Batch operations**: Send/delete up to 10 messages at once

### Frontend (`ui/src/components/service-views/SQSBrowser.tsx`)

**Queue Management:**
- Create queue sheet with basic/advanced tabs (type, visibility timeout, retention, DLQ, encryption, tags)
- Edit settings sheet to modify queue attributes and DLQ configuration
- Delete queue with name confirmation
- Purge queue with name confirmation
- Queue list with pagination, search, and favorite queues section

**Message Operations:**
- Send single message with optional delay, FIFO attributes (group ID, dedup ID)
- Batch send up to 10 messages (flexible JSON format)
- Peek messages (receive with visibility timeout = 0)
- View message details with system attributes and message attributes
- Delete single message
- Bulk delete selected messages
- Checkbox selection with "select all" toggle

**Favorites System:**
- **Save message as favorite**: Click star icon → opens sheet with pre-filled message body (JSON formatted) and default name
- **Create favorite from scratch**: Custom single/batch message templates
- **View favorite**: Read message body, edit name/body, copy to clipboard
- **Resend to queue**: Send favorite message to current queue (single or batch)
- **Delete favorite**: With name confirmation
- **LocalStorage persistence**: Favorites stored in browser

**UI Components:**
- Tabs: Messages, Favorites, Configuration, Tags
- Message table with selection, preview, actions
- Queue depth badges (Empty/Low/Medium/High)
- Queue type badges (Standard/FIFO)
- Toast notifications (Sonner)
- Export dropdown for queue list

### Hooks (`ui/src/hooks/useSQSFavoriteMessages.ts`)

- Custom hook for managing favorite messages in localStorage
- CRUD operations: `addFavorite`, `addFavorites`, `removeFavorite`, `updateFavorite`
- Auto-generates IDs and timestamps

### API (`ui/src/lib/api.ts`)

New SQS-related functions:
- `fetchSQSQueues`, `fetchSQSQueueDetail`
- `createSQSQueue`, `deleteSQSQueue`
- `sendSQSMessage`, `sendSQSMessagesBatch`
- `receiveSQSMessages`, `deleteSQSMessage`, `deleteSQSMessagesBatch`
- `purgeSQSQueue`
- `updateSQSQueueAttributes`, `updateSQSRedrivePolicy`

### Types (`ui/src/lib/types.ts`)

New interfaces:
- `SQSQueue`, `SQSQueueDetail`
- `SQSMessage`, `SQSSendMessageRequest`, `SQSSendMessageResponse`
- `SQSCreateQueueRequest`, `SQSCreateQueueResponse`
- `SQSBatchSendRequest`, `SQSBatchSendResponse`, `SQSBatchDeleteRequest`
- `SQSUpdateAttributesRequest`
- `SQSFavoriteMessage`, `SQSFavoriteMessages`

### Tests (`tests/test_sqs_routes.py`)

Comprehensive backend tests:
- List queues, create queue, get queue detail
- FIFO queue creation with content-based deduplication
- Queue attributes (visibility timeout, retention, delay, max message size, receive wait time)
- Redrive policy (DLQ configuration)
- Encryption (SQS-managed SSE, custom KMS key)
- Tags on queue creation
- Send/receive/delete single message
- Batch send/delete messages
- Purge queue
- Delete queue
- Update queue attributes
- Update redrive policy (add/remove DLQ)
- Error handling (queue not found, invalid FIFO names, etc.)

### Build

- `ui/dist/` updated with new bundled assets
- `Makefile` added for convenience (install, dev, build, lint commands)

---

## Out of scope

- Long polling settings beyond receive wait time
- Message visibility timeout extension
- Queue ARN/URL copying
- Import/export favorite messages
- CloudWatch metrics/alarms integration

---

## How to verify

1. Run your AWS emulator (e.g. `ministack` or `localstack` on `:4566`)
2. Run StackPort: `STACKPORT_PORT=8080 python -m backend.main`
3. **Resources → SQS**:
   - Create Standard and FIFO queues with various configurations
   - Enable DLQ and verify auto-creation of `{name}-dlq` queue
   - Edit queue settings and DLQ configuration
   - Send single and batch messages
   - Receive/peek messages
   - Select and delete multiple messages
   - Click star icon to save message as favorite (verify JSON is formatted)
   - View Favorites tab, resend favorites to queue
   - Create/edit/delete favorites manually
   - Purge and delete queues
4. Run `pytest tests/test_sqs_routes.py -v`

---

## Technical notes

- **FIFO naming**: Queue names must end with `.fifo` suffix
- **Batch limits**: Maximum 10 messages per batch send/delete
- **DLQ naming**: Auto-created DLQ uses `{parentQueueName}-dlq` convention
- **Favorites storage**: Browser localStorage (`sqs-favorite-messages` key)
- **Queue favorites**: Separate localStorage (`sqs-favorites`) for pinning queues to top of list

---

Thanks for reviewing — happy to tweak wording or split changes if that helps review.
