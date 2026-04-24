"""Pydantic request/response schemas, organized per AWS service.

Each service gets its own module (e.g. ``schemas.sqs``, ``schemas.s3``).
Route handlers import only what they need::

    from backend.schemas.sqs import CreateQueueRequest, SendMessageRequest

When adding a new service, create ``backend/schemas/<service>.py`` and
define all request/response models there.  Keep route files thin — they
should contain endpoint logic, not data-shape definitions.
"""
