"""botocore's service models, as the API Explorer presents them.

Everything comes from the models botocore loads for boto3 (its own, plus any
in ``~/.aws/models`` or ``AWS_DATA_PATH``), so the explorer offers exactly the
services and operations boto3 can call. Models load on demand: listing the
services reads only the first bytes of each model file, and only the models
used recently stay in memory.

``is_read_operation`` is the single answer to "is this a read?": read-only
mode runs an operation through the explorer only when it says so.
"""

from __future__ import annotations

import functools
import gzip
import json
import re
from html.parser import HTMLParser
from typing import Any, Literal

from botocore import xform_name
from botocore.exceptions import DataNotFoundError
from botocore.loaders import JSONFileLoader, Loader, create_loader
from botocore.model import OperationModel, Shape, ServiceModel
from botocore.paginate import PaginatorModel
from botocore.session import Session

Access = Literal["read", "write"]


class UnknownService(LookupError):
    """A name botocore has no model for."""


class UnknownOperation(LookupError):
    """A name that isn't an operation of the service."""


@functools.cache
def _search_path_string() -> str | None:
    # The same extra model folders boto3's clients search (AWS_DATA_PATH, or data_path in the config file)
    return Session().get_config_variable("data_path")


# --- Services -----------------------------------------------------------------

# serviceFullName sits in the metadata block at the top of every model file,
# well inside this many bytes (under 400 for every model botocore ships).
_HEAD_BYTES = 4096
_FULL_NAME = re.compile(rb'"serviceFullName"\s*:\s*("(?:[^"\\]|\\.)*")')


class _FullNameReader(JSONFileLoader):
    """Reads a model file's full service name without parsing the rest of it.

    Parsing every model to list ~400 services would take most of a second and
    hundreds of megabytes; the start of each file takes milliseconds.
    """

    def load_file(self, file_path: str) -> dict[str, str] | None:
        for extension, opener in ((".json", open), (".json.gz", gzip.open)):
            try:
                with opener(file_path + extension, "rb") as model_file:
                    head = model_file.read(_HEAD_BYTES)
            except FileNotFoundError:
                continue
            match = _FULL_NAME.search(head)
            return {"serviceFullName": json.loads(match.group(1))} if match else {}
        return None


@functools.cache
def list_services() -> list[dict[str, str | None]]:
    """Every service botocore has a model for, by name, with its full name when the model gives one."""
    loader = create_loader(_search_path_string())
    reader = Loader(
        extra_search_paths=loader.search_paths,
        file_loader=_FullNameReader(),
        include_default_search_paths=False,
        include_default_extras=False,
    )
    services = []
    for name in loader.list_available_services("service-2"):
        api_version = reader.determine_latest_version(name, "service-2")
        metadata = reader.load_data(f"{name}/{api_version}/service-2")
        services.append({"name": name, "fullName": metadata.get("serviceFullName")})
    return services


@functools.lru_cache(maxsize=16)
def _load(service: str) -> tuple[ServiceModel, PaginatorModel | None]:
    # A loader of its own, dropped with the model: botocore's loaders keep every
    # model they load, and browsing the explorer would keep hundreds.
    loader = create_loader(_search_path_string())
    try:
        model = ServiceModel(loader.load_service_model(service, "service-2"), service_name=service)
    except DataNotFoundError as exc:
        raise UnknownService(f"No service named '{service}'.") from exc
    try:
        paginators = PaginatorModel(loader.load_service_model(service, "paginators-1", model.api_version))
    except DataNotFoundError:
        paginators = None
    return model, paginators


@functools.cache
def _service_names() -> frozenset[str]:
    return frozenset(entry["name"] for entry in list_services())


def _known_service(service: str) -> str:
    # Only names from the listing reach the loader, never a path someone typed
    if service not in _service_names():
        raise UnknownService(f"No service named '{service}'.")
    return service


def service_model(service: str) -> ServiceModel:
    return _load(_known_service(service))[0]


def operation_model(service: str, operation: str) -> OperationModel:
    model = service_model(service)
    if operation not in model.operation_names:
        raise UnknownOperation(f"{service} has no operation named '{operation}'.")
    return model.operation_model(operation)


def pagination(service: str, operation: str) -> dict[str, Any] | None:
    """botocore's paginator config for the operation (tokens as lists), or None when it doesn't paginate."""
    paginators = _load(_known_service(service))[1]
    if paginators is None:
        return None
    try:
        config = paginators.get_paginator(operation)
    except ValueError:
        return None
    return {
        "input_tokens": _as_list(config["input_token"]),
        "output_tokens": _as_list(config["output_token"]),
        "more_results": config.get("more_results"),
        "limit_key": config.get("limit_key"),
        "result_keys": _as_list(config.get("result_key") or []),
    }


def _as_list(value: str | list[str]) -> list[str]:
    return [value] if isinstance(value, str) else list(value)


# --- Reads and writes -------------------------------------------------------------

# An operation is a read when its name starts with one of these words, alone or
# after Batch or Transact (BatchGetItem, TransactGetItems), and it neither
# changes anything nor hands out a way in. Anything else is a write, including
# operations that only compute something (Encrypt) or that look like reads but
# change state: ReceiveMessage hides the messages it returns, StartQueryExecution
# runs any SQL.
_READ_VERBS = frozenset({"Describe", "Filter", "Get", "Head", "List", "Lookup", "Query", "Scan", "Search", "Select"})
_LEADING_VERB = re.compile(r"(?:Batch|Transact)?([A-Z][a-z]+)")

# Named like reads, but they change something or hand out access that the
# credential rule below can't see in their response.
_WRITES_DESPITE_THEIR_NAME = frozenset({
    # Create, start or send something
    ("cognito-identity", "GetId"),  # creates the identity on first use
    ("cognito-identity", "GetOpenIdToken"),  # extra logins link to the identity
    ("cognito-identity", "GetOpenIdTokenForDeveloperIdentity"),  # registers or links an identity
    ("cognito-idp", "GetUserAttributeVerificationCode"),  # sends a code by email or SMS
    ("cognito-idp", "GetTokensFromRefreshToken"),  # can rotate the refresh token
    ("controltower", "ListLandingZones"),  # creates the landing zone's ARN
    ("iot", "DescribeEndpoint"),  # creates the endpoint on the first call
    ("iot", "GetRegistrationCode"),  # creates the code when there's none
    ("payment-cryptography", "GetCertificateSigningRequest"),  # signs with the key pair
    ("redshift", "GetClusterCredentials"),  # can create the database user
    ("sagemaker", "GetScalingConfigurationRecommendation"),  # starts a recommendation job
    ("waf", "GetChangeToken"),  # starts a change
    ("waf-regional", "GetChangeToken"),
    # Hand out credentials, unlock codes or signed URLs
    ("account-access-runtime", "GetRoleCredentials"),
    ("acm", "GetAcmeExternalAccountBindingCredentials"),
    ("amplifybackend", "GetToken"),
    ("auditmanager", "GetEvidenceFileUploadUrl"),
    ("bedrock-agentcore", "GetResourcePaymentToken"),
    ("codepipeline", "GetJobDetails"),
    ("codepipeline", "GetThirdPartyJobDetails"),
    ("connectparticipant", "GetAuthenticationUrl"),
    ("datazone", "GetIamPortalLoginUrl"),
    ("emr", "GetClusterSessionCredentials"),
    ("emr-serverless", "GetDashboardForJobRun"),
    ("gamelift", "GetInstanceAccess"),
    ("kinesis-video-archived-media", "GetDASHStreamingSessionURL"),
    ("kinesis-video-archived-media", "GetHLSStreamingSessionURL"),
    ("m2", "GetSignedBluinsightsUrl"),
    ("quicksight", "GetDashboardEmbedUrl"),
    ("quicksight", "GetSessionEmbedUrl"),
    ("snowball", "GetJobUnlockCode"),
})

# Read-only mode is for looking, and new credentials are a way to act, so an
# operation whose response holds keys, tokens or passwords is a write: sts
# GetSessionToken, ecr GetAuthorizationToken, redshift-serverless GetCredentials.
# Only text near the top of the response counts (lists don't add a level): a
# password deep in a resource's settings, like RDS's pending MasterUserPassword,
# is part of describing the resource. Reading a stored value (Secrets Manager
# GetSecretValue, SSM GetParameter) stays a read: none of its members is named so.
_CREDENTIAL_MEMBER = re.compile(
    r"(secretaccesskey|secretkey|sessiontoken|authorizationtoken|authtoken|accesstoken|refreshtoken|idtoken|password|privatekey)$"
)
_PAGING_TOKEN = re.compile(r"(next|pagination|continuation)token$")
_CREDENTIAL_DEPTH = 1


def _hands_out_credentials(shape: Shape | None, depth: int = 0) -> bool:
    if shape is None:
        return False
    if shape.type_name == "list":
        return _hands_out_credentials(shape.member, depth)
    if shape.type_name == "map":
        return _hands_out_credentials(shape.value, depth)
    if shape.type_name != "structure" or depth > _CREDENTIAL_DEPTH:
        return False
    for name, member in shape.members.items():
        key = name.lower().replace("_", "")
        if member.type_name in ("string", "blob") and not _PAGING_TOKEN.search(key):
            # A bare "Token" counts only when the model marks it sensitive (redshift GetIdentityCenterAuthToken)
            if _CREDENTIAL_MEMBER.search(key) or (key.endswith("token") and member.metadata.get("sensitive")):
                return True
        elif _hands_out_credentials(member, depth + 1):
            return True
    return False


def access_of(service: str, operation: OperationModel) -> Access:
    """How an operation is classified: from its name, its response, and the lists above."""
    if (service, operation.name) in _WRITES_DESPITE_THEIR_NAME:
        return "write"
    match = _LEADING_VERB.match(operation.name)
    if not match or match.group(1) not in _READ_VERBS:
        return "write"
    return "write" if _hands_out_credentials(operation.output_shape) else "read"


def is_read_operation(service: str, operation: str) -> bool:
    """True only for a real operation of a real service that only reads."""
    try:
        model = operation_model(service, operation)
    except (UnknownService, UnknownOperation):
        return False
    return access_of(service, model) == "read"


# --- Commands -----------------------------------------------------------------------

# The AWS CLI names a few services differently from botocore.
_CLI_SERVICE_NAMES = {"codedeploy": "deploy", "config": "configservice", "s3": "s3api"}


def cli_command(service: str, operation: str) -> str:
    """The AWS CLI command for an operation, such as ``s3api list-objects-v2``."""
    return f"{_CLI_SERVICE_NAMES.get(service, service)} {xform_name(operation, '-')}"


# --- Documentation ------------------------------------------------------------------

_BLOCK_TAGS = frozenset({
    "dd", "div", "dl", "dt", "examples", "h1", "h2", "h3", "h4", "h5", "h6",
    "important", "note", "ol", "p", "pre", "ul",
})
_SKIPPED_TAGS = frozenset({"fullname"})  # repeats the service name at the top of service docs


class _DocText(HTMLParser):
    """botocore documentation (HTML fragments) as plain text with paragraphs and bullets."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skipping = 0
        # A bullet with no text yet: the paragraph inside a list item starts on the bullet's line
        self._bullet_open = False

    def _break(self, text: str) -> None:
        if not self._bullet_open:
            self.parts.append(text)

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in _SKIPPED_TAGS:
            self._skipping += 1
        elif tag == "li":
            self.parts.append("\n- ")
            self._bullet_open = True
        elif tag == "br":
            self._break("\n")
        elif tag in _BLOCK_TAGS:
            self._break("\n\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIPPED_TAGS:
            self._skipping = max(0, self._skipping - 1)
        elif tag in _BLOCK_TAGS:
            self._break("\n\n")

    def handle_data(self, data: str) -> None:
        if self._skipping:
            return
        text = re.sub(r"\s+", " ", data)
        if self._bullet_open:
            text = text.lstrip()
            if not text:
                return
            self._bullet_open = False
        self.parts.append(text)


def doc_text(html: str | None) -> str:
    if not html:
        return ""
    parser = _DocText()
    parser.feed(html)
    parser.close()
    text = re.sub(r"[ \t]*\n[ \t]*", "\n", "".join(parser.parts))
    text = re.sub(r"\n{2,}(?=- )", "\n", text)  # bullets of a list on consecutive lines
    return re.sub(r"\n{3,}", "\n\n", text).strip()


_SUMMARY_LIMIT = 200


def summary(text: str) -> str:
    """The first sentence of plain-text documentation, capped for a list."""
    # The first line: a list can follow the opening sentence ("The filters.\n- affinity ...")
    paragraph = text.split("\n", 1)[0]
    sentence = re.split(r"(?<=[.!?])\s+(?=[A-Z])", paragraph, maxsplit=1)[0]
    if len(sentence) <= _SUMMARY_LIMIT:
        return sentence
    return sentence[: _SUMMARY_LIMIT - 1].rsplit(" ", 1)[0] + "…"


# --- Catalog responses ----------------------------------------------------------------


@functools.lru_cache(maxsize=16)
def describe_service(service: str) -> dict[str, Any]:
    """A service and the operations it has, for the explorer's operation list."""
    model = service_model(service)
    operations = []
    for name in model.operation_names:
        operation = model.operation_model(name)
        operations.append({
            "name": name,
            "summary": summary(doc_text(operation.documentation)),
            "access": access_of(service, operation),
            "paginated": pagination(service, name) is not None,
            "deprecated": bool(operation.deprecated),
            "streaming": bool(operation.has_streaming_input or operation.has_streaming_output),
            "eventStream": bool(operation.has_event_stream_input or operation.has_event_stream_output),
        })
    return {
        "name": service,
        "fullName": model.metadata.get("serviceFullName"),
        "apiVersion": model.api_version,
        "protocol": model.protocol,
        "documentation": doc_text(model.documentation),
        "operations": operations,
    }


def describe_operation(service: str, operation: str) -> dict[str, Any]:
    """Everything the explorer needs to build a request for one operation."""
    model = operation_model(service, operation)
    paging = pagination(service, operation)
    return {
        "service": service,
        "name": operation,
        "documentation": doc_text(model.documentation),
        "access": access_of(service, model),
        "deprecated": bool(model.deprecated),
        "methodName": xform_name(operation),
        "cliCommand": cli_command(service, operation),
        # The AWS CLI can't take --cli-input-json for operations that save their
        # output to a file (s3api get-object, lambda invoke): those need options.
        "cliOptions": {
            name: f"--{xform_name(name, '-')}" for name in (model.input_shape.members if model.input_shape else {})
        },
        "pagination": (
            {"inputTokens": paging["input_tokens"], "limitKey": paging["limit_key"], "resultKeys": paging["result_keys"]}
            if paging
            else None
        ),
        "streamingInput": bool(model.has_streaming_input),
        "streamingOutput": bool(model.has_streaming_output),
        "eventStreamInput": bool(model.has_event_stream_input),
        "eventStreamOutput": bool(model.has_event_stream_output),
        "input": shape_graph(model.input_shape) if model.input_shape is not None else None,
    }


# --- Shapes ----------------------------------------------------------------------------------

def shape_graph(root: Shape) -> dict[str, Any]:
    """The shapes an input reaches, each once, keyed by name.

    Members, list items and map values refer to shapes by name, so a recursive
    shape (a DynamoDB AttributeValue holding a map of AttributeValues) is listed
    once and the UI follows the names only as far as someone opens them. A tree
    with every shape inlined would repeat shared shapes and never end on
    recursive ones.
    """
    shapes: dict[str, dict[str, Any]] = {}
    pending = [root]
    while pending:
        shape = pending.pop()
        if shape.name in shapes:
            continue
        node, children = _shape_node(shape)
        shapes[shape.name] = node
        pending.extend(children)
    return {"root": root.name, "shapes": shapes}


def _shape_node(shape: Shape) -> tuple[dict[str, Any], list[Shape]]:
    metadata = shape.metadata
    node: dict[str, Any] = {"type": shape.type_name}
    for constraint in ("min", "max", "pattern"):
        if constraint in metadata:
            node[constraint] = metadata[constraint]
    if metadata.get("sensitive"):
        node["sensitive"] = True

    if shape.type_name == "structure":
        if metadata.get("document"):
            return {**node, "type": "document"}, []
        members = []
        for name, member in shape.members.items():
            entry: dict[str, Any] = {"name": name, "shape": member.name}
            documentation = doc_text(member.documentation)
            if documentation:
                entry["documentation"] = documentation
            if member.metadata.get("idempotencyToken"):
                entry["idempotencyToken"] = True
            members.append(entry)
        node["required"] = list(metadata.get("required", []))
        node["members"] = members
        if metadata.get("union"):
            node["union"] = True
        return node, list(shape.members.values())
    if shape.type_name == "list":
        node["member"] = shape.member.name
        return node, [shape.member]
    if shape.type_name == "map":
        node["key"] = shape.key.name
        node["value"] = shape.value.name
        return node, [shape.key, shape.value]
    if shape.type_name == "string" and shape.enum:
        node["enum"] = list(shape.enum)
    if shape.type_name == "blob" and shape.serialization.get("streaming"):
        node["streaming"] = True
    return node, []
