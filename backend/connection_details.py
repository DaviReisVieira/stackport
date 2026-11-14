"""Ready-to-use connections for what code connects to: databases, caches, search domains, brokers and queues.

Each comes from what the endpoint returned for the resource, turned into the
address to connect to and a command or connection string to copy. Passwords
and tokens are only ever placeholders.

An address is changed only where the change is certain: ``0.0.0.0`` names no
host to connect to, only "every interface of the machine the emulator runs
on", so it becomes the endpoint's host; and where an emulator says how its
addresses relate to the machine, ``ADDRESSES`` holds it, keyed by the ids
``backend.emulators`` recognises. Each entry was checked against the emulator:

- AWS Emulator finds a queue by the ``/<account>/<name>`` path of its URL on
  any address it answers on (``queue_name_from_url`` in its SQS service), and
  returns AWS's own queue URL, so the URL on the endpoint is the one to use
  from this machine. It serves databases and caches on ports of their own,
  inside its container when it runs in one (``EMULATOR_BIND_ADDRESS`` and
  ``EMULATOR_LISTENER_PORT_RANGE`` in its server).
- MiniStack returns queue URLs on the address it was reached at, and
  databases at ``MINISTACK_HOST`` on the port it published; it has no Kafka
  brokers unless ``MINISTACK_MSK_BOOTSTRAP`` names one (``services/msk.py``).
- Floci accepts a queue URL on any host whose path ends in ``/<account>/<name>``
  (its SQS docs), and in a container reports databases, caches and brokers on
  Docker's network unless its settings publish them.
- LocalStack's ``localhost.localstack.cloud`` names point at this machine, and
  port 4566 in them is its gateway: the port the endpoint reaches it on.
- Moto keeps a resource's settings without running it.
"""

from __future__ import annotations

import ipaddress
import re
import shlex
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import quote, urlsplit

from backend.emulators import endpoint_base_url

PASSWORD = "<password>"
AUTH_TOKEN = "<auth-token>"
WILDCARD_HOSTS = frozenset({"0.0.0.0", "::"})


@dataclass(frozen=True)
class Note:
    text: str
    # "own": only when it returned an address on its own machine (loopback or 0.0.0.0);
    # "elsewhere": only when it returned one that isn't. Anything else: always.
    when: Literal["always", "own", "elsewhere"] = "always"

    def applies(self, hosts: list[str]) -> bool:
        if self.when == "own":
            return any(_is_own_address(host) for host in hosts)
        if self.when == "elsewhere":
            return any(not _is_own_address(host) for host in hosts)
        return True


@dataclass(frozen=True)
class EmulatorAddresses:
    """How one emulator's addresses relate to the machine it runs on."""

    # It finds a queue by the /<account>/<name> path of its URL on any of its addresses.
    queue_urls_by_path: bool = False
    # Addresses on this domain and port reach its gateway, wherever the endpoint reaches it.
    gateway: tuple[str, int] | None = None
    # What to know about reaching a service's resources, keyed by the registry's service name.
    notes: Mapping[str, Note] = field(default_factory=dict)


_MOTO_NOTE = Note("Moto keeps this resource's settings but doesn't run it, so nothing answers at this address.")
_AWS_EMULATOR_LISTENER_NOTE = Note(
    "AWS Emulator serves this on a port of its own. When it runs in a container, start it with "
    "EMULATOR_BIND_ADDRESS=0.0.0.0 and EMULATOR_LISTENER_PORT_RANGE set to a range of ports, and publish "
    "those ports, to connect from this machine.",
    when="own",
)

ADDRESSES: dict[str, EmulatorAddresses] = {
    "aws-emulator": EmulatorAddresses(
        queue_urls_by_path=True,
        notes={"rds": _AWS_EMULATOR_LISTENER_NOTE, "elasticache": _AWS_EMULATOR_LISTENER_NOTE},
    ),
    "ministack": EmulatorAddresses(
        notes={
            "rds": Note(
                "On a Docker network, MiniStack reports the database's address on that network. Start it with "
                "MINISTACK_RDS_PUBLIC_ENDPOINT=1 to have it report the port it published on this machine.",
                when="elsewhere",
            ),
            "kafka": Note(
                "MiniStack doesn't run Kafka brokers: this address is a placeholder unless MiniStack was started "
                "with MINISTACK_MSK_BOOTSTRAP naming a broker."
            ),
        },
    ),
    "floci": EmulatorAddresses(
        queue_urls_by_path=True,
        notes={
            "rds": Note(
                "In a container, Floci reports databases on Docker's network. To connect from this machine, set "
                "FLOCI_SERVICES_RDS_ENDPOINT_HOST (to localhost, say) and publish its RDS proxy ports "
                "(FLOCI_SERVICES_RDS_PROXY_BASE_PORT to FLOCI_SERVICES_RDS_PROXY_MAX_PORT, 7001-7099 by default).",
                when="elsewhere",
            ),
            "elasticache": Note(
                "Floci serves caches at FLOCI_HOSTNAME on its ElastiCache proxy ports "
                "(FLOCI_SERVICES_ELASTICACHE_PROXY_BASE_PORT to FLOCI_SERVICES_ELASTICACHE_PROXY_MAX_PORT, "
                "6379-6399 by default). In a container, publish those ports to connect from this machine.",
                when="own",
            ),
            "kafka": Note(
                "In a container, Floci reports brokers on Docker's network. With FLOCI_SERVICES_MSK_BOOTSTRAP_HOSTNAME "
                "set, it also lists a broker address on this machine.",
                when="elsewhere",
            ),
        },
    ),
    "localstack": EmulatorAddresses(gateway=("localhost.localstack.cloud", 4566)),
    "moto": EmulatorAddresses(notes={"rds": _MOTO_NOTE, "elasticache": _MOTO_NOTE, "es": _MOTO_NOTE, "kafka": _MOTO_NOTE}),
}


@dataclass(frozen=True)
class Place:
    """Where the resource was looked up: the endpoint (None for AWS), the emulator there, and the region."""

    endpoint_url: str | None
    emulator: dict | None
    region: str

    @property
    def rules(self) -> EmulatorAddresses:
        return ADDRESSES.get(self.emulator["id"], EmulatorAddresses()) if self.emulator else EmulatorAddresses()

    def note(self, service: str, connections: list[Connection]) -> str | None:
        note = self.rules.notes.get(service)
        hosts = [host_port.host for connection in connections for host_port in connection.hosts]
        return note.text if note is not None and note.applies(hosts) else None


@dataclass(frozen=True)
class Snippet:
    label: str
    text: str


@dataclass
class Connection:
    label: str
    # What to connect to: host:port, a broker list or a URL.
    address: str
    snippets: list[Snippet]
    # What the endpoint returned, when the address differs from it.
    returned: str | None
    # The hosts the endpoint returned, for notes about where they can be reached from.
    hosts: list[HostPort] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "label": self.label,
            "address": self.address,
            "returned": self.returned,
            "snippets": [{"label": snippet.label, "text": snippet.text} for snippet in self.snippets],
        }


@dataclass(frozen=True)
class HostPort:
    host: str
    port: int | None

    def __str__(self) -> str:
        host = f"[{self.host}]" if ":" in self.host else self.host
        return f"{host}:{self.port}" if self.port is not None else host


def parse_host_port(value: str, default_port: int | None = None) -> HostPort:
    """``host``, ``host:port`` or ``[v6]:port``, as endpoints return them."""
    if value.startswith("["):
        host, _, rest = value[1:].partition("]")
        port = rest[1:] if rest.startswith(":") else ""
    elif value.count(":") == 1:
        host, port = value.split(":")
    else:
        host, port = value, ""
    return HostPort(host, int(port) if port.isdigit() else default_port)


def reachable(address: HostPort, place: Place) -> HostPort:
    """The address to connect to from this machine, for one the endpoint returned."""
    if place.endpoint_url is None:
        return address
    endpoint = urlsplit(place.endpoint_url)
    host, port = address.host, address.port
    if host in WILDCARD_HOSTS and endpoint.hostname:
        host = endpoint.hostname
    gateway = place.rules.gateway
    if gateway is not None and _in_domain(host, gateway[0]) and port == gateway[1] and endpoint.port is not None:
        port = endpoint.port
    return HostPort(host, port)


def _is_own_address(host: str) -> bool:
    """Loopback or 0.0.0.0: an address on the machine the emulator runs on."""
    if host in WILDCARD_HOSTS or host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _in_domain(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def private_network_note(connections: list[Connection], place: Place) -> str | None:
    """A note when an emulator returned an address on a private network, such as Docker's."""
    if place.endpoint_url is None:
        return None
    for host in (host_port.host for connection in connections for host_port in connection.hosts):
        try:
            ip = ipaddress.ip_address(host)
        except ValueError:
            continue
        if ip.is_private and not ip.is_loopback and not ip.is_unspecified:
            return (
                f"{host} is an address on a private network, such as Docker's when the emulator runs in a "
                "container: it works from that network, which may not include this machine."
            )
    return None


def _host_port_connection(label: str, returned: HostPort, place: Place, snippets: Callable[[HostPort], list[Snippet]]) -> Connection:
    address = reachable(returned, place)
    return Connection(
        label=label,
        address=str(address),
        snippets=snippets(address),
        returned=str(returned) if address != returned else None,
        hosts=[returned],
    )


# --- command lines ------------------------------------------------------------------

# Values from the endpoint only go into a command when they look like what they
# should be: a host name or IP address, an identifier. Anything else (a space, a
# leading "-") could add an option or a connection keyword the address shown
# doesn't, so the command is left out and the address alone is shown.
_PLAIN_HOST = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?")
_PLAIN_NAME = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_$.-]{0,127}")


def _plain_host(host: str) -> bool:
    if _PLAIN_HOST.fullmatch(host):
        return True
    try:
        return ipaddress.ip_address(host).version == 6
    except ValueError:
        return False


def _plain_names(*names: str | None) -> bool:
    return all(name is None or _PLAIN_NAME.fullmatch(name) for name in names)


def _uri_host(address: HostPort) -> str:
    return str(address) if address.port is not None else address.host


# --- databases --------------------------------------------------------------------

_POSTGRES = ("postgres", "aurora-postgresql")
_MYSQL = ("mysql", "mariadb", "aurora-mysql", "aurora")


def database_snippets(engine: str, address: HostPort, user: str | None, database: str | None) -> list[Snippet]:
    """A client command and a connection string for the engine, with the password left as a placeholder.

    Connection strings percent-encode the names in them; commands are only
    offered for plain values (see ``_plain_host``).
    """
    if not _plain_host(address.host) or address.port is None:
        return []
    host, port = address.host, address.port
    user = user or "admin"
    plain = _plain_names(user, database)
    q = shlex.quote
    if engine in _POSTGRES:
        database = database or "postgres"
        uri = f"postgresql://{quote(user, safe='')}@{_uri_host(address)}/{quote(database, safe='')}"
        snippets = [Snippet("psql", f"psql {q(uri)}")] if plain else []
        return [*snippets, Snippet("Connection string", uri.replace("@", f":{PASSWORD}@", 1))]
    if engine in _MYSQL:
        uri = f"mysql://{quote(user, safe='')}:{PASSWORD}@{_uri_host(address)}/{quote(database or '', safe='')}"
        # TCP, or the client takes "localhost" to mean its local socket. Each value is attached to its option.
        command = f"mysql --protocol=TCP --host={q(host)} --port={port} --user={q(user)} --password" + (
            f" --database={q(database)}" if database else ""
        )
        return [*([Snippet("mysql", command)] if plain else []), Snippet("Connection string", uri)]
    if not plain:
        return []
    if engine.startswith("sqlserver"):
        return [
            Snippet("sqlcmd", f"sqlcmd -S {q(f'{host},{port}')} -U {q(user)}"),
            Snippet("Connection string", f"Server={host},{port};User Id={user};Password={PASSWORD}"),
        ]
    if engine.startswith("oracle"):
        service = database or "ORCL"
        return [Snippet("sqlplus", f"sqlplus {q(f'{user}@//{address}/{service}')}")]
    return []


def rds_instance(instance: dict, place: Place) -> tuple[list[Connection], str | None]:
    endpoint = instance.get("Endpoint") or {}
    if not endpoint.get("Address"):
        return [], _no_address_yet(instance.get("DBInstanceStatus"))
    returned = HostPort(endpoint["Address"], endpoint.get("Port"))

    def snippets(address: HostPort) -> list[Snippet]:
        return database_snippets(instance.get("Engine", ""), address, instance.get("MasterUsername"), instance.get("DBName"))

    return [_host_port_connection("Endpoint", returned, place, snippets)], None


def rds_cluster(cluster: dict, place: Place) -> tuple[list[Connection], str | None]:
    if not cluster.get("Endpoint"):
        return [], _no_address_yet(cluster.get("Status"))
    port = cluster.get("Port")

    def snippets(address: HostPort) -> list[Snippet]:
        return database_snippets(cluster.get("Engine", ""), address, cluster.get("MasterUsername"), cluster.get("DatabaseName"))

    # AWS returns bare host names; AWS Emulator gives the reader endpoint's own port with it.
    endpoints = [("Writer endpoint", cluster["Endpoint"]), ("Reader endpoint", cluster.get("ReaderEndpoint"))]
    return [
        _host_port_connection(label, parse_host_port(value, port), place, snippets)
        for label, value in endpoints
        if value
    ], None


# --- caches -----------------------------------------------------------------------


def cache_snippets(cluster: dict, address: HostPort, *, cluster_mode: bool) -> list[Snippet]:
    if not _plain_host(address.host) or address.port is None:
        return []
    q = shlex.quote
    if cluster.get("Engine") == "memcached":
        return [Snippet("telnet", f"telnet {q(address.host)} {address.port}")]
    tls = bool(cluster.get("TransitEncryptionEnabled"))
    auth = bool(cluster.get("AuthTokenEnabled"))
    command = f"redis-cli -h {q(address.host)} -p {address.port}"
    if cluster_mode:
        command += " -c"
    if tls:
        command += " --tls"
    if auth:
        command += f" -a {q(AUTH_TOKEN)}"
    scheme = "rediss" if tls else "redis"
    credentials = f":{AUTH_TOKEN}@" if auth else ""
    return [Snippet("redis-cli", command), Snippet("Connection string", f"{scheme}://{credentials}{address}")]


def cache_cluster(cluster: dict, place: Place) -> tuple[list[Connection], str | None]:
    configuration = cluster.get("ConfigurationEndpoint")
    # A Redis cluster with a configuration endpoint runs in cluster mode; Memcached's lists every node.
    cluster_mode = configuration is not None and cluster.get("Engine") != "memcached"
    targets = []
    if configuration and configuration.get("Address"):
        targets.append(("Configuration endpoint", configuration))
    else:
        targets += [
            (f"Node {node.get('CacheNodeId', '')}".strip(), node["Endpoint"])
            for node in cluster.get("CacheNodes") or []
            if (node.get("Endpoint") or {}).get("Address")
        ]
    if not targets:
        return [], _no_address_yet(cluster.get("CacheClusterStatus"))

    def snippets(address: HostPort) -> list[Snippet]:
        return cache_snippets(cluster, address, cluster_mode=cluster_mode)

    return [
        _host_port_connection(label, HostPort(endpoint["Address"], endpoint.get("Port")), place, snippets)
        for label, endpoint in targets
    ], None


# --- search domains -----------------------------------------------------------------


def search_domain(status: dict, place: Place, *, ca_bundle_variable: bool) -> tuple[list[Connection], str | None]:
    """An OpenSearch domain's endpoint as a URL.

    Endpoints come as ``host``, ``host:port/path`` (AWS Emulator serves domains
    under its own address) or a whole URL (Floci). ``ca_bundle_variable``: the
    shell setup shown with it exports AWS_CA_BUNDLE, which curl should trust.
    """
    value = status.get("Endpoint") or (status.get("Endpoints") or {}).get("vpc")
    if not value:
        return [], _no_address_yet("processing" if status.get("Processing") else None)
    try:
        parsed = urlsplit(value if "://" in value else f"//{value}")
        returned = HostPort(parsed.hostname or "", parsed.port)
    except ValueError:
        parsed = None
    if parsed is None or parsed.scheme not in ("", "http", "https") or not returned.host:
        return [], f"The endpoint returned {value} as the domain's address, which isn't an HTTP address."
    address = reachable(returned, place)
    scheme = parsed.scheme or _search_scheme(address, place)
    url = f"{scheme}://{address}{parsed.path.rstrip('/')}"
    cacert = '--cacert "$AWS_CA_BUNDLE" ' if ca_bundle_variable and scheme == "https" else ""
    connection = Connection(
        label="Domain endpoint",
        address=url,
        # The URL starts with its scheme, so curl can't take it for an option.
        snippets=[Snippet("curl", f"curl {cacert}{shlex.quote(url + '/_cluster/health')}")] if _plain_host(address.host) else [],
        returned=value if address != returned else None,
        hosts=[returned],
    )
    return [connection], None


def _search_scheme(address: HostPort, place: Place) -> str:
    """AWS serves domains over HTTPS; an emulator over its own scheme when the domain is on its address, else HTTP."""
    if place.endpoint_url is None:
        return "https"
    endpoint = urlsplit(place.endpoint_url)
    if address.host == endpoint.hostname and address.port == endpoint.port:
        return endpoint.scheme
    return "http"


# --- brokers --------------------------------------------------------------------------

_BROKER_STRINGS = {
    "BootstrapBrokerString": "Plaintext",
    "BootstrapBrokerStringTls": "TLS",
    "BootstrapBrokerStringSaslScram": "SASL/SCRAM",
    "BootstrapBrokerStringSaslIam": "IAM",
    "BootstrapBrokerStringPublicTls": "Public TLS",
    "BootstrapBrokerStringPublicSaslScram": "Public SASL/SCRAM",
    "BootstrapBrokerStringPublicSaslIam": "Public IAM",
}


def kafka_brokers(brokers: dict, place: Place) -> tuple[list[Connection], str | None]:
    """One connection per way the cluster lets clients in, from GetBootstrapBrokers."""
    connections = []
    for key, label in _BROKER_STRINGS.items():
        listed = brokers.get(key)
        if not listed:
            continue
        returned = [parse_host_port(broker.strip()) for broker in listed.split(",") if broker.strip()]
        reachable_brokers = [reachable(broker, place) for broker in returned]
        addresses = ",".join(str(broker) for broker in reachable_brokers)
        if not all(_plain_host(broker.host) and broker.port is not None for broker in reachable_brokers):
            snippets = []
        elif label == "Plaintext":
            snippets = [Snippet("kafka-topics", f"kafka-topics.sh --bootstrap-server {shlex.quote(addresses)} --list")]
        elif label == "TLS":
            snippets = [Snippet("kcat", f"kcat -b {shlex.quote(addresses)} -X security.protocol=ssl -L")]
        else:
            # SASL and IAM need credentials a command line can't show.
            snippets = []
        connections.append(Connection(
            label=f"Bootstrap brokers ({label})",
            address=addresses,
            snippets=snippets,
            returned=listed if addresses != listed else None,
            hosts=returned,
        ))
    if not connections:
        return [], "The endpoint returned no bootstrap brokers for this cluster."
    return connections, None


# --- queues -----------------------------------------------------------------------------


def queue(queue_url: str, place: Place) -> tuple[list[Connection], str | None]:
    """A queue URL that works from this machine, and an AWS CLI command that uses it."""
    url = _queue_url_from_here(queue_url, place)
    # Each value is attached to its option, so none can be taken for another.
    command = f"aws sqs receive-message --queue-url={shlex.quote(url)} --region={shlex.quote(place.region)}"
    if place.endpoint_url is not None:
        command += f" --endpoint-url={shlex.quote(place.endpoint_url)}"
    return [Connection(
        label="Queue URL",
        address=url,
        snippets=[Snippet("AWS CLI", command)],
        returned=queue_url if url != queue_url else None,
    )], None


def _queue_url_from_here(queue_url: str, place: Place) -> str:
    if place.endpoint_url is None:
        return queue_url
    parts = urlsplit(queue_url)
    base_url = endpoint_base_url(place.endpoint_url)
    if place.rules.queue_urls_by_path and base_url is not None and parts.netloc != urlsplit(place.endpoint_url).netloc:
        return f"{base_url}{parts.path}"
    address = reachable(HostPort(parts.hostname or "", parts.port), place)
    if address.port != parts.port:
        return parts._replace(netloc=str(address)).geturl()
    return queue_url


def _no_address_yet(status: str | None) -> str:
    state = f" (status: {status})" if status else ""
    return f"The endpoint hasn't given this resource an address yet{state}."
