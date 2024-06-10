import { faker } from 'faker'
import { Author, authors } from '../../drizzle/schema.ts'
import supabase from '../../lib/supabase.ts'

const createAuthors = (times = 1, updatedData: Partial<Author>) => {
  const newAuthors = []
  for (let i = 0; i < times; i++) {
    const author = {
      phoneNumber: faker.phone.phoneNumber(),
    }
    newAuthors.push({ ...author, ...updatedData })
  }
  return supabase.insert(authors).values(newAuthors).onConflictDoNothing()
    .returning()
}

export { createAuthors }
