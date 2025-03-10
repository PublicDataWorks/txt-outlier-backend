import supabase from '../_shared/lib/supabase.ts'
import { inArray, sql } from 'drizzle-orm'
import { campaigns, fileRecipients, labels } from '../_shared/drizzle/schema.ts'
import {
  FileBasedCampaign,
  formatCampaignSelect,
  SegmentBasedCampaign,
  SegmentConfig,
} from './dto.ts'

const getAllSegmentIds = (config: SegmentConfig): string[] => {
  if (!Array.isArray(config)) {
    return [config.id]
  }

  return config.flatMap((item) => {
    if (Array.isArray(item)) {
      return item.map((segment) => segment.id)
    }
    return [item.id]
  })
}

export const validateSegments = async (
  included?: SegmentConfig | null,
  excluded?: SegmentConfig | null,
): Promise<boolean> => {
  const includedIds = included ? getAllSegmentIds(included) : []
  const excludedIds = excluded ? getAllSegmentIds(excluded) : []
  const allIds = new Set([...includedIds, ...excludedIds])

  if (allIds.size === 0) {
    return true
  }

  const existingSegments = await supabase
    .select({ id: labels.id })
    .from(labels)
    .where(inArray(labels.id, Array.from(allIds)))

  return existingSegments.length === allIds.size
}

export const handleSegmentBasedCampaign = async (campaignData: SegmentBasedCampaign) => {
  try {
    const segmentsValid = await validateSegments(campaignData.segments.included, campaignData.segments.excluded)

    if (!segmentsValid) {
      return { campaign: null, error: 'One or more segment IDs are invalid' }
    }

    // Get recipient count
    const recipientCountResult = await supabase.execute(sql`
      SELECT get_campaign_recipient_count(${campaignData.segments}::jsonb) as recipient_count
    `)

    const recipientCount = recipientCountResult[0]?.recipient_count || 0

    // Create the campaign
    const [newCampaign] = await supabase
      .insert(campaigns)
      .values({
        ...campaignData,
        segments: sql`${campaignData.segments}::jsonb`,
        recipientCount,
      })
      .returning(formatCampaignSelect)

    return { campaign: newCampaign }
  } catch (error) {
    console.error('Error processing segment-based campaign:', error)
    return { campaign: null, error: error.message || 'Error processing segment-based campaign' }
  }
}

export const parseFileBasedFormData = (formData: FormData) => {
  return {
    title: formData.get('title')?.toString(),
    firstMessage: formData.get('firstMessage')?.toString(),
    secondMessage: formData.get('secondMessage')?.toString(),
    runAt: formData.get('runAt') ? Number(formData.get('runAt')) : undefined,
    delay: formData.get('delay') ? Number(formData.get('delay')) : undefined,
  }
}

export const handleFileBasedCampaign = async (campaignData: FileBasedCampaign, file: File) => {
  // Process the file to extract phone numbers - this will throw if invalid
  const phoneNumbers = await processPhoneNumberFile(file)
  console.log('Phone numbers:', phoneNumbers)

  // Mock file URL for now
  const fileUrl = 'await uploadFileToS3(file);'
  return await supabase.transaction(async (tx) => {
    const [newCampaign] = await tx
      .insert(campaigns)
      .values({
        title: campaignData.title,
        firstMessage: campaignData.firstMessage,
        secondMessage: campaignData.secondMessage,
        runAt: campaignData.runAt,
        delay: campaignData.delay,
        segments: null,
        fileUrl,
        recipientCount: phoneNumbers.length,
      })
      .returning(formatCampaignSelect)
    await tx
      .insert(fileRecipients)
      .values(
        phoneNumbers.map((phone) => ({
          phoneNumber: phone,
          campaignId: newCampaign.id,
        })),
      )
    return newCampaign
  })
}

async function processPhoneNumberFile(file: File): Promise<string[]> {
  if (!file.name.endsWith('.csv') && file.type !== 'text/csv' && file.type !== 'application/vnd.ms-excel') {
    throw new Error('Please upload a CSV file with phone numbers')
  }

  const content = await file.text()
  const phoneNumbers = content.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((number) => number.replace(/[\s\-\(\)\.]/g, ''))

  if (phoneNumbers.length === 0) {
    throw new Error('No phone numbers found in the CSV file')
  }

  return phoneNumbers
}
