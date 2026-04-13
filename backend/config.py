import os

AWS_ENDPOINT_URL: str = os.environ.get("AWS_ENDPOINT_URL", "http://localhost:4566")
AWS_REGION: str = os.environ.get("AWS_REGION", "us-east-1")
AWS_ACCESS_KEY_ID: str = os.environ.get("AWS_ACCESS_KEY_ID", "test")
AWS_SECRET_ACCESS_KEY: str = os.environ.get("AWS_SECRET_ACCESS_KEY", "test")
STACKPORT_PORT: int = int(os.environ.get("STACKPORT_PORT", "8080"))
STACKPORT_SERVICES: str = os.environ.get(
    "STACKPORT_SERVICES",
    "s3,sqs,sns,dynamodb,lambda,iam,logs,ssm,secretsmanager,kinesis,events,ec2,"
    "route53,kms,cloudformation,stepfunctions,rds,ecs,monitoring,ses,acm,wafv2,"
    "ecr,elasticache,glue,athena,apigateway,firehose,cognito-idp,cognito-identity,"
    "elasticmapreduce,elasticloadbalancing,elasticfilesystem,cloudfront,appsync",
)
LOG_LEVEL: str = os.environ.get("LOG_LEVEL", "INFO").upper()
