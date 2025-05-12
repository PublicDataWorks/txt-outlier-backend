import { User, users } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'

export async function createUser(overrides: Partial<User> = {}): Promise<User> {
  const userData: User = {
    id: crypto.randomUUID(),
    name: `Test User ${Date.now()}`,
    email: `test-${Date.now()}@example.com`,
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }

  await supabase.insert(users).values(userData)
  return userData
}
