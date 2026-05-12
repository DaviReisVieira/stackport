#!/usr/bin/env python3
"""
Populate AWS-compatible services with realistic test data.
Generates random amounts of resources for all 35 supported services with cool and funny names.

Usage:
    python scripts/populate_test_data.py [--services s3,dynamodb,...]

Default: All services
"""

import boto3
import os
import argparse
from decimal import Decimal
from datetime import datetime, timedelta
import random
import string
import json


# Configuration
AWS_ENDPOINT_URL = os.getenv("AWS_ENDPOINT_URL", "http://localhost:4566")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID", "test")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "test")

# Cool and funny name components
ADJECTIVES = [
    "swift",
    "silent",
    "rapid",
    "stellar",
    "quantum",
    "cosmic",
    "electric",
    "dynamic",
    "sonic",
    "crystal",
    "golden",
    "silver",
    "blazing",
    "frosty",
    "mighty",
    "clever",
    "bright",
    "sharp",
    "smooth",
    "robust",
    "agile",
    "zany",
    "wacky",
    "quirky",
    "funky",
    "groovy",
    "spicy",
    "salty",
    "saucy",
    "cheeky",
    "snarky",
    "chubby",
    "sleepy",
    "grumpy",
    "bashful",
    "dopey",
]

NOUNS = [
    "falcon",
    "phoenix",
    "dragon",
    "tiger",
    "eagle",
    "storm",
    "thunder",
    "lightning",
    "rocket",
    "comet",
    "nebula",
    "pulsar",
    "quasar",
    "nova",
    "vortex",
    "forge",
    "prism",
    "vault",
    "beacon",
    "atlas",
    "matrix",
    "pancake",
    "waffle",
    "yak",
    "llama",
    "sloth",
    "narwhal",
    "penguin",
    "unicorn",
    "dragon",
    "kraken",
    "sasquatch",
    "dodo",
    "platypus",
    "capybara",
]

FUNNY_VERBS = [
    "bounces",
    "wobbles",
    "zooms",
    "crashes",
    "explodes",
    "implodes",
    "giggles",
    "snores",
    "hiccups",
    "yodels",
    "jiggles",
    "waddles",
]

ENVIRONMENTS = ["prod", "staging", "dev", "test", "qa", "preprod", "chaos", "pizza"]


def get_client(service):
    """Create and return a boto3 client for the given service."""
    return boto3.client(
        service,
        endpoint_url=AWS_ENDPOINT_URL,
        region_name=AWS_REGION,
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    )


def get_resource(service):
    """Create and return a boto3 resource for the given service."""
    return boto3.resource(
        service,
        endpoint_url=AWS_ENDPOINT_URL,
        region_name=AWS_REGION,
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    )


def cool_name(resource_type="", include_env=False, funny=False):
    """Generate a cool or funny resource name."""
    if funny and random.random() > 0.5:
        adj = random.choice(ADJECTIVES)
        verb = random.choice(FUNNY_VERBS)
        name = f"{adj}-{verb}"
    else:
        adj = random.choice(ADJECTIVES)
        noun = random.choice(NOUNS)
        name = f"{adj}-{noun}"

    if include_env:
        env = random.choice(ENVIRONMENTS)
        name = f"{name}-{env}"

    if resource_type:
        name = f"{resource_type}-{name}"

    return name


def cool_bucket_name():
    """Generate realistic S3 bucket names."""
    templates = [
        f"{random.choice(NOUNS)}-{random.choice(['data', 'assets', 'logs', 'backup', 'archive'])}",
        f"{random.choice(ADJECTIVES)}-{random.choice(['storage', 'vault', 'archive', 'bucket'])}",
        f"data-{random.choice(['prod', 'staging', 'analytics', 'ml', 'backups'])}",
        f"{random.choice(['acme', 'dataflow', 'analytics', 'platform', 'infra', 'chaos'])}-{random.choice(['prod', 'dev', 'test', 'yolo'])}",
    ]
    return random.choice(templates).replace("_", "-").lower()


def populate_s3():
    """Populate S3 with test buckets and files."""
    print("\n=== S3 ===")
    client = get_client("s3")

    bucket_count = random.randint(3, 8)
    files_per_bucket = random.randint(2, 6)

    try:
        for i in range(bucket_count):
            bucket_name = cool_bucket_name()
            try:
                # Clean up existing
                try:
                    objects = client.list_objects_v2(Bucket=bucket_name)
                    if "Contents" in objects:
                        for obj in objects["Contents"]:
                            client.delete_object(Bucket=bucket_name, Key=obj["Key"])
                    client.delete_bucket(Bucket=bucket_name)
                except Exception:
                    pass

                # Create bucket
                client.create_bucket(Bucket=bucket_name)

                # Add files with cool names
                file_types = ["logs", "data", "config", "backups", "exports"]
                for j in range(files_per_bucket):
                    file_type = random.choice(file_types)
                    name = cool_name("file", funny=True).replace("-", "_")
                    ext = random.choice(["csv", "json", "log", "parquet", "txt", "gz"])
                    key = f"{file_type}/{name}.{ext}"
                    content = f"Sample {file_type} from {bucket_name}"
                    client.put_object(
                        Bucket=bucket_name, Key=key, Body=content.encode()
                    )

                print(f"  ✓ {bucket_name} ({files_per_bucket} objects)")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {bucket_count} S3 buckets")
    except Exception as e:
        print(f"S3 error: {e}")


def populate_dynamodb():
    """Populate DynamoDB with test tables."""
    print("\n=== DynamoDB ===")
    client = get_client("dynamodb")
    resource = get_resource("dynamodb")

    table_count = random.randint(2, 5)
    items_per_table = random.randint(5, 15)

    try:
        for i in range(table_count):
            table_name = cool_name("table", funny=True)
            try:
                # Clean up existing
                try:
                    client.delete_table(TableName=table_name)
                    waiter = client.get_waiter("table_not_exists")
                    waiter.wait(TableName=table_name)
                except Exception:
                    pass

                # Create table
                client.create_table(
                    TableName=table_name,
                    KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
                    AttributeDefinitions=[
                        {"AttributeName": "id", "AttributeType": "S"}
                    ],
                    BillingMode="PAY_PER_REQUEST",
                )

                waiter = client.get_waiter("table_exists")
                waiter.wait(TableName=table_name)

                # Add items with cool names
                table = resource.Table(table_name)
                with table.batch_writer() as batch:
                    for j in range(items_per_table):
                        batch.put_item(
                            Item={
                                "id": cool_name("item", funny=True),
                                "name": f"{cool_name(funny=True).replace('-', ' ').title()}",
                                "status": random.choice(
                                    [
                                        "active",
                                        "inactive",
                                        "pending",
                                        "archived",
                                        "deleted",
                                    ]
                                ),
                                "created_at": (
                                    datetime.now()
                                    - timedelta(days=random.randint(0, 90))
                                ).isoformat(),
                                "tags": [
                                    random.choice(
                                        [
                                            "production",
                                            "staging",
                                            "testing",
                                            "experimental",
                                            "chaos",
                                        ]
                                    )
                                ],
                            }
                        )

                print(f"  ✓ {table_name} ({items_per_table} items)")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {table_count} DynamoDB tables")
    except Exception as e:
        print(f"DynamoDB error: {e}")


def _lambda_code(runtime: str) -> bytes:
    """Return a minimal working handler for the given runtime."""
    if runtime.startswith("python"):
        return b'import json\ndef handler(event, context):\n    return {"statusCode": 200, "body": json.dumps({"message": "Hello from " + context.function_name, "event": event})}\n'
    if runtime.startswith("nodejs"):
        return b'exports.handler = async (event) => ({ statusCode: 200, body: JSON.stringify({ message: "Hello from Node", event }) });'
    if runtime.startswith("ruby"):
        return b'def handler(event:, context:)\n  { statusCode: 200, body: JSON.generate({ message: "Hello from Ruby" }) }\nend'
    # go / java / dotnet / provided — just use a placeholder
    return b'def handler(event, context): return {"statusCode": 200}'


def populate_lambda():
    """Populate Lambda with test functions exercising all browser features.

    Creates functions with varied runtimes, env vars, tags, layers, VPC config,
    published versions, aliases, and event source mappings.
    """
    print("\n=== Lambda ===")
    client = get_client("lambda")
    sqs_client = get_client("sqs")

    runtimes = [
        ("python3.11", "handler.handler"),
        ("python3.12", "app.main"),
        ("nodejs18.x", "index.handler"),
        ("nodejs20.x", "src/handler.handler"),
        ("java21", "com.example.Handler::handleRequest"),
        ("ruby3.3", "handler.handler"),
        ("dotnet8", "MyFunction::MyFunction.Function::FunctionHandler"),
        ("provided.al2023", "bootstrap"),
    ]

    descriptions = [
        "Processes incoming API Gateway requests",
        "Handles S3 upload events and generates thumbnails",
        "Consumes SQS messages for order processing",
        "Runs scheduled CloudWatch event cleanup",
        "Streams DynamoDB changes to analytics pipeline",
        "Validates and transforms incoming webhook payloads",
        "Aggregates metrics and pushes to monitoring",
        "Sends notification emails via SES",
        "Replicates data across regions for disaster recovery",
        "Performs nightly ETL from RDS to S3",
    ]

    memory_options = [128, 256, 512, 1024, 2048, 3008]
    timeout_options = [3, 10, 30, 60, 120, 300, 900]

    func_count = random.randint(5, 12)
    created_functions = []

    try:
        for i in range(func_count):
            func_name = cool_name("fn", include_env=True, funny=True)
            runtime, handler = random.choice(runtimes)

            try:
                # --- Environment variables (most functions get some) ---
                env_vars = {}
                if random.random() > 0.2:
                    env_vars["LOG_LEVEL"] = random.choice(
                        ["DEBUG", "INFO", "WARN", "ERROR"]
                    )
                    env_vars["STAGE"] = random.choice(ENVIRONMENTS)
                    if random.random() > 0.5:
                        env_vars["TABLE_NAME"] = cool_name("table", funny=True)
                    if random.random() > 0.5:
                        env_vars["QUEUE_URL"] = (
                            f"https://sqs.{AWS_REGION}.amazonaws.com/000000000000/{cool_name('queue')}"
                        )
                    if random.random() > 0.6:
                        env_vars["BUCKET_NAME"] = cool_name("bucket")
                        env_vars["API_KEY"] = "sk-" + "".join(
                            random.choices(string.ascii_letters + string.digits, k=32)
                        )

                # --- Tags (most functions get some) ---
                tags = {}
                if random.random() > 0.15:
                    tags["team"] = random.choice(
                        [
                            "platform",
                            "payments",
                            "growth",
                            "infra",
                            "data",
                            "chaos-engineering",
                        ]
                    )
                    tags["env"] = random.choice(ENVIRONMENTS)
                    if random.random() > 0.4:
                        tags["cost-center"] = f"CC-{random.randint(1000, 9999)}"
                    if random.random() > 0.5:
                        tags["owner"] = (
                            f"{random.choice(ADJECTIVES)}-{random.choice(NOUNS)}@example.com"
                        )
                    if random.random() > 0.6:
                        tags["pagerduty"] = random.choice(
                            ["critical", "high", "low", "none"]
                        )

                create_kwargs = dict(
                    FunctionName=func_name,
                    Runtime=runtime,
                    Role=f"arn:aws:iam::000000000000:role/{cool_name('role')}",
                    Handler=handler,
                    Code={"ZipFile": _lambda_code(runtime)},
                    Description=random.choice(descriptions),
                    MemorySize=random.choice(memory_options),
                    Timeout=random.choice(timeout_options),
                    Tags=tags,
                )

                if env_vars:
                    create_kwargs["Environment"] = {"Variables": env_vars}

                client.create_function(**create_kwargs)
                created_functions.append(func_name)
                print(
                    f"  ✓ {func_name} ({runtime}, {create_kwargs['MemorySize']}MB, {create_kwargs['Timeout']}s)"
                )

                # --- Publish versions (first 3 always, rest ~60% chance) ---
                if i < 3 or random.random() > 0.4:
                    version_count = random.randint(1, 3)
                    published_versions = []
                    for v in range(version_count):
                        try:
                            ver = client.publish_version(
                                FunctionName=func_name,
                                Description=f"Release v{v + 1}.0 — {cool_name(funny=True)}",
                            )
                            published_versions.append(ver["Version"])
                        except Exception:
                            pass

                    # --- Create aliases pointing to versions ---
                    if published_versions:
                        alias_names = ["live", "canary", "beta", "staging", "rollback"]
                        alias_count = min(random.randint(1, 2), len(published_versions))
                        for a in range(alias_count):
                            try:
                                client.create_alias(
                                    FunctionName=func_name,
                                    Name=alias_names[a],
                                    FunctionVersion=random.choice(published_versions),
                                    Description=f"Alias '{alias_names[a]}' for {func_name}",
                                )
                            except Exception:
                                pass

                    if published_versions:
                        print(
                            f"        ↳ {len(published_versions)} version(s), alias(es)"
                        )

                # --- Event source mappings (first 3 always, rest ~35% chance) ---
                if i < 3 or random.random() > 0.65:
                    trigger_queue = cool_name("trigger-queue", funny=True)
                    try:
                        q = sqs_client.create_queue(QueueName=trigger_queue)
                        queue_url = q["QueueUrl"]
                        queue_attrs = sqs_client.get_queue_attributes(
                            QueueUrl=queue_url, AttributeNames=["QueueArn"]
                        )
                        queue_arn = queue_attrs["Attributes"]["QueueArn"]

                        client.create_event_source_mapping(
                            EventSourceArn=queue_arn,
                            FunctionName=func_name,
                            BatchSize=random.choice([1, 5, 10]),
                            Enabled=random.choice([True, False]),
                        )
                        print(f"        ↳ SQS trigger: {trigger_queue}")
                    except Exception:
                        pass

            except Exception as e:
                print(f"  ✗ Error creating {func_name}: {e}")

        print(f"Created {len(created_functions)} Lambda functions")
    except Exception as e:
        print(f"Lambda error: {e}")


def populate_sqs():
    """Populate SQS with test queues."""
    print("\n=== SQS ===")
    client = get_client("sqs")

    queue_count = random.randint(2, 6)
    messages_per_queue = random.randint(1, 4)

    try:
        for i in range(queue_count):
            queue_name = cool_name("queue", funny=True)
            try:
                response = client.create_queue(QueueName=queue_name)
                queue_url = response["QueueUrl"]

                for j in range(messages_per_queue):
                    client.send_message(
                        QueueUrl=queue_url,
                        MessageBody=f"Event: {cool_name('event', funny=True).replace('-', ' ').title()}",
                    )

                print(f"  ✓ {queue_name} ({messages_per_queue} messages)")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {queue_count} SQS queues")
    except Exception as e:
        print(f"SQS error: {e}")


def populate_sns():
    """Populate SNS with test topics."""
    print("\n=== SNS ===")
    client = get_client("sns")

    topic_count = random.randint(2, 5)
    subscriptions_per_topic = random.randint(1, 3)

    try:
        for i in range(topic_count):
            topic_name = cool_name("topic", funny=True)
            try:
                response = client.create_topic(Name=topic_name)
                topic_arn = response["TopicArn"]

                for j in range(subscriptions_per_topic):
                    client.subscribe(
                        TopicArn=topic_arn,
                        Protocol="email",
                        Endpoint=f"notify-{cool_name().replace('-', '')}@example.com",
                    )

                print(f"  ✓ {topic_name} ({subscriptions_per_topic} subscriptions)")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {topic_count} SNS topics")
    except Exception as e:
        print(f"SNS error: {e}")


def populate_ec2():
    """Populate EC2 with test security groups."""
    print("\n=== EC2 ===")
    client = get_client("ec2")

    sg_count = random.randint(2, 5)

    try:
        for i in range(sg_count):
            sg_name = cool_name("sg", funny=True)
            try:
                response = client.create_security_group(
                    GroupName=sg_name, Description=f"Security group: {sg_name}"
                )
                print(f"  ✓ {sg_name} ({response['GroupId']})")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {sg_count} EC2 security groups")
    except Exception as e:
        print(f"EC2 error: {e}")


def populate_iam():
    """Populate IAM with test roles and policies."""
    print("\n=== IAM ===")
    client = get_client("iam")

    role_count = random.randint(2, 5)

    try:
        for i in range(role_count):
            role_name = cool_name("role", funny=True)
            try:
                trust_policy = {
                    "Version": "2012-10-17",
                    "Statement": [
                        {
                            "Effect": "Allow",
                            "Principal": {"Service": "lambda.amazonaws.com"},
                            "Action": "sts:AssumeRole",
                        }
                    ],
                }
                client.create_role(
                    RoleName=role_name,
                    AssumeRolePolicyDocument=json.dumps(trust_policy),
                    Description=f"Role: {role_name}",
                )
                print(f"  ✓ {role_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {role_count} IAM roles")
    except Exception as e:
        print(f"IAM error: {e}")


def populate_rds():
    """Populate RDS with test DB instances."""
    print("\n=== RDS ===")
    client = get_client("rds")

    instance_count = random.randint(1, 3)
    engines = ["mysql", "postgres", "mariadb"]

    try:
        for i in range(instance_count):
            db_name = cool_name("db", funny=True)
            try:
                client.create_db_instance(
                    DBInstanceIdentifier=db_name,
                    DBInstanceClass="db.t3.micro",
                    Engine=random.choice(engines),
                    MasterUsername="admin",
                    MasterUserPassword="SecurePass123!",
                    AllocatedStorage=20,
                )
                print(f"  ✓ {db_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {instance_count} RDS instances")
    except Exception as e:
        print(f"RDS error: {e}")


def populate_kms():
    """Populate KMS with test keys."""
    print("\n=== KMS ===")
    client = get_client("kms")

    key_count = random.randint(2, 4)

    try:
        for i in range(key_count):
            try:
                response = client.create_key(
                    Description=f"KMS key for {cool_name(funny=True)}",
                    KeyUsage="ENCRYPT_DECRYPT",
                )
                key_id = response["KeyMetadata"]["KeyId"]
                alias = cool_name("key", funny=True)
                try:
                    client.create_alias(AliasName=f"alias/{alias}", TargetKeyId=key_id)
                except Exception:
                    pass
                print(f"  ✓ {alias} ({key_id[:8]}...)")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {key_count} KMS keys")
    except Exception as e:
        print(f"KMS error: {e}")


def populate_cloudformation():
    """Populate CloudFormation with test stacks."""
    print("\n=== CloudFormation ===")
    client = get_client("cloudformation")

    stack_count = random.randint(1, 3)

    try:
        for i in range(stack_count):
            stack_name = cool_name("stack", funny=True)
            try:
                template = '{"AWSTemplateFormatVersion": "2010-09-09", "Resources": {}}'
                client.create_stack(StackName=stack_name, TemplateBody=template)
                print(f"  ✓ {stack_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {stack_count} CloudFormation stacks")
    except Exception as e:
        print(f"CloudFormation error: {e}")


def populate_ecr():
    """Populate ECR with test repositories."""
    print("\n=== ECR ===")
    client = get_client("ecr")

    repo_count = random.randint(2, 5)

    try:
        for i in range(repo_count):
            repo_name = cool_name("repo", funny=True)
            try:
                client.create_repository(repositoryName=repo_name)
                print(f"  ✓ {repo_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {repo_count} ECR repositories")
    except Exception as e:
        print(f"ECR error: {e}")


def populate_ecs():
    """Populate ECS with test clusters."""
    print("\n=== ECS ===")
    client = get_client("ecs")

    cluster_count = random.randint(1, 3)

    try:
        for i in range(cluster_count):
            cluster_name = cool_name("cluster", include_env=True, funny=True)
            try:
                client.create_cluster(clusterName=cluster_name)
                print(f"  ✓ {cluster_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {cluster_count} ECS clusters")
    except Exception as e:
        print(f"ECS error: {e}")


def populate_elasticache():
    """Populate ElastiCache with test cache clusters."""
    print("\n=== ElastiCache ===")
    client = get_client("elasticache")

    cluster_count = random.randint(1, 3)
    engines = ["memcached", "redis"]

    try:
        for i in range(cluster_count):
            cluster_name = cool_name("cache", funny=True)
            try:
                client.create_cache_cluster(
                    CacheClusterId=cluster_name,
                    Engine=random.choice(engines),
                    CacheNodeType="cache.t2.micro",
                    NumCacheNodes=1,
                )
                print(f"  ✓ {cluster_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {cluster_count} ElastiCache clusters")
    except Exception as e:
        print(f"ElastiCache error: {e}")


def populate_ssm():
    """Populate Systems Manager with test parameters."""
    print("\n=== Systems Manager (SSM) ===")
    client = get_client("ssm")

    param_count = random.randint(3, 8)

    try:
        for i in range(param_count):
            param_name = f"/app/{cool_name(funny=True)}/config"
            try:
                client.put_parameter(
                    Name=param_name,
                    Value=json.dumps({"version": "1.0", "enabled": True}),
                    Type="String",
                    Description=f"Parameter: {param_name}",
                    Overwrite=True,
                )
                print(f"  ✓ {param_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {param_count} SSM parameters")
    except Exception as e:
        print(f"SSM error: {e}")


def populate_stepfunctions():
    """Populate Step Functions with complex state machines and executions.

    Creates a helper Lambda, then builds state machines with various ASL patterns:
    Choice, Parallel, Wait, Map, Catch/Retry, Succeed/Fail branches.
    Also starts executions so the execution history is populated.
    """
    print("\n=== Step Functions ===")
    client = get_client("stepfunctions")
    lambda_client = get_client("lambda")

    # Create a helper Lambda for Task states
    helper_fn_name = "sfn-task-processor"
    helper_fn_arn = f"arn:aws:lambda:{AWS_REGION}:000000000000:function:{helper_fn_name}"
    try:
        import zipfile
        import io

        lambda_code = b'''
import json
import time
import random

def handler(event, context):
    action = event.get("action", "process")
    if action == "fail":
        raise Exception("Intentional failure for testing")
    if action == "slow":
        time.sleep(2)
    result = {
        "status": "completed",
        "action": action,
        "processedAt": "2026-01-15T10:30:00Z",
        "items": event.get("items", []),
        "count": len(event.get("items", [])),
        "requestId": context.aws_request_id if context else "local"
    }
    return result
'''
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("handler.py", lambda_code)
        zip_buffer.seek(0)

        lambda_client.create_function(
            FunctionName=helper_fn_name,
            Runtime="python3.11",
            Role="arn:aws:iam::000000000000:role/lambda-role",
            Handler="handler.handler",
            Code={"ZipFile": zip_buffer.read()},
            Description="Helper function for Step Functions task states",
            Timeout=30,
            MemorySize=256,
        )
        print(f"  ✓ Lambda: {helper_fn_name}")
    except lambda_client.exceptions.ResourceConflictException:
        print(f"  ~ Lambda: {helper_fn_name} (already exists)")
    except Exception as e:
        print(f"  ✗ Lambda error: {e}")

    # --- State Machine 1: Order Processing Pipeline (complex, realistic) ---
    order_pipeline_def = {
        "Comment": "Order processing pipeline with validation, payment, and fulfillment",
        "StartAt": "ValidateOrder",
        "States": {
            "ValidateOrder": {
                "Type": "Task",
                "Resource": helper_fn_arn,
                "Parameters": {
                    "action": "validate",
                    "items.$": "$.items",
                    "orderId.$": "$.orderId",
                },
                "ResultPath": "$.validation",
                "Next": "CheckValidation",
                "Retry": [
                    {
                        "ErrorEquals": ["Lambda.ServiceException"],
                        "IntervalSeconds": 2,
                        "MaxAttempts": 3,
                        "BackoffRate": 2.0,
                    }
                ],
                "Catch": [
                    {
                        "ErrorEquals": ["States.ALL"],
                        "Next": "OrderFailed",
                        "ResultPath": "$.error",
                    }
                ],
            },
            "CheckValidation": {
                "Type": "Choice",
                "Choices": [
                    {
                        "Variable": "$.validation.status",
                        "StringEquals": "completed",
                        "Next": "ProcessPayment",
                    },
                    {
                        "Variable": "$.validation.status",
                        "StringEquals": "needs_review",
                        "Next": "WaitForReview",
                    },
                ],
                "Default": "OrderFailed",
            },
            "WaitForReview": {
                "Type": "Wait",
                "Seconds": 5,
                "Next": "ProcessPayment",
            },
            "ProcessPayment": {
                "Type": "Task",
                "Resource": helper_fn_arn,
                "Parameters": {
                    "action": "process",
                    "orderId.$": "$.orderId",
                    "amount.$": "$.totalAmount",
                },
                "ResultPath": "$.payment",
                "Next": "ParallelFulfillment",
                "Catch": [
                    {
                        "ErrorEquals": ["States.ALL"],
                        "Next": "PaymentFailed",
                        "ResultPath": "$.error",
                    }
                ],
            },
            "ParallelFulfillment": {
                "Type": "Parallel",
                "Branches": [
                    {
                        "StartAt": "UpdateInventory",
                        "States": {
                            "UpdateInventory": {
                                "Type": "Task",
                                "Resource": helper_fn_arn,
                                "Parameters": {"action": "inventory", "items.$": "$.items"},
                                "End": True,
                            }
                        },
                    },
                    {
                        "StartAt": "SendConfirmation",
                        "States": {
                            "SendConfirmation": {
                                "Type": "Task",
                                "Resource": helper_fn_arn,
                                "Parameters": {"action": "notify", "orderId.$": "$.orderId"},
                                "End": True,
                            }
                        },
                    },
                    {
                        "StartAt": "GenerateInvoice",
                        "States": {
                            "GenerateInvoice": {
                                "Type": "Task",
                                "Resource": helper_fn_arn,
                                "Parameters": {"action": "invoice", "orderId.$": "$.orderId"},
                                "End": True,
                            }
                        },
                    },
                ],
                "ResultPath": "$.fulfillment",
                "Next": "OrderSucceeded",
                "Catch": [
                    {
                        "ErrorEquals": ["States.ALL"],
                        "Next": "OrderFailed",
                        "ResultPath": "$.error",
                    }
                ],
            },
            "OrderSucceeded": {
                "Type": "Succeed",
            },
            "PaymentFailed": {
                "Type": "Task",
                "Resource": helper_fn_arn,
                "Parameters": {"action": "refund", "orderId.$": "$.orderId"},
                "ResultPath": "$.refund",
                "Next": "OrderFailed",
            },
            "OrderFailed": {
                "Type": "Fail",
                "Error": "OrderProcessingError",
                "Cause": "Order could not be completed",
            },
        },
    }

    # --- State Machine 2: Data ETL Pipeline (Map + Wait) ---
    etl_pipeline_def = {
        "Comment": "ETL pipeline that processes batches of records with retry logic",
        "StartAt": "FetchBatchManifest",
        "States": {
            "FetchBatchManifest": {
                "Type": "Task",
                "Resource": helper_fn_arn,
                "Parameters": {"action": "process", "items.$": "$.sources"},
                "ResultPath": "$.manifest",
                "Next": "ProcessBatches",
            },
            "ProcessBatches": {
                "Type": "Map",
                "ItemsPath": "$.manifest.items",
                "MaxConcurrency": 5,
                "Iterator": {
                    "StartAt": "TransformRecord",
                    "States": {
                        "TransformRecord": {
                            "Type": "Task",
                            "Resource": helper_fn_arn,
                            "Parameters": {"action": "process"},
                            "Next": "LoadRecord",
                            "Retry": [
                                {
                                    "ErrorEquals": ["States.ALL"],
                                    "IntervalSeconds": 1,
                                    "MaxAttempts": 2,
                                }
                            ],
                        },
                        "LoadRecord": {
                            "Type": "Task",
                            "Resource": helper_fn_arn,
                            "Parameters": {"action": "process"},
                            "End": True,
                        },
                    },
                },
                "ResultPath": "$.processed",
                "Next": "WaitForPropagation",
            },
            "WaitForPropagation": {
                "Type": "Wait",
                "Seconds": 10,
                "Next": "VerifyResults",
            },
            "VerifyResults": {
                "Type": "Task",
                "Resource": helper_fn_arn,
                "Parameters": {"action": "process"},
                "ResultPath": "$.verification",
                "Next": "CheckResults",
            },
            "CheckResults": {
                "Type": "Choice",
                "Choices": [
                    {
                        "Variable": "$.verification.status",
                        "StringEquals": "completed",
                        "Next": "ETLComplete",
                    }
                ],
                "Default": "ETLFailed",
            },
            "ETLComplete": {
                "Type": "Succeed",
            },
            "ETLFailed": {
                "Type": "Fail",
                "Error": "ETLVerificationFailed",
                "Cause": "Data verification did not pass",
            },
        },
    }

    # --- State Machine 3: Simple Pass-through (minimal) ---
    simple_def = {
        "Comment": "Simple passthrough state machine for quick testing",
        "StartAt": "FormatInput",
        "States": {
            "FormatInput": {
                "Type": "Pass",
                "Parameters": {
                    "formatted.$": "$.input",
                    "timestamp.$": "$$.State.EnteredTime",
                },
                "Next": "Done",
            },
            "Done": {
                "Type": "Succeed",
            },
        },
    }

    # --- State Machine 4: Error Handling Showcase ---
    error_handling_def = {
        "Comment": "Demonstrates various error handling patterns",
        "StartAt": "TryRiskyOperation",
        "States": {
            "TryRiskyOperation": {
                "Type": "Task",
                "Resource": helper_fn_arn,
                "Parameters": {"action": "process"},
                "Next": "Success",
                "Retry": [
                    {
                        "ErrorEquals": ["Lambda.TooManyRequestsException"],
                        "IntervalSeconds": 1,
                        "MaxAttempts": 5,
                        "BackoffRate": 2.0,
                    },
                    {
                        "ErrorEquals": ["Lambda.ServiceException"],
                        "IntervalSeconds": 3,
                        "MaxAttempts": 2,
                    },
                ],
                "Catch": [
                    {
                        "ErrorEquals": ["CustomError"],
                        "Next": "HandleCustomError",
                        "ResultPath": "$.error",
                    },
                    {
                        "ErrorEquals": ["States.ALL"],
                        "Next": "HandleGenericError",
                        "ResultPath": "$.error",
                    },
                ],
            },
            "HandleCustomError": {
                "Type": "Pass",
                "Parameters": {
                    "errorType": "custom",
                    "message": "A known error occurred, applying fallback",
                },
                "Next": "FallbackOperation",
            },
            "HandleGenericError": {
                "Type": "Pass",
                "Parameters": {
                    "errorType": "generic",
                    "message": "An unexpected error occurred",
                },
                "Next": "NotifyOnCall",
            },
            "FallbackOperation": {
                "Type": "Task",
                "Resource": helper_fn_arn,
                "Parameters": {"action": "process"},
                "Next": "Success",
                "Catch": [
                    {
                        "ErrorEquals": ["States.ALL"],
                        "Next": "NotifyOnCall",
                        "ResultPath": "$.error",
                    }
                ],
            },
            "NotifyOnCall": {
                "Type": "Task",
                "Resource": helper_fn_arn,
                "Parameters": {"action": "process"},
                "Next": "Failure",
            },
            "Success": {
                "Type": "Succeed",
            },
            "Failure": {
                "Type": "Fail",
                "Error": "UnrecoverableError",
                "Cause": "All retry and fallback attempts exhausted",
            },
        },
    }

    state_machines = [
        ("order-processing-pipeline", order_pipeline_def),
        ("data-etl-pipeline", etl_pipeline_def),
        ("simple-passthrough", simple_def),
        ("error-handling-showcase", error_handling_def),
    ]

    created_arns = []

    for sm_name, definition in state_machines:
        try:
            resp = client.create_state_machine(
                name=sm_name,
                definition=json.dumps(definition),
                roleArn="arn:aws:iam::000000000000:role/stepfunctions-role",
            )
            created_arns.append(resp["stateMachineArn"])
            print(f"  ✓ State machine: {sm_name}")
        except Exception as e:
            print(f"  ✗ State machine {sm_name}: {e}")

    # Start executions for the state machines
    execution_inputs = [
        {
            "orderId": "ORD-2026-001",
            "items": [
                {"sku": "WIDGET-A", "qty": 3, "price": 29.99},
                {"sku": "GADGET-B", "qty": 1, "price": 149.99},
            ],
            "totalAmount": 239.96,
            "customer": {"email": "alice@example.com", "tier": "premium"},
        },
        {
            "sources": ["s3://data-lake/batch-001.parquet", "s3://data-lake/batch-002.parquet"],
            "outputPath": "s3://warehouse/processed/",
            "config": {"format": "parquet", "compression": "snappy"},
        },
        {
            "input": "Hello from Step Functions!",
            "metadata": {"source": "manual-test", "timestamp": "2026-05-12T10:00:00Z"},
        },
        {
            "operationId": "op-7891",
            "payload": {"key": "value", "nested": {"deep": True}},
        },
    ]

    for i, arn in enumerate(created_arns):
        try:
            input_data = execution_inputs[i] if i < len(execution_inputs) else {}
            sm_name = state_machines[i][0]
            client.start_execution(
                stateMachineArn=arn,
                name=f"{sm_name}-exec-{random.randint(1000, 9999)}",
                input=json.dumps(input_data),
            )
            print(f"  ✓ Started execution for: {sm_name}")
            # Start a second execution for the order pipeline
            if i == 0:
                client.start_execution(
                    stateMachineArn=arn,
                    name=f"{sm_name}-exec-{random.randint(1000, 9999)}",
                    input=json.dumps({
                        "orderId": "ORD-2026-002",
                        "items": [{"sku": "PREMIUM-X", "qty": 1, "price": 999.99}],
                        "totalAmount": 999.99,
                        "customer": {"email": "bob@example.com", "tier": "standard"},
                    }),
                )
                print(f"  ✓ Started 2nd execution for: {sm_name}")
        except Exception as e:
            print(f"  ✗ Execution error: {e}")

    print(f"Created {len(created_arns)} state machines with executions")


def populate_secrets():
    """Populate Secrets Manager with test secrets."""
    print("\n=== Secrets Manager ===")
    client = get_client("secretsmanager")

    secret_count = random.randint(2, 5)

    try:
        for i in range(secret_count):
            secret_name = f"{cool_name('secret', funny=True)}"
            try:
                secret_value = {
                    "username": "admin",
                    "password": "SuperSecret" + str(random.randint(100, 999)),
                    "engine": random.choice(["mysql", "postgres", "mongodb"]),
                }
                client.create_secret(
                    Name=secret_name,
                    Description=f"Secret: {secret_name}",
                    SecretString=json.dumps(secret_value),
                )
                print(f"  ✓ {secret_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {secret_count} Secrets Manager secrets")
    except Exception as e:
        print(f"Secrets Manager error: {e}")


def populate_wafv2():
    """Populate WAFv2 with test web ACLs."""
    print("\n=== WAFv2 ===")
    client = get_client("wafv2")

    acl_count = random.randint(1, 3)

    try:
        for i in range(acl_count):
            acl_name = cool_name("waf", funny=True)
            try:
                client.create_web_acl(
                    Name=acl_name,
                    Scope="REGIONAL",
                    DefaultAction={"Allow": {}},
                    Rules=[],
                    VisibilityConfig={
                        "SampledRequestsEnabled": True,
                        "CloudWatchMetricsEnabled": True,
                        "MetricName": acl_name,
                    },
                )
                print(f"  ✓ {acl_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {acl_count} WAFv2 web ACLs")
    except Exception as e:
        print(f"WAFv2 error: {e}")


def populate_logs():
    """Populate CloudWatch Logs with test log groups."""
    print("\n=== CloudWatch Logs ===")
    client = get_client("logs")

    lg_count = random.randint(2, 5)

    try:
        for i in range(lg_count):
            lg_name = f"/aws/{cool_name('app', funny=True)}"
            try:
                client.create_log_group(logGroupName=lg_name)
                print(f"  ✓ {lg_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {lg_count} CloudWatch Log Groups")
    except Exception as e:
        print(f"CloudWatch Logs error: {e}")


def populate_kinesis():
    """Populate Kinesis with test streams."""
    print("\n=== Kinesis ===")
    client = get_client("kinesis")

    stream_count = random.randint(2, 4)

    try:
        for i in range(stream_count):
            stream_name = cool_name("stream", funny=True)
            try:
                client.create_stream(StreamName=stream_name, ShardCount=1)
                print(f"  ✓ {stream_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {stream_count} Kinesis streams")
    except Exception as e:
        print(f"Kinesis error: {e}")


def populate_apigateway():
    """Populate API Gateway with test APIs and resources."""
    print("\n=== API Gateway ===")
    client = get_client("apigateway")

    api_count = random.randint(2, 4)
    resources_per_api = random.randint(2, 5)

    try:
        for i in range(api_count):
            api_name = cool_name("api", funny=True)
            try:
                response = client.create_rest_api(
                    name=api_name,
                    description=f"REST API: {api_name}",
                    endpointConfiguration={"types": ["REGIONAL"]},
                )
                api_id = response["id"]
                root_id = client.get_resources(restApiId=api_id)["items"][0]["id"]

                # Add resources and methods
                for j in range(resources_per_api):
                    resource_name = cool_name("endpoint", funny=True).replace("-", "")
                    try:
                        resource = client.create_resource(
                            restApiId=api_id, parentId=root_id, pathPart=resource_name
                        )

                        # Add GET method
                        client.put_method(
                            restApiId=api_id,
                            resourceId=resource["id"],
                            httpMethod="GET",
                            authorizationType="NONE",
                        )

                        # Add integration
                        client.put_integration(
                            restApiId=api_id,
                            resourceId=resource["id"],
                            httpMethod="GET",
                            type="MOCK",
                        )
                    except Exception:
                        pass

                print(f"  ✓ {api_name} ({resources_per_api} resources)")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {api_count} API Gateway REST APIs with resources")
    except Exception as e:
        print(f"API Gateway error: {e}")


def populate_acm():
    """Populate ACM with test certificates."""
    print("\n=== Certificate Manager (ACM) ===")
    client = get_client("acm")

    cert_count = random.randint(1, 3)

    try:
        for i in range(cert_count):
            domain = f"{cool_name(funny=True).replace('-', '')}.example.com"
            try:
                client.request_certificate(DomainName=domain, ValidationMethod="DNS")
                print(f"  ✓ {domain}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {cert_count} ACM certificates")
    except Exception as e:
        print(f"ACM error: {e}")


def populate_cloudwatch():
    """Populate CloudWatch with monitoring resources."""
    print("\n=== CloudWatch (Monitoring) ===")
    client = get_client("cloudwatch")

    alarm_count = random.randint(2, 4)

    try:
        for i in range(alarm_count):
            alarm_name = cool_name("alarm", funny=True)
            try:
                client.put_metric_alarm(
                    AlarmName=alarm_name,
                    MetricName="CPUUtilization",
                    Namespace="AWS/EC2",
                    Statistic="Average",
                    Period=300,
                    EvaluationPeriods=1,
                    Threshold=80.0,
                    ComparisonOperator="GreaterThanThreshold",
                    AlarmActions=[],
                )
                print(f"  ✓ {alarm_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {alarm_count} CloudWatch alarms")
    except Exception as e:
        print(f"CloudWatch error: {e}")


def populate_route53():
    """Populate Route 53 with test hosted zones and records."""
    print("\n=== Route 53 ===")
    client = get_client("route53")

    zone_count = random.randint(2, 4)
    records_per_zone = random.randint(3, 6)

    try:
        for i in range(zone_count):
            domain = f"{cool_name(funny=True).replace('-', '')}.com"
            try:
                # Create hosted zone
                response = client.create_hosted_zone(
                    Name=domain, CallerReference=str(random.randint(100000, 999999))
                )
                zone_id = response["HostedZone"]["Id"]

                # Add records
                for j in range(records_per_zone):
                    record_type = random.choice(["A", "CNAME", "MX", "TXT"])
                    subdomain = cool_name(funny=True).replace("-", "")

                    if record_type == "A":
                        value = (
                            f"192.168.{random.randint(1, 255)}.{random.randint(1, 255)}"
                        )
                    elif record_type == "CNAME":
                        value = f"{cool_name(funny=True).replace('-', '')}.example.com"
                    elif record_type == "MX":
                        value = f"10 mail-{cool_name(funny=True).replace('-', '')}.example.com"
                    else:  # TXT
                        value = f"v=spf1 include:example.com ~all"

                    try:
                        client.change_resource_record_sets(
                            HostedZoneId=zone_id,
                            ChangeBatch={
                                "Changes": [
                                    {
                                        "Action": "CREATE",
                                        "ResourceRecordSet": {
                                            "Name": f"{subdomain}.{domain}",
                                            "Type": record_type,
                                            "TTL": 300,
                                            "ResourceRecords": [{"Value": value}],
                                        },
                                    }
                                ]
                            },
                        )
                    except Exception:
                        pass

                print(f"  ✓ {domain} ({records_per_zone} records)")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {zone_count} Route 53 hosted zones")
    except Exception as e:
        print(f"Route 53 error: {e}")


def populate_appsync():
    """Populate AppSync with test GraphQL APIs."""
    print("\n=== AppSync ===")
    client = get_client("appsync")

    api_count = random.randint(2, 4)

    try:
        for i in range(api_count):
            api_name = cool_name("graphql", funny=True)
            try:
                client.create_graphql_api(
                    name=api_name,
                    authenticationType=random.choice(
                        ["API_KEY", "AWS_IAM", "AMAZON_COGNITO_USER_POOLS"]
                    ),
                )
                print(f"  ✓ {api_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {api_count} AppSync GraphQL APIs")
    except Exception as e:
        print(f"AppSync error: {e}")


def populate_cloudfront():
    """Populate CloudFront with test distributions."""
    print("\n=== CloudFront ===")
    client = get_client("cloudfront")

    dist_count = random.randint(1, 3)

    try:
        for i in range(dist_count):
            origin_name = cool_name("origin", funny=True)
            try:
                client.create_distribution(
                    DistributionConfig={
                        "CallerReference": f"ref-{random.randint(100000, 999999)}",
                        "Origins": {
                            "Quantity": 1,
                            "Items": [
                                {
                                    "Id": origin_name,
                                    "DomainName": f"{origin_name}.s3.amazonaws.com",
                                    "S3OriginConfig": {"OriginAccessIdentity": ""},
                                }
                            ],
                        },
                        "DefaultCacheBehavior": {
                            "TargetOriginId": origin_name,
                            "ViewerProtocolPolicy": "redirect-to-https",
                            "ForwardedValues": {
                                "QueryString": False,
                                "Cookies": {"Forward": "none"},
                            },
                            "MinTTL": 0,
                            "TrustedSigners": {"Enabled": False, "Quantity": 0},
                        },
                        "Comment": f"Distribution for {origin_name}",
                        "Enabled": random.choice([True, False]),
                    }
                )
                print(f"  ✓ {origin_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {dist_count} CloudFront distributions")
    except Exception as e:
        print(f"CloudFront error: {e}")


def populate_cognito_identity():
    """Populate Cognito Identity with test identity pools."""
    print("\n=== Cognito Identity ===")
    client = get_client("cognito-identity")

    pool_count = random.randint(1, 3)

    try:
        for i in range(pool_count):
            pool_name = cool_name("idpool", funny=True)
            try:
                client.create_identity_pool(
                    IdentityPoolName=pool_name,
                    AllowUnauthenticatedIdentities=random.choice([True, False]),
                )
                print(f"  ✓ {pool_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {pool_count} Cognito Identity pools")
    except Exception as e:
        print(f"Cognito Identity error: {e}")


def populate_cognito_idp():
    """Populate Cognito User Pools with test pools and users."""
    print("\n=== Cognito User Pools ===")
    client = get_client("cognito-idp")

    pool_count = random.randint(1, 3)
    users_per_pool = random.randint(2, 5)

    try:
        for i in range(pool_count):
            pool_name = cool_name("userpool", funny=True)
            try:
                response = client.create_user_pool(
                    PoolName=pool_name,
                    AutoVerifiedAttributes=["email"],
                )
                pool_id = response["UserPool"]["Id"]

                for j in range(users_per_pool):
                    username = f"{random.choice(ADJECTIVES)}.{random.choice(NOUNS)}"
                    try:
                        client.admin_create_user(
                            UserPoolId=pool_id,
                            Username=username,
                            UserAttributes=[
                                {
                                    "Name": "email",
                                    "Value": f"{username}@example.com",
                                },
                            ],
                            MessageAction="SUPPRESS",
                        )
                    except Exception:
                        pass

                print(f"  ✓ {pool_name} ({users_per_pool} users)")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {pool_count} Cognito User Pools")
    except Exception as e:
        print(f"Cognito User Pools error: {e}")


def populate_efs():
    """Populate EFS with test file systems."""
    print("\n=== Elastic File System (EFS) ===")
    client = get_client("efs")

    fs_count = random.randint(1, 3)

    try:
        for i in range(fs_count):
            fs_name = cool_name("fs", funny=True)
            try:
                client.create_file_system(
                    CreationToken=f"token-{fs_name}",
                    PerformanceMode=random.choice(["generalPurpose", "maxIO"]),
                    Tags=[{"Key": "Name", "Value": fs_name}],
                )
                print(f"  ✓ {fs_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {fs_count} EFS file systems")
    except Exception as e:
        print(f"EFS error: {e}")


def populate_elb():
    """Populate Elastic Load Balancing with test load balancers and target groups."""
    print("\n=== Elastic Load Balancing (ELBv2) ===")
    client = get_client("elbv2")
    ec2_client = get_client("ec2")

    lb_count = random.randint(1, 3)

    try:
        subnets = []
        try:
            response = ec2_client.describe_subnets()
            subnets = [s["SubnetId"] for s in response.get("Subnets", [])][:2]
        except Exception:
            pass

        for i in range(lb_count):
            lb_name = cool_name("lb", funny=True)[:32]
            lb_type = random.choice(["application", "network"])
            scheme = random.choice(["internet-facing", "internal"])
            try:
                kwargs = {
                    "Name": lb_name,
                    "Type": lb_type,
                    "Scheme": scheme,
                }
                if subnets:
                    kwargs["Subnets"] = subnets

                client.create_load_balancer(**kwargs)
                print(f"  ✓ {lb_name} ({lb_type}, {scheme})")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        tg_count = random.randint(1, 3)
        for i in range(tg_count):
            tg_name = cool_name("tg", funny=True)[:32]
            try:
                vpc_id = None
                try:
                    vpcs = ec2_client.describe_vpcs()
                    if vpcs.get("Vpcs"):
                        vpc_id = vpcs["Vpcs"][0]["VpcId"]
                except Exception:
                    pass

                tg_kwargs = {
                    "Name": tg_name,
                    "Protocol": random.choice(["HTTP", "HTTPS", "TCP"]),
                    "Port": random.choice([80, 443, 8080, 3000, 8443]),
                    "TargetType": "instance",
                }
                if vpc_id:
                    tg_kwargs["VpcId"] = vpc_id

                client.create_target_group(**tg_kwargs)
                print(f"  ✓ Target group: {tg_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {lb_count} load balancers, {tg_count} target groups")
    except Exception as e:
        print(f"ELB error: {e}")


def populate_emr():
    """Populate EMR with test clusters."""
    print("\n=== Elastic MapReduce (EMR) ===")
    client = get_client("emr")

    cluster_count = random.randint(1, 3)

    try:
        for i in range(cluster_count):
            cluster_name = cool_name("emr", funny=True)
            try:
                client.run_job_flow(
                    Name=cluster_name,
                    ReleaseLabel="emr-6.15.0",
                    Instances={
                        "MasterInstanceType": "m5.xlarge",
                        "SlaveInstanceType": "m5.xlarge",
                        "InstanceCount": random.randint(2, 5),
                        "KeepJobFlowAliveWhenNoSteps": True,
                    },
                    Applications=[
                        {"Name": "Spark"},
                        {"Name": "Hive"},
                    ],
                    JobFlowRole="EMR_EC2_DefaultRole",
                    ServiceRole="EMR_DefaultRole",
                    VisibleToAllUsers=True,
                )
                print(f"  ✓ {cluster_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {cluster_count} EMR clusters")
    except Exception as e:
        print(f"EMR error: {e}")


def populate_firehose():
    """Populate Kinesis Firehose with test delivery streams."""
    print("\n=== Kinesis Firehose ===")
    client = get_client("firehose")

    stream_count = random.randint(1, 3)

    try:
        for i in range(stream_count):
            stream_name = cool_name("firehose", funny=True)
            try:
                client.create_delivery_stream(
                    DeliveryStreamName=stream_name,
                    DeliveryStreamType="DirectPut",
                    S3DestinationConfiguration={
                        "RoleARN": f"arn:aws:iam::000000000000:role/{cool_name('role')}",
                        "BucketARN": f"arn:aws:s3:::{cool_name('bucket')}",
                        "Prefix": f"{cool_name('prefix')}/",
                    },
                )
                print(f"  ✓ {stream_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {stream_count} Firehose delivery streams")
    except Exception as e:
        print(f"Firehose error: {e}")


def populate_glue():
    """Populate Glue with test databases and crawlers."""
    print("\n=== Glue ===")
    client = get_client("glue")

    db_count = random.randint(2, 4)
    crawler_count = random.randint(1, 3)

    try:
        created_dbs = []
        for i in range(db_count):
            db_name = cool_name("gluedb", funny=True).replace("-", "_")
            try:
                client.create_database(
                    DatabaseInput={
                        "Name": db_name,
                        "Description": f"Glue database: {db_name}",
                    }
                )
                created_dbs.append(db_name)
                print(f"  ✓ Database: {db_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        for i in range(crawler_count):
            crawler_name = cool_name("crawler", funny=True)
            target_db = random.choice(created_dbs) if created_dbs else "default"
            try:
                client.create_crawler(
                    Name=crawler_name,
                    Role=f"arn:aws:iam::000000000000:role/{cool_name('role')}",
                    DatabaseName=target_db,
                    Targets={
                        "S3Targets": [{"Path": f"s3://{cool_name('bucket')}/data/"}]
                    },
                )
                print(f"  ✓ Crawler: {crawler_name} → {target_db}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {db_count} Glue databases, {crawler_count} crawlers")
    except Exception as e:
        print(f"Glue error: {e}")


def populate_ses():
    """Populate SES with test email identities and templates."""
    print("\n=== Simple Email Service (SES) ===")
    client = get_client("ses")

    identity_count = random.randint(2, 5)
    template_count = random.randint(1, 3)

    try:
        for i in range(identity_count):
            if random.random() > 0.5:
                identity = (
                    f"{random.choice(ADJECTIVES)}.{random.choice(NOUNS)}@example.com"
                )
                try:
                    client.verify_email_identity(EmailAddress=identity)
                    print(f"  ✓ Email: {identity}")
                except Exception as e:
                    print(f"  ✗ Error: {e}")
            else:
                domain = f"{cool_name(funny=True).replace('-', '')}.example.com"
                try:
                    client.verify_domain_identity(Domain=domain)
                    print(f"  ✓ Domain: {domain}")
                except Exception as e:
                    print(f"  ✗ Error: {e}")

        for i in range(template_count):
            tpl_name = cool_name("email-tpl", funny=True)
            try:
                client.create_template(
                    Template={
                        "TemplateName": tpl_name,
                        "SubjectPart": f"Hello from {tpl_name}!",
                        "HtmlPart": "<h1>Hello {{name}}</h1><p>Welcome aboard!</p>",
                        "TextPart": "Hello {{name}}, welcome aboard!",
                    }
                )
                print(f"  ✓ Template: {tpl_name}")
            except Exception as e:
                print(f"  ✗ Error: {e}")

        print(f"Created {identity_count} SES identities, {template_count} templates")
    except Exception as e:
        print(f"SES error: {e}")


def main():
    """Main execution."""
    parser = argparse.ArgumentParser(
        description="Populate AWS services with random test data"
    )
    parser.add_argument(
        "--services",
        default="all",
        help="Comma-separated services or 'all' (default: all)",
    )
    args = parser.parse_args()

    print(f"🚀 Connecting to {AWS_ENDPOINT_URL}")
    print(f"📍 Region: {AWS_REGION}")

    services_map = {
        "s3": populate_s3,
        "dynamodb": populate_dynamodb,
        "lambda": populate_lambda,
        "sqs": populate_sqs,
        "sns": populate_sns,
        "ec2": populate_ec2,
        "iam": populate_iam,
        "rds": populate_rds,
        "kms": populate_kms,
        "cloudformation": populate_cloudformation,
        "ecr": populate_ecr,
        "ecs": populate_ecs,
        "elasticache": populate_elasticache,
        "ssm": populate_ssm,
        "stepfunctions": populate_stepfunctions,
        "secretsmanager": populate_secrets,
        "wafv2": populate_wafv2,
        "logs": populate_logs,
        "kinesis": populate_kinesis,
        "apigateway": populate_apigateway,
        "acm": populate_acm,
        "cloudwatch": populate_cloudwatch,
        "route53": populate_route53,
        "appsync": populate_appsync,
        "cloudfront": populate_cloudfront,
        "cognito-identity": populate_cognito_identity,
        "cognito-idp": populate_cognito_idp,
        "efs": populate_efs,
        "elb": populate_elb,
        "emr": populate_emr,
        "firehose": populate_firehose,
        "glue": populate_glue,
        "ses": populate_ses,
    }

    # Allow common aliases for service names in --services input.
    service_aliases = {
        "secretmanager": "secretsmanager",
        "secrets-manager": "secretsmanager",
        "secret-manager": "secretsmanager",
        "cognito": "cognito-idp",
        "cognito-user-pools": "cognito-idp",
        "cognito-identity-pools": "cognito-identity",
        "elasticfilesystem": "efs",
        "elasticloadbalancing": "elb",
        "elbv2": "elb",
        "elasticmapreduce": "emr",
        "monitoring": "cloudwatch",
    }

    if args.services.lower() == "all":
        services_to_run = list(services_map.keys())
    else:
        requested_services = [s.strip().lower() for s in args.services.split(",")]
        services_to_run = [service_aliases.get(s, s) for s in requested_services]

    print(f"📦 Populating services: {', '.join(services_to_run)}\n")

    for service in services_to_run:
        if service in services_map:
            try:
                services_map[service]()
            except Exception as e:
                print(f"❌ {service.upper()}: {e}")
        else:
            print(f"\n⚠️  {service.upper()} - not supported")

    print("\n✅ Test data population complete!")
    print("   Use StackPort to browse all resources at http://localhost:8080")


if __name__ == "__main__":
    main()
