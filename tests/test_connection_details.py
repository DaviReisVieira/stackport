"""Connection details: the address to connect to from this machine, and commands to copy.

The values each fake emulator returns are the ones it returned when tried
(see backend.connection_details for where each rule comes from). Route tests
go through moto, as AWS, and through botocore's Stubber, as an emulator, so
the responses are parsed and checked against the APIs' models.
"""

from __future__ import annotations

import shlex
from collections.abc import Iterator
from contextlib import contextmanager

import boto3
import pytest
from botocore.config import Config
from botocore.stub import Stubber
from fastapi.testclient import TestClient

from backend import connection_details as details
from backend.connection import EndpointInfo
from backend.connection_details import HostPort, Place
from backend.emulators import DETECTORS
from backend.main import app
from backend.routes import connection_details as route
from backend.routes.common import get_endpoint_info
from tests.moto_aws import aws, moto_account

client = TestClient(app)
NAMES = {detector.id: detector.name for detector in DETECTORS}


def at(endpoint_url: str | None, emulator_id: str | None = None) -> Place:
    emulator = {"id": emulator_id, "name": NAMES[emulator_id], "version": None} if emulator_id else None
    return Place(endpoint_url=endpoint_url, emulator=emulator, region="us-east-1")


AWS = at(None)


def snippet(connection: details.Connection, label: str) -> str:
    return next(s.text for s in connection.snippets if s.label == label)


class TestAddresses:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("db.local", HostPort("db.local", 5432)),
            ("127.0.0.1:9643", HostPort("127.0.0.1", 9643)),
            ("[::1]:6379", HostPort("::1", 6379)),
            ("::1", HostPort("::1", 5432)),
        ],
    )
    def test_parse(self, value, expected):
        assert details.parse_host_port(value, 5432) == expected

    def test_wildcard_is_the_endpoints_host(self):
        address = details.reachable(HostPort("0.0.0.0", 9640), at("https://127.0.0.1:9631", "aws-emulator"))

        assert address == HostPort("127.0.0.1", 9640)

    def test_localstack_gateway_port_is_the_endpoints(self):
        place = at("http://localhost:4633", "localstack")

        assert details.reachable(HostPort("sqs.us-east-1.localhost.localstack.cloud", 4566), place).port == 4633
        # Only its gateway: other ports on that name are its own services.
        assert details.reachable(HostPort("localhost.localstack.cloud", 4510), place).port == 4510
        assert details.reachable(HostPort("example.com", 4566), place).port == 4566

    def test_aws_addresses_stay_as_returned(self):
        assert details.reachable(HostPort("0.0.0.0", 5432), AWS) == HostPort("0.0.0.0", 5432)


class TestDatabases:
    def test_postgres(self):
        [connection], problem = details.rds_instance(
            {"Engine": "postgres", "Endpoint": {"Address": "0.0.0.0", "Port": 9640}, "MasterUsername": "app", "DBName": "appdb"},
            at("https://127.0.0.1:9631", "aws-emulator"),
        )

        assert problem is None
        assert (connection.address, connection.returned) == ("127.0.0.1:9640", "0.0.0.0:9640")
        assert snippet(connection, "psql") == "psql postgresql://app@127.0.0.1:9640/appdb"
        assert snippet(connection, "Connection string") == "postgresql://app:<password>@127.0.0.1:9640/appdb"

    @pytest.mark.parametrize(
        ("engine", "label", "text"),
        [
            ("mysql", "mysql", "mysql --protocol=TCP --host=localhost --port=4641 --user=app --password"),
            ("mariadb", "Connection string", "mysql://app:<password>@localhost:4641/"),
            ("sqlserver-ex", "sqlcmd", "sqlcmd -S localhost,4641 -U app"),
            ("sqlserver-ex", "Connection string", "Server=localhost,4641;User Id=app;Password=<password>"),
            ("oracle-ee", "sqlplus", "sqlplus app@//localhost:4641/ORCL"),
        ],
    )
    def test_other_engines(self, engine, label, text):
        [connection], _ = details.rds_instance(
            {"Engine": engine, "Endpoint": {"Address": "localhost", "Port": 4641}, "MasterUsername": "app"},
            at("http://localhost:4632", "floci"),
        )

        assert snippet(connection, label) == text

    def test_a_name_that_could_be_an_option_gets_no_command(self):
        # Once a password is typed, mysql would run --execute's command on this machine.
        [connection], _ = details.rds_instance(
            {"Engine": "mysql", "Endpoint": {"Address": "db.local", "Port": 3306}, "MasterUsername": "admin",
             "DBName": "--execute=system id"},
            AWS,
        )

        assert [s.label for s in connection.snippets] == ["Connection string"]
        assert snippet(connection, "Connection string") == "mysql://admin:<password>@db.local:3306/--execute%3Dsystem%20id"

    def test_a_name_that_could_add_connection_keywords_gets_no_command(self):
        # psql would read "host" and "port" as keywords and connect somewhere other than the address shown.
        [connection], _ = details.rds_instance(
            {"Engine": "postgres", "Endpoint": {"Address": "db.local", "Port": 5432}, "MasterUsername": "app",
             "DBName": "orders host=127.0.0.1 port=6000 sslmode=disable"},
            AWS,
        )

        assert [s.label for s in connection.snippets] == ["Connection string"]
        assert snippet(connection, "Connection string") == (
            "postgresql://app:<password>@db.local:5432/orders%20host%3D127.0.0.1%20port%3D6000%20sslmode%3Ddisable"
        )

    @pytest.mark.parametrize("host", ["-oProxyCommand=x", "db.local --tls", "db local", "db.local/x"])
    def test_a_host_that_isnt_a_host_name_gets_no_snippets(self, host):
        [connection], _ = details.rds_instance(
            {"Engine": "postgres", "Endpoint": {"Address": host, "Port": 5432}, "MasterUsername": "app"}, AWS
        )

        assert connection.snippets == []
        assert connection.address == f"{host}:5432"

    @pytest.mark.parametrize(
        ("engine", "argv"),
        [
            ("postgres", ["psql", "postgresql://app_user@db-1.local:5432/orders"]),
            ("mysql", ["mysql", "--protocol=TCP", "--host=db-1.local", "--port=5432", "--user=app_user", "--password",
                       "--database=orders"]),
            ("sqlserver-ex", ["sqlcmd", "-S", "db-1.local,5432", "-U", "app_user"]),
            ("oracle-ee", ["sqlplus", "app_user@//db-1.local:5432/orders"]),
        ],
    )
    def test_each_value_stays_in_its_place(self, engine, argv):
        [connection], _ = details.rds_instance(
            {"Engine": engine, "Endpoint": {"Address": "db-1.local", "Port": 5432}, "MasterUsername": "app_user", "DBName": "orders"},
            AWS,
        )

        [command] = [s.text for s in connection.snippets if s.label != "Connection string"]
        assert shlex.split(command) == argv

    def test_cluster_reader_endpoint_with_its_own_port(self):
        connections, _ = details.rds_cluster(
            {"Engine": "aurora-postgresql", "Endpoint": "0.0.0.0", "ReaderEndpoint": "0.0.0.0:9643", "Port": 9642,
             "MasterUsername": "app", "DatabaseName": "appdb"},
            at("https://127.0.0.1:9631", "aws-emulator"),
        )

        assert [(c.label, c.address) for c in connections] == [
            ("Writer endpoint", "127.0.0.1:9642"),
            ("Reader endpoint", "127.0.0.1:9643"),
        ]

    def test_no_address_yet(self):
        connections, problem = details.rds_instance({"Engine": "postgres", "DBInstanceStatus": "creating"}, AWS)

        assert connections == []
        assert problem == "The endpoint hasn't given this resource an address yet (status: creating)."


class TestCaches:
    def test_redis_with_tls_and_a_token(self):
        [connection], _ = details.cache_cluster(
            {"Engine": "redis", "TransitEncryptionEnabled": True, "AuthTokenEnabled": True,
             "CacheNodes": [{"CacheNodeId": "0001", "Endpoint": {"Address": "localhost", "Port": 4645}}]},
            at("http://localhost:4632", "floci"),
        )

        assert connection.label == "Node 0001"
        assert snippet(connection, "redis-cli") == "redis-cli -h localhost -p 4645 --tls -a '<auth-token>'"
        assert snippet(connection, "Connection string") == "rediss://:<auth-token>@localhost:4645"

    def test_a_configuration_endpoint_is_cluster_mode(self):
        [connection], _ = details.cache_cluster(
            {"Engine": "redis", "ConfigurationEndpoint": {"Address": "127.0.0.1", "Port": 9644},
             "CacheNodes": [{"CacheNodeId": "0001", "Endpoint": {"Address": "127.0.0.1", "Port": 9644}}]},
            at("https://127.0.0.1:9631", "aws-emulator"),
        )

        assert connection.label == "Configuration endpoint"
        assert snippet(connection, "redis-cli") == "redis-cli -h 127.0.0.1 -p 9644 -c"

    def test_memcached(self):
        [connection], _ = details.cache_cluster(
            {"Engine": "memcached", "ConfigurationEndpoint": {"Address": "c.cfg.use1.cache.amazonaws.com", "Port": 11211}}, AWS
        )

        assert snippet(connection, "telnet") == "telnet c.cfg.use1.cache.amazonaws.com 11211"

    def test_no_endpoint(self):
        assert details.cache_cluster({"Engine": "redis", "CacheClusterStatus": "creating"}, AWS)[1] == (
            "The endpoint hasn't given this resource an address yet (status: creating)."
        )


class TestSearchDomains:
    def test_aws_serves_https(self):
        [connection], _ = details.search_domain(
            {"Endpoint": "search-logs-abc.us-east-1.es.amazonaws.com"}, AWS, ca_bundle_variable=False
        )

        assert connection.address == "https://search-logs-abc.us-east-1.es.amazonaws.com"
        assert snippet(connection, "curl") == "curl https://search-logs-abc.us-east-1.es.amazonaws.com/_cluster/health"

    def test_a_domain_on_the_endpoints_own_address(self):
        [connection], _ = details.search_domain(
            {"Endpoint": "127.0.0.1:9631/_aws/es/logs"}, at("https://127.0.0.1:9631", "aws-emulator"), ca_bundle_variable=True
        )

        assert connection.address == "https://127.0.0.1:9631/_aws/es/logs"
        assert snippet(connection, "curl") == 'curl --cacert "$AWS_CA_BUNDLE" https://127.0.0.1:9631/_aws/es/logs/_cluster/health'

    def test_an_endpoint_given_as_a_url(self):
        [connection], _ = details.search_domain(
            {"Endpoint": "http://172.17.0.21:9200"}, at("http://localhost:4632", "floci"), ca_bundle_variable=False
        )

        assert connection.address == "http://172.17.0.21:9200"

    def test_localstack_gateway(self):
        [connection], _ = details.search_domain(
            {"Endpoint": "logs.us-east-1.opensearch.localhost.localstack.cloud:4566"},
            at("http://localhost:4633", "localstack"),
            ca_bundle_variable=False,
        )

        assert connection.address == "http://logs.us-east-1.opensearch.localhost.localstack.cloud:4633"
        assert connection.returned == "logs.us-east-1.opensearch.localhost.localstack.cloud:4566"

    def test_still_processing(self):
        assert details.search_domain({"Processing": True}, AWS, ca_bundle_variable=False)[1].endswith("(status: processing).")


class TestBrokers:
    def test_one_connection_per_way_in(self):
        connections, _ = details.kafka_brokers(
            {
                "BootstrapBrokerString": "b-1.k.kafka.us-east-1.amazonaws.com:9092,b-2.k.kafka.us-east-1.amazonaws.com:9092",
                "BootstrapBrokerStringTls": "b-1.k.kafka.us-east-1.amazonaws.com:9094",
                "BootstrapBrokerStringSaslIam": "b-1.k.kafka.us-east-1.amazonaws.com:9098",
            },
            AWS,
        )

        assert [c.label for c in connections] == [
            "Bootstrap brokers (Plaintext)",
            "Bootstrap brokers (TLS)",
            "Bootstrap brokers (IAM)",
        ]
        assert snippet(connections[0], "kafka-topics") == (
            "kafka-topics.sh --bootstrap-server "
            "b-1.k.kafka.us-east-1.amazonaws.com:9092,b-2.k.kafka.us-east-1.amazonaws.com:9092 --list"
        )
        assert snippet(connections[1], "kcat") == "kcat -b b-1.k.kafka.us-east-1.amazonaws.com:9094 -X security.protocol=ssl -L"
        assert connections[2].snippets == []

    def test_none(self):
        assert details.kafka_brokers({}, AWS) == ([], "The endpoint returned no bootstrap brokers for this cluster.")


class TestQueues:
    @pytest.mark.parametrize(
        ("emulator_id", "endpoint", "returned", "url"),
        [
            # AWS Emulator and Floci find the queue by its path on any of their addresses.
            ("aws-emulator", "https://127.0.0.1:9631", "https://sqs.us-east-1.amazonaws.com/000000000000/jobs",
             "https://127.0.0.1:9631/000000000000/jobs"),
            # MiniStack returns it on the address it was reached at.
            ("ministack", "http://127.0.0.1:4631", "http://127.0.0.1:4631/000000000000/jobs",
             "http://127.0.0.1:4631/000000000000/jobs"),
            ("floci", "http://127.0.0.1:4632", "http://localhost:4566/000000000000/jobs",
             "http://127.0.0.1:4632/000000000000/jobs"),
            ("localstack", "http://127.0.0.1:4633", "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/jobs",
             "http://sqs.us-east-1.localhost.localstack.cloud:4633/000000000000/jobs"),
        ],
    )
    def test_a_url_that_works_from_this_machine(self, emulator_id, endpoint, returned, url):
        [connection], _ = details.queue(returned, at(endpoint, emulator_id))

        assert connection.address == url
        assert connection.returned == (returned if url != returned else None)
        assert snippet(connection, "AWS CLI") == (
            f"aws sqs receive-message --queue-url={url} --region=us-east-1 --endpoint-url={endpoint}"
        )

    def test_aws(self):
        [connection], _ = details.queue("https://sqs.us-east-1.amazonaws.com/123456789012/jobs", AWS)

        assert snippet(connection, "AWS CLI") == (
            "aws sqs receive-message --queue-url=https://sqs.us-east-1.amazonaws.com/123456789012/jobs --region=us-east-1"
        )


class TestNotes:
    def _note(self, service: str, place: Place, *hosts: str) -> str | None:
        connections = [details.Connection("x", "x", [], None, hosts=[HostPort(host, 1) for host in hosts])]
        return place.note(service, connections)

    def test_aws_emulator_only_for_what_it_serves_itself(self):
        place = at("https://127.0.0.1:9631", "aws-emulator")

        assert self._note("rds", place, "0.0.0.0").startswith("AWS Emulator serves this on a port of its own.")
        assert self._note("elasticache", place, "c.cfg.us-east-1.cache.amazonaws.com") is None

    def test_floci_when_it_reports_docker_addresses(self):
        place = at("http://127.0.0.1:4632", "floci")

        assert self._note("rds", place, "172.17.0.19").startswith("In a container, Floci reports databases")
        assert self._note("rds", place, "localhost") is None
        assert self._note("kafka", place, "floci-aws-msk-1", "localhost").startswith("In a container, Floci reports brokers")

    def test_moto(self):
        assert self._note("rds", at("http://127.0.0.1:5000", "moto"), "db.aaaaaaaaaa.us-east-1.rds.amazonaws.com") == (
            "Moto keeps this resource's settings but doesn't run it, so nothing answers at this address."
        )

    def test_private_network(self):
        connections = [details.Connection("x", "x", [], None, hosts=[HostPort("172.17.0.19", 7001)])]

        note = details.private_network_note(connections, at("http://127.0.0.1:4632", "floci"))

        assert note.startswith("172.17.0.19 is an address on a private network")
        assert details.private_network_note(connections, AWS) is None
        wildcard = [details.Connection("x", "x", [], None, hosts=[HostPort("0.0.0.0", 1)])]
        assert details.private_network_note(wildcard, at("http://127.0.0.1:4632", "floci")) is None


# --- the route --------------------------------------------------------------------


class TestOptionInjection:
    """Values the endpoint returns can't become options of the commands built from them."""

    @pytest.mark.parametrize("engine", ["memcached", "redis"])
    def test_cache_host(self, engine):
        [connection], _ = details.cache_cluster(
            {"Engine": engine, "CacheNodes": [{"CacheNodeId": "1", "Endpoint": {"Address": "-x evil", "Port": 6379}}]}, AWS
        )

        assert connection.snippets == []

    def test_broker_hosts(self):
        [connection], _ = details.kafka_brokers({"BootstrapBrokerString": "--command-config=/tmp/x:9092"}, AWS)

        assert connection.snippets == []

    def test_search_domain_address_has_to_be_http(self):
        connections, problem = details.search_domain({"Endpoint": "file:///etc/passwd"}, AWS, ca_bundle_variable=False)

        assert connections == []
        assert problem == "The endpoint returned file:///etc/passwd as the domain's address, which isn't an HTTP address."

    def test_queue_url_stays_the_value_of_its_option(self):
        [connection], _ = details.queue("--debug", AWS)

        assert shlex.split(snippet(connection, "AWS CLI")) == [
            "aws", "sqs", "receive-message", "--queue-url=--debug", "--region=us-east-1",
        ]


class TestRouteOnAws:
    """moto answers as AWS: addresses stay as AWS returned them, with no emulator notes."""

    def test_rds_instance(self):
        with moto_account():
            aws("rds").create_db_instance(
                DBInstanceIdentifier="orders", Engine="postgres", DBInstanceClass="db.t3.micro",
                MasterUsername="app", MasterUserPassword="Secret-123", AllocatedStorage=20, DBName="orders",
            )
            resp = client.get("/api/connection-details/rds/db_instances/orders")

        body = resp.json()
        assert resp.status_code == 200, resp.text
        [connection] = body["connections"]
        assert connection["address"] == "orders.aaaaaaaaaa.us-east-1.rds.amazonaws.com:5432"
        assert connection["returned"] is None
        assert {"label": "Connection string", "text": "postgresql://app:<password>@orders.aaaaaaaaaa.us-east-1.rds.amazonaws.com:5432/orders"} in connection["snippets"]
        assert body["notes"] == []
        assert body["cliSetup"] is None

    def test_cluster_with_its_reader(self):
        with moto_account():
            aws("rds").create_db_cluster(
                DBClusterIdentifier="main", Engine="aurora-mysql", MasterUsername="app", MasterUserPassword="Secret-123"
            )
            body = client.get("/api/connection-details/rds/db_clusters/main").json()

        assert [c["label"] for c in body["connections"]] == ["Writer endpoint", "Reader endpoint"]
        assert body["connections"][1]["address"].startswith("main.cluster-ro-")

    def test_queue(self):
        with moto_account():
            aws("sqs").create_queue(QueueName="jobs")
            body = client.get("/api/connection-details/sqs/queues/jobs").json()

        [connection] = body["connections"]
        assert connection["address"].endswith("/jobs")
        assert "--endpoint-url" not in connection["snippets"][0]["text"]

    def test_a_cache_without_endpoints(self):
        with moto_account():
            aws("elasticache").create_cache_cluster(CacheClusterId="cache", Engine="redis", CacheNodeType="cache.t3.micro", NumCacheNodes=1)
            body = client.get("/api/connection-details/elasticache/cache_clusters/cache").json()

        assert body["connections"] == []
        assert body["problem"].startswith("The endpoint hasn't given this resource an address yet")

    def test_a_missing_resource_is_the_endpoints_404(self):
        with moto_account():
            resp = client.get("/api/connection-details/rds/db_instances/nope")

        assert resp.status_code == 404

    def test_unsupported_types(self):
        assert client.get("/api/connection-details/s3/buckets/b").status_code == 404


@contextmanager
def emulator(emulator_id: str, service: str, *, saved: bool = True, endpoint_url: str = "http://127.0.0.1:4632") -> Iterator[Stubber]:
    """The route against an endpoint identified as ``emulator_id``, with ``service``'s answers stubbed."""
    stubbed = boto3.client(
        service, region_name="us-east-1", endpoint_url=endpoint_url,
        aws_access_key_id="test", aws_secret_access_key="test", config=Config(ignore_configured_endpoint_urls=True),
    )
    identified = {"id": emulator_id, "name": NAMES[emulator_id], "version": None}
    info = EndpointInfo(url=endpoint_url, region="us-east-1", saved=saved)
    app.dependency_overrides[get_endpoint_info] = lambda: info
    with pytest.MonkeyPatch.context() as patch, Stubber(stubbed) as stubber:
        patch.setattr(route, "get_client", lambda name, **_kwargs: stubbed if name == service else pytest.fail(name))
        patch.setattr(route, "detect_emulator", lambda ep: identified if ep.saved else pytest.fail("identified an unsaved endpoint"))
        patch.setattr(route, "cli_setup_for", lambda ep: {"emulator": NAMES[emulator_id], "script": "export X=1", "note": None})
        try:
            yield stubber
        finally:
            app.dependency_overrides.pop(get_endpoint_info, None)
        stubber.assert_no_pending_responses()


class TestRouteOnEmulators:
    def test_floci_database_on_dockers_network(self):
        with emulator("floci", "rds") as stubber:
            stubber.add_response(
                "describe_db_instances",
                {"DBInstances": [{"DBInstanceIdentifier": "orders", "Engine": "postgres", "MasterUsername": "app",
                                  "Endpoint": {"Address": "172.17.0.19", "Port": 7001}}]},
                {"DBInstanceIdentifier": "orders"},
            )
            body = client.get("/api/connection-details/rds/db_instances/orders").json()

        assert body["connections"][0]["address"] == "172.17.0.19:7001"
        assert [note[:40] for note in body["notes"]] == [
            "In a container, Floci reports databases ",
            "172.17.0.19 is an address on a private n",
        ]
        assert body["cliSetup"] is None

    def test_aws_emulator_queue_with_its_cli_setup(self):
        with emulator("aws-emulator", "sqs", endpoint_url="https://127.0.0.1:9631") as stubber:
            stubber.add_response(
                "get_queue_url", {"QueueUrl": "https://sqs.us-east-1.amazonaws.com/000000000000/jobs"}, {"QueueName": "jobs"}
            )
            body = client.get("/api/connection-details/sqs/queues/jobs").json()

        assert body["connections"][0]["address"] == "https://127.0.0.1:9631/000000000000/jobs"
        assert body["cliSetup"]["emulator"] == "AWS Emulator"

    def test_cache_nodes_are_asked_for(self):
        with emulator("aws-emulator", "elasticache", endpoint_url="https://127.0.0.1:9631") as stubber:
            stubber.add_response(
                "describe_cache_clusters",
                {"CacheClusters": [{"CacheClusterId": "c", "Engine": "redis",
                                    "CacheNodes": [{"CacheNodeId": "0001", "Endpoint": {"Address": "127.0.0.1", "Port": 9644}}]}]},
                {"CacheClusterId": "c", "ShowCacheNodeInfo": True},
            )
            body = client.get("/api/connection-details/elasticache/cache_clusters/c").json()

        assert body["connections"][0]["address"] == "127.0.0.1:9644"
        assert body["notes"][0].startswith("AWS Emulator serves this on a port of its own.")

    def test_search_domain_curl_trusts_the_emulators_ca(self):
        with emulator("aws-emulator", "opensearch", endpoint_url="https://127.0.0.1:9631") as stubber:
            stubber.add_response(
                "describe_domain",
                {"DomainStatus": {"DomainId": "000000000000/logs", "DomainName": "logs", "ARN": "arn:aws:es:us-east-1:000000000000:domain/logs",
                                  "ClusterConfig": {}, "Endpoint": "127.0.0.1:9631/_aws/es/logs"}},
                {"DomainName": "logs"},
            )
            body = client.get("/api/connection-details/es/domains/logs").json()

        assert body["connections"][0]["snippets"][0]["text"].startswith('curl --cacert "$AWS_CA_BUNDLE" https://127.0.0.1:9631/')

    def test_kafka_by_cluster_arn(self):
        arn = "arn:aws:kafka:us-east-1:000000000000:cluster/k/1"
        with emulator("ministack", "kafka", endpoint_url="http://127.0.0.1:4631") as stubber:
            stubber.add_response(
                "get_bootstrap_brokers", {"BootstrapBrokerString": "b-1.k.ministack.local:9092"}, {"ClusterArn": arn}
            )
            body = client.get(f"/api/connection-details/kafka/clusters/{arn}").json()

        assert body["connections"][0]["address"] == "b-1.k.ministack.local:9092"
        assert body["notes"] == [
            "MiniStack doesn't run Kafka brokers: this address is a placeholder unless MiniStack was started "
            "with MINISTACK_MSK_BOOTSTRAP naming a broker."
        ]

    def test_an_unsaved_endpoint_is_not_identified(self):
        with emulator("floci", "sqs", saved=False) as stubber:
            stubber.add_response("get_queue_url", {"QueueUrl": "http://localhost:4566/000000000000/jobs"}, {"QueueName": "jobs"})
            body = client.get("/api/connection-details/sqs/queues/jobs").json()

        # Without knowing it's Floci, the URL stays as returned.
        assert body["connections"][0]["address"] == "http://localhost:4566/000000000000/jobs"
