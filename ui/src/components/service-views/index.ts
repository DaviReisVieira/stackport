/**
 * Service-specific browser views registry.
 *
 * To add a custom browser for a new service:
 * 1. Create `src/components/service-views/MyServiceBrowser.tsx`
 *    - Export a default or named component with no required props
 *    - Use dedicated API endpoints from `src/lib/api.ts`
 * 2. Add the corresponding API endpoint in `backend/routes/`
 * 3. Register it here by adding to SERVICE_VIEWS
 */
import type { ComponentType } from 'react'
import { S3Browser } from './S3Browser'
import { DynamoDBBrowser } from './DynamoDBBrowser'
import { LambdaBrowser } from './LambdaBrowser'

export const SERVICE_VIEWS: Record<string, ComponentType> = {
  s3: S3Browser,
  dynamodb: DynamoDBBrowser,
  lambda: LambdaBrowser,
}
