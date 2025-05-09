# Testing Notes

## Database Setup

Due to limitations with Deno, we use the following approach:

- All tests share a single test database
- Database is reset before each test using `setup.ts`

## Important: New Migrations

**When adding new migrations**:
1. You MUST manually add them to the migrations array in `/supabase/functions/tests/setup.ts`
2. Failure to do this will result in tests running against an outdated schema

Example:
```typescript
// In setup.ts
const migrationFiles = [
  // Existing migrations...
  '../../migrations/20250507070855_add_label_id_to_campaigns.sql',
  '../../migrations/20250510123456_your_new_migration.sql', // Add here
]
```
