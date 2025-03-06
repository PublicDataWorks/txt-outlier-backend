// factories/label.ts
import { faker } from 'faker'
import { labels } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'

const COLORS = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF']

export type CreateLabelParams = {
  name?: string
  nameWithParentNames?: string
  color?: string
  parent?: string | null
  shareWithOrganization?: boolean
  visibility?: 'organization' | 'private'
}

export const createLabel = async ({
  name,
  nameWithParentNames,
  color,
  parent = null,
  shareWithOrganization = false,
  visibility = 'organization',
}: CreateLabelParams = {}) => {
  const labelName = name || `Label ${faker.random.alphaNumeric(3).toUpperCase()}`

  const label = {
    id: crypto.randomUUID(),
    name: labelName,
    nameWithParentNames: nameWithParentNames || labelName,
    color: color || COLORS[Math.floor(Math.random() * COLORS.length)],
    parent,
    shareWithOrganization,
    visibility,
  }

  const [result] = await supabase
    .insert(labels)
    .values(label)
    .returning()

  return result
}
