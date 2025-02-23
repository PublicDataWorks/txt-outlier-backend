// author.ts
import { faker } from 'faker'
import { authors } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'

export const createAuthors = async (times = 1, number?: string) => {
  const newAuthors = Array.from({ length: times }, () => ({
    phoneNumber: number || faker.phone.phoneNumber(),
  }))

  return supabase
    .insert(authors)
    .values(newAuthors)
    .onConflictDoNothing()
    .returning()
}
