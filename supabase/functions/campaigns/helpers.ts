import { createClient } from 'jsr:@supabase/supabase-js@2'

import supabase from '../_shared/lib/supabase.ts'
import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import { authors, campaignFileRecipients, campaigns, labels } from '../_shared/drizzle/schema.ts'
import { FileBasedCampaign, formatCampaignSelect, SegmentBasedCampaign, SegmentConfig } from './dto.ts'
import BadRequestError from '../_shared/exception/BadRequestError.ts'

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

export const handleSegmentBasedCampaignCreate = async (campaignData: SegmentBasedCampaign) => {
  const segmentsValid = await validateSegments(campaignData.segments.included, campaignData.segments.excluded)
  if (!segmentsValid) {
    throw new BadRequestError('One or more segment IDs are invalid')
  }

  const recipientCountResult = await supabase.execute(sql`
    SELECT get_campaign_recipient_count(${campaignData.segments}::jsonb) as recipient_count
  `)

  const recipientCount = recipientCountResult[0]?.recipient_count || 0
  const [newCampaign] = await supabase
    .insert(campaigns)
    .values({
      ...campaignData,
      segments: sql`${campaignData.segments}::jsonb`,
      recipientCount,
    })
    .returning(formatCampaignSelect)

  return newCampaign
}

export const handleFileBasedCampaignCreate = async (campaignData: FileBasedCampaign, file: File) => {
  const phoneNumbers = await processPhoneNumberFile(file)

  return await supabase.transaction(async (tx) => {
    await tx
      .insert(authors)
      .values(phoneNumbers.map((phone) => ({ phoneNumber: phone, addedViaFileUpload: true })))
      .onConflictDoNothing()

    const [newCampaign] = await tx
      .insert(campaigns)
      .values({
        title: campaignData.title,
        firstMessage: campaignData.firstMessage,
        secondMessage: campaignData.secondMessage,
        runAt: campaignData.runAt,
        delay: campaignData.delay,
        segments: null,
        recipientCount: phoneNumbers.length,
      })
      .returning(formatCampaignSelect)
    await tx
      .insert(campaignFileRecipients)
      .values(
        phoneNumbers.map((phone) => ({
          phoneNumber: phone,
          campaignId: newCampaign.id,
        })),
      )
    const recipientFileUrl = await uploadRecipientFile(file, newCampaign.id)
    await tx
      .update(campaigns)
      .set({ recipientFileUrl })
      .where(eq(campaigns.id, newCampaign.id))
    return newCampaign
  })
}

async function processPhoneNumberFile(file: File): Promise<string[]> {
  if (!file.name.endsWith('.csv') && file.type !== 'text/csv' && file.type !== 'application/vnd.ms-excel') {
    throw new BadRequestError('Please upload a CSV file with phone numbers')
  }

  const content = await file.text()
  const phoneNumbers = content.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((number) => number.replace(/[\s\-\(\)\.]/g, ''))

  if (phoneNumbers.length === 0) {
    throw new BadRequestError('No phone numbers found in the CSV file')
  }

  return phoneNumbers
}

export const handleFileBasedCampaignUpdate = async (
  campaignId: number,
  campaignData: Partial<FileBasedCampaign>,
  file: File,
) => {
  const phoneNumbers = await processPhoneNumberFile(file)
  return await supabase.transaction(async (tx) => {
    await tx
      .insert(authors)
      .values(phoneNumbers.map((phone) => ({ phoneNumber: phone, addedViaFileUpload: true })))
      .onConflictDoNothing({ target: authors.phoneNumber })
    const recipientFileUrl = await uploadRecipientFile(file, campaignId)
    const [updatedCampaign] = await tx
      .update(campaigns)
      .set({
        ...campaignData,
        segments: null,
        recipientCount: phoneNumbers.length,
        recipientFileUrl,
      })
      .where(and(eq(campaigns.id, campaignId), gt(campaigns.runAt, new Date())))
      .returning(formatCampaignSelect)

    if (!updatedCampaign) {
      throw new BadRequestError('Campaign not found or cannot be edited')
    }

    await tx
      .delete(campaignFileRecipients)
      .where(eq(campaignFileRecipients.campaignId, campaignId))

    await tx
      .insert(campaignFileRecipients)
      .values(
        phoneNumbers.map((phone) => ({
          phoneNumber: phone,
          campaignId: campaignId,
        })),
      )

    return updatedCampaign
  })
}

export const handleSegmentBasedCampaignUpdate = async (
  campaignId: number,
  campaignData: Partial<SegmentBasedCampaign>,
) => {
  if (campaignData.segments) {
    const segmentsValid = await validateSegments(
      campaignData.segments.included,
      campaignData.segments.excluded,
    )

    if (!segmentsValid) {
      throw new BadRequestError('One or more segment IDs are invalid')
    }

    const segments = sql`${campaignData.segments}::jsonb`
    const recipientCountResult = await supabase.execute(sql`
      SELECT get_campaign_recipient_count(${segments}::jsonb) as recipient_count
    `)

    const recipientCount = Number(recipientCountResult[0]?.recipient_count || 0)

    // Update the campaign with the segments and recipient count
    const [updatedCampaign] = await supabase
      .update(campaigns)
      .set({
        ...campaignData,
        segments,
        recipientCount,
        recipientFileUrl: null,
      })
      .where(and(eq(campaigns.id, campaignId), gt(campaigns.runAt, new Date())))
      .returning(formatCampaignSelect)

    if (!updatedCampaign) {
      throw new BadRequestError('Campaign not found or cannot be edited')
    }

    await supabase
      .delete(campaignFileRecipients)
      .where(eq(campaignFileRecipients.campaignId, campaignId))

    return updatedCampaign
  } else {
    const [updatedCampaign] = await supabase
      .update(campaigns)
      .set(campaignData)
      .where(and(eq(campaigns.id, campaignId), gt(campaigns.runAt, new Date())))
      .returning(formatCampaignSelect)

    if (!updatedCampaign) {
      throw new BadRequestError('Campaign not found or cannot be edited')
    }

    return updatedCampaign
  }
}

export const parseFileBasedFormData = (formData: FormData) => ({
  title: formData.get('title')?.toString(),
  firstMessage: formData.get('firstMessage')?.toString(),
  secondMessage: formData.get('secondMessage')?.toString(),
  runAt: formData.get('runAt') ? Number(formData.get('runAt')) : undefined,
  delay: formData.get('delay') ? Number(formData.get('delay')) : undefined,
})

async function uploadRecipientFile(file: File, campaignId: number) {
  let fileName = `campaign-${campaignId}`

  if (file.name.includes('.')) {
    const extension = file.name.split('.').pop()
    if (extension && extension.length > 0 && extension.length <= 10) {
      fileName += `.${extension}`
    }
  }
  const supabaseClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { error } = await supabaseClient.storage
    .from('campaign-recipients')
    .upload(fileName, file, { upsert: true })

  if (error) {
    console.error('Error uploading file:', error)
    throw new BadRequestError(`Failed to upload file: ${error.message}`)
  }
  const { data: { publicUrl } } = supabaseClient.storage
    .from('campaign-recipients')
    .getPublicUrl(fileName)
  return publicUrl
}
