import type { ComponentType } from 'react'
import { CloudscapeDynamoDBBrowser } from './DynamoDBBrowser'
import { CloudscapeEC2Browser } from './EC2Browser'
import { CloudscapeIAMBrowser } from './IAMBrowser'
import { CloudscapeLambdaBrowser } from './LambdaBrowser'
import { CloudscapeLogsBrowser } from './LogsBrowser'
import { CloudscapeMonitoringBrowser } from './MonitoringBrowser'
import { CloudscapeRDSBrowser } from './RDSBrowser'
import { CloudscapeS3Browser } from './S3Browser'
import { CloudscapeSecretsManagerBrowser } from './SecretsManagerBrowser'
import { CloudscapeSNSBrowser } from './SNSBrowser'
import { CloudscapeSQSBrowser } from './SQSBrowser'
import { CloudscapeKMSBrowser } from './KMSBrowser'
import { CloudscapeStepFunctionsBrowser } from './StepFunctionsBrowser'
import { HttpApiTryIt, RestApiTryIt } from '../tryit/ApiGatewayTryIt'

/**
 * Registry of Cloudscape service-specific views (launch PR #149).
 *
 * Mirrors SERVICE_VIEWS from the legacy UI: when a service has an entry here,
 * the Cloudscape ResourceBrowser renders it instead of the generic table.
 * Add each service browser here as its migration issue (#137-#146) lands.
 */
export const CLOUDSCAPE_SERVICE_VIEWS: Record<string, ComponentType> = {
  dynamodb: CloudscapeDynamoDBBrowser,
  ec2: CloudscapeEC2Browser,
  iam: CloudscapeIAMBrowser,
  lambda: CloudscapeLambdaBrowser,
  logs: CloudscapeLogsBrowser,
  monitoring: CloudscapeMonitoringBrowser,
  rds: CloudscapeRDSBrowser,
  s3: CloudscapeS3Browser,
  secretsmanager: CloudscapeSecretsManagerBrowser,
  sns: CloudscapeSNSBrowser,
  sqs: CloudscapeSQSBrowser,
  kms: CloudscapeKMSBrowser,
  stepfunctions: CloudscapeStepFunctionsBrowser,
}

/** A tab the generic resource detail adds for one resource type, next to Details and Tags. */
export interface DetailTab {
  id: string
  label: string
  Component: ComponentType<{ resourceId: string }>
}

/** Extra detail tabs for resource types without a view of their own, keyed `service/resourceType`. */
export const CLOUDSCAPE_DETAIL_TABS: Record<string, DetailTab[]> = {
  'apigateway/rest_apis': [{ id: 'try-it', label: 'Try it', Component: RestApiTryIt }],
  'apigateway/apis': [{ id: 'try-it', label: 'Try it', Component: HttpApiTryIt }],
}
