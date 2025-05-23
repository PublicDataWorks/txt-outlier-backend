import { labels } from '../_shared/drizzle/schema.ts'
import { sql } from 'drizzle-orm'
import supabase from '../_shared/lib/supabase.ts'
import Missive from '../_shared/lib/Missive.ts'

/**
 * Gets or creates a label with the given name and returns its ID.
 * If successful, returns the label ID.
 * If unsuccessful for any reason, returns undefined.
 */
const getLabelIdFromName = async (campaignLabelName?: string | null): Promise<string | undefined> => {
  campaignLabelName = campaignLabelName?.toLowerCase()?.trim()
  if (!campaignLabelName) return

  // First, check our database
  const dbLabel = await findLabelInDatabase(campaignLabelName)
  if (dbLabel) {
    console.log(`Label found in database: ${campaignLabelName} ${dbLabel.id}`)
    return dbLabel.id
  }

  // Not in database - try to create it in Missive
  try {
    // Try to create the label
    const labelId = await Missive.createLabel(campaignLabelName, Deno.env.get('PARENT_CAMPAIGN_LABEL_ID')!)
    if (labelId) {
      // Successfully created the label
      console.log(`Label created in Missive: ${campaignLabelName} ${labelId}`)
      return labelId
    }

    // Creation failed, label might already exist
    const existingLabelId = await Missive.findLabelByName(campaignLabelName)
    if (existingLabelId) {
      console.log(`Label found in Missive: ${campaignLabelName} ${existingLabelId}`)
      return existingLabelId
    }
  } catch (error) {
    console.error(`Error handling label: ${error.message}`)
  }
}

const findLabelInDatabase = async (name: string) => {
  // Use case-insensitive search with TRIM to handle whitespace
  const [label] = await supabase
    .select({ id: labels.id })
    .from(labels)
    .where(sql`LOWER(TRIM(${labels.name})) = ${name}`)
    .limit(1)

  return label
}

export default {
  getLabelIdFromName,
  findLabelInDatabase,
}
