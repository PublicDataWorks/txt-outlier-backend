import { conversations, conversationsLabels, Label, labels } from '../../drizzle/schema.ts'
import supabase from '../../lib/supabase.ts'
import { faker } from 'faker'

export const createLabels = async (times = 1, labelOverrides: Partial<Label> = {}) => {
  const newLabels = []

  for (let i = 0; i < times; i++) {
    const label = {
      id: faker.random.uuid(),
      createdAt: new Date().toISOString(),
      name: `Label ${faker.random.uuid()}`,
      nameWithParentNames: `Label ${faker.random.uuid()}`,
      ...labelOverrides,
    }
    newLabels.push(label)
  }

  return supabase.insert(labels).values(newLabels).returning()
}
