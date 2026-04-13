/**
 * AWS service icon mapping.
 * Uses official AWS Architecture Icons stored in /public/aws-icons/.
 * Falls back to null for unknown services (handled by service-icons.ts).
 */

interface AwsIconProps {
  className?: string
}

function createAwsIcon(filename: string) {
  return function AwsIcon({ className }: AwsIconProps) {
    return <img src={`/aws-icons/${filename}.svg`} alt="" className={className} draggable={false} />
  }
}

export const AWS_ICON_MAP: Record<string, React.FC<AwsIconProps>> = {
  s3: createAwsIcon('s3'),
  sqs: createAwsIcon('sqs'),
  sns: createAwsIcon('sns'),
  dynamodb: createAwsIcon('dynamodb'),
  lambda: createAwsIcon('lambda'),
  iam: createAwsIcon('iam'),
  logs: createAwsIcon('logs'),
  ssm: createAwsIcon('ssm'),
  secretsmanager: createAwsIcon('secretsmanager'),
  kinesis: createAwsIcon('kinesis'),
  events: createAwsIcon('events'),
  'events-scheduler': createAwsIcon('events'),
  ec2: createAwsIcon('ec2'),
  route53: createAwsIcon('route53'),
  kms: createAwsIcon('kms'),
  cloudformation: createAwsIcon('cloudformation'),
  stepfunctions: createAwsIcon('stepfunctions'),
  states: createAwsIcon('stepfunctions'),
  rds: createAwsIcon('rds'),
  ecs: createAwsIcon('ecs'),
  monitoring: createAwsIcon('monitoring'),
  cloudwatch: createAwsIcon('monitoring'),
  ses: createAwsIcon('ses'),
  acm: createAwsIcon('acm'),
  wafv2: createAwsIcon('wafv2'),
  ecr: createAwsIcon('ecr'),
  elasticache: createAwsIcon('elasticache'),
  glue: createAwsIcon('glue'),
  athena: createAwsIcon('athena'),
  apigateway: createAwsIcon('apigateway'),
  firehose: createAwsIcon('firehose'),
  'cognito-idp': createAwsIcon('cognito-idp'),
  'cognito-identity': createAwsIcon('cognito-idp'),
  cognito: createAwsIcon('cognito-idp'),
  elasticmapreduce: createAwsIcon('elasticmapreduce'),
  elasticloadbalancing: createAwsIcon('elasticloadbalancing'),
  elbv2: createAwsIcon('elasticloadbalancing'),
  elasticfilesystem: createAwsIcon('elasticfilesystem'),
  cloudfront: createAwsIcon('cloudfront'),
  appsync: createAwsIcon('appsync'),
  sts: createAwsIcon('iam'),
}
