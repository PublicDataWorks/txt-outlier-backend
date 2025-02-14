// factories/broadcast-settings.ts
import { faker } from 'faker'
import supabase from '../../_shared/lib/supabase.ts'
import { broadcastSettings } from '../../_shared/drizzle/schema.ts';

type CreateBroadcastSettingParams = {
  mon?: string | null
  tue?: string | null
  wed?: string | null
  thu?: string | null
  fri?: string | null
  sat?: string | null
  sun?: string | null
  active?: boolean
  batchSize?: number
}

const generateRandomTime = (): string => {
  const hours = faker.datatype.number({ min: 0, max: 23 })
  const minutes = faker.datatype.number({ min: 0, max: 59 })
  const seconds = faker.datatype.number({ min: 0, max: 59 })

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

export const createBroadcastSetting = async (params: CreateBroadcastSettingParams = {}) => {
  const broadcastSetting = {
    mon: params.mon ?? generateRandomTime(),
    tue: params.tue ?? generateRandomTime(),
    wed: params.wed ?? generateRandomTime(),
    thu: params.thu ?? generateRandomTime(),
    fri: params.fri ?? generateRandomTime(),
    sat: params.sat ?? generateRandomTime(),
    sun: params.sun ?? generateRandomTime(),
    active: params.active ?? true,
    batchSize: params?.batchSize || 100,
  }

  const [result] = await supabase
    .insert(broadcastSettings)
    .values(broadcastSetting)
    .returning()

  return result
}
