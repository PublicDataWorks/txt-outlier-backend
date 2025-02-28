// author.ts
import { faker } from 'faker'
import { authors } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'

type AuthorOptions = {
  unsubscribed: boolean
  exclude: boolean
}

export const createAuthor = async (
  phoneNumber?: string,
  options: AuthorOptions = { unsubscribed: false, exclude: false },
) => {
  const [result] = await supabase
    .insert(authors)
    .values({
      phoneNumber: phoneNumber || faker.phone.phoneNumber(),
      unsubscribed: options.unsubscribed,
      exclude: options.exclude,
    })
    .onConflictDoNothing()
    .returning()

  return result
}

// Keep the original function for backward compatibility
export const createAuthors = async (times = 1, number?: string) => {
  const newAuthors = Array.from({ length: times }, () => ({
    phoneNumber: number || faker.phone.phoneNumber(),
    unsubscribed: false,
    exclude: false,
  }))

  return supabase
    .insert(authors)
    .values(newAuthors)
    .onConflictDoNothing()
    .returning()
}
