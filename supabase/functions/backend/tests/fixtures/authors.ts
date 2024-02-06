import { faker } from 'https://deno.land/x/deno_faker@v1.0.3/mod.ts'
import { authors } from '../../drizzle/schema.ts'
import supabase from '../../lib/supabase.ts'

const createAuthors = (times = 1) => {
  const newAuthors = []
  for (let i = 0; i < times; i++) {
    const author = {
      phoneNumber: faker.phone.phoneNumber(),
    }
    newAuthors.push(author)
  }
  return supabase.insert(authors).values(newAuthors).onConflictDoNothing()
    .returning()
}

export { createAuthors }
