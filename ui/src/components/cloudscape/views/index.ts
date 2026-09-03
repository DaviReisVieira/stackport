import type { ComponentType } from 'react'
import { CloudscapeDynamoDBBrowser } from './DynamoDBBrowser'
import { CloudscapeEC2Browser } from './EC2Browser'
import { CloudscapeIAMBrowser } from './IAMBrowser'
import { CloudscapeLambdaBrowser } from './LambdaBrowser'
import { CloudscapeRDSBrowser } from './RDSBrowser'
import { CloudscapeS3Browser } from './S3Browser'
import { CloudscapeSecretsManagerBrowser } from './SecretsManagerBrowser'
import { CloudscapeSQSBrowser } from './SQSBrowser'

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
  rds: CloudscapeRDSBrowser,
  s3: CloudscapeS3Browser,
  secretsmanager: CloudscapeSecretsManagerBrowser,
  sqs: CloudscapeSQSBrowser,
}
