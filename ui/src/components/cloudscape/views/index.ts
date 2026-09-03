import type { ComponentType } from 'react'
import { CloudscapeDynamoDBBrowser } from './DynamoDBBrowser'
import { CloudscapeIAMBrowser } from './IAMBrowser'
import { CloudscapeLambdaBrowser } from './LambdaBrowser'
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
  iam: CloudscapeIAMBrowser,
  lambda: CloudscapeLambdaBrowser,
  secretsmanager: CloudscapeSecretsManagerBrowser,
  sqs: CloudscapeSQSBrowser,
}
