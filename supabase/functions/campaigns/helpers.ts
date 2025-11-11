import { createClient } from 'jsr:@supabase/supabase-js@2'

import supabase from '../_shared/lib/supabase.ts'
import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import { authors, campaignFileRecipients, campaigns, labels } from '../_shared/drizzle/schema.ts'
import {
  FileBasedCampaign,
  formatCampaignSelect,
  FormattedCampaign,
  SegmentBasedCampaign,
  SegmentConfig,
  UpdateCampaignData,
} from './dto.ts'
import BadRequestError from '../_shared/exception/BadRequestError.ts'
import labelService from './labelService.ts'
import DubLinkShortener from '../_shared/lib/DubLinkShortener.ts'

const RECIPIENT_FILE_BUCKET_NAME = 'campaign-recipients'

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

  const labelIds = []
  if (campaignData.campaignLabelName) {
    const customLabelId = await labelService.getLabelIdFromName(campaignData.campaignLabelName)
    if (customLabelId) labelIds.push(customLabelId)
  }

  const recipientCountResult = await supabase.execute(sql`
    SELECT get_campaign_recipient_count(${campaignData.segments}::jsonb) as recipient_count
  `)

  const recipientCount = recipientCountResult[0]?.recipient_count || 0

  const [newCampaign] = await supabase
    .insert(campaigns)
    .values({
      title: campaignData.title,
      firstMessage: campaignData.firstMessage,
      secondMessage: campaignData.secondMessage,
      runAt: campaignData.runAt,
      delay: campaignData.delay,
      segments: sql`${campaignData.segments}::jsonb`,
      recipientCount,
      labelIds,
    })
    .returning(formatCampaignSelect)

  await processCampaignMessages(newCampaign)
  return newCampaign
}

export const handleFileBasedCampaignCreate = async (campaignData: FileBasedCampaign, file: File) => {
  const phoneNumbers = await processPhoneNumberFile(file)

  const labelIds = [Deno.env.get('SHARED_CSV_CAMPAIGN_LABEL_ID')!]
  if (campaignData.campaignLabelName) {
    const customLabelId = await labelService.getLabelIdFromName(campaignData.campaignLabelName)
    if (customLabelId) labelIds.push(customLabelId)
  }

  const newCampaign = await supabase.transaction(async (tx) => {
    await tx
      .insert(authors)
      .values(phoneNumbers.map((phone) => ({ phoneNumber: phone, addedViaFileUpload: true })))
      .onConflictDoNothing()

    const [campaign] = await tx
      .insert(campaigns)
      .values({
        title: campaignData.title,
        firstMessage: campaignData.firstMessage,
        secondMessage: campaignData.secondMessage,
        runAt: campaignData.runAt,
        delay: campaignData.delay,
        segments: null,
        recipientCount: phoneNumbers.length,
        labelIds,
      })
      .returning(formatCampaignSelect)

    await tx
      .insert(campaignFileRecipients)
      .values(
        phoneNumbers.map((phone) => ({
          phoneNumber: phone,
          campaignId: campaign.id,
        })),
      )

    return campaign
  })

  await processCampaignMessages(newCampaign)

  // If this fails, the campaign is still created, just without the file URL
  try {
    const recipientFileUrl = await uploadRecipientFile(file, newCampaign.id)
    await supabase
      .update(campaigns)
      .set({ recipientFileUrl })
      .where(eq(campaigns.id, newCampaign.id))
  } catch (error) {
    console.error(`Failed to upload recipient file for campaign ${newCampaign.id}:`, error)
  }

  return newCampaign
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

export const handleSegmentBasedCampaignUpdate = async (
  campaignId: number,
  campaignData: UpdateCampaignData,
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

    const [updatedCampaign] = await supabase
      .update(campaigns)
      .set({
        title: campaignData.title,
        firstMessage: campaignData.firstMessage,
        secondMessage: campaignData.secondMessage,
        runAt: campaignData.runAt,
        delay: campaignData.delay,
        segments,
        recipientCount,
        recipientFileUrl: null,
      })
      .where(and(eq(campaigns.id, campaignId), gt(campaigns.runAt, new Date())))
      .returning(formatCampaignSelect)

    if (!updatedCampaign) {
      throw new BadRequestError('Campaign not found or cannot be edited')
    }
    if (campaignData.firstMessage || campaignData.secondMessage) {
      await processCampaignMessages(updatedCampaign, !!campaignData.firstMessage, !!campaignData.secondMessage)
    }

    await supabase
      .delete(campaignFileRecipients)
      .where(eq(campaignFileRecipients.campaignId, campaignId))

    return updatedCampaign
  } else {
    const [updatedCampaign] = await supabase
      .update(campaigns)
      .set({
        title: campaignData.title,
        firstMessage: campaignData.firstMessage,
        secondMessage: campaignData.secondMessage,
        runAt: campaignData.runAt,
        delay: campaignData.delay,
      })
      .where(and(eq(campaigns.id, campaignId), gt(campaigns.runAt, new Date())))
      .returning(formatCampaignSelect)

    if (!updatedCampaign) {
      throw new BadRequestError('Campaign not found or cannot be edited')
    }

    if (campaignData.firstMessage || campaignData.secondMessage) {
      await processCampaignMessages(updatedCampaign, !!campaignData.firstMessage, !!campaignData.secondMessage)
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
  campaignLabelName: formData.get('campaignLabelName')?.toString(),
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
    .from(RECIPIENT_FILE_BUCKET_NAME)
    .upload(fileName, file, { upsert: true })

  if (error) {
    console.error('Error uploading file:', error)
    throw new BadRequestError(`Failed to upload file: ${error.message}`)
  }
  const { data: { publicUrl } } = supabaseClient.storage
    .from(RECIPIENT_FILE_BUCKET_NAME)
    .getPublicUrl(fileName)
  return publicUrl
}

export async function deleteRecipientFile(fileUrl: string) {
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const url = new URL(fileUrl)
  const pathParts = url.pathname.split('/')
  const fileName = pathParts[pathParts.length - 1]

  const { error } = await supabaseClient.storage
    .from(RECIPIENT_FILE_BUCKET_NAME)
    .remove([fileName])

  if (error) {
    console.error('Error deleting file:', error)
  }
}

async function processCampaignMessages(campaign: FormattedCampaign, newFirstMessage = true, newSecondMessage = true) {
  let [processedFirstMessage, firstMessageChanged] = ['', false]
  if (newFirstMessage) {
    ;[processedFirstMessage, firstMessageChanged] = await DubLinkShortener.shortenLinksInMessage(
      campaign.firstMessage,
      campaign.id!,
    )
  }

  let [processedSecondMessage, secondMessageChanged] = ['', false]
  if (newSecondMessage && campaign.secondMessage) {
    ;[processedSecondMessage, secondMessageChanged] = await DubLinkShortener.shortenLinksInMessage(
      campaign.secondMessage,
      campaign.id,
    )
  }

  if (firstMessageChanged || secondMessageChanged) {
    const updatedFields = {
      firstMessage: firstMessageChanged ? processedFirstMessage : undefined,
      secondMessage: secondMessageChanged ? processedSecondMessage : undefined,
    }

    await supabase
      .update(campaigns)
      .set(updatedFields)
      .where(eq(campaigns.id, campaign.id))

    campaign.firstMessage = updatedFields.firstMessage || campaign.firstMessage
    campaign.secondMessage = updatedFields.secondMessage || campaign.secondMessage
  }

  return campaign
}
