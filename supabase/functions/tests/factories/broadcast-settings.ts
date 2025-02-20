// factories/broadcast-settings.ts
import { faker } from 'faker'
import supabase from '../../_shared/lib/supabase.ts'
import { broadcastSettings } from '../../_shared/drizzle/schema.ts'

type CreateBroadcastSettingParams = {
  mon?: string | null
  tue?: string | null
  wed?: string | null
  thu?: string | null
  fri?: string | null
  sat?: string | null
  sun?: string | null
  active?: boolean
}

export const createBroadcastSetting = async (params: CreateBroadcastSettingParams = {}) => {
  const broadcastSetting = {
    mon: params.mon,
    tue: params.tue,
    wed: params.wed,
    thu: params.thu,
    fri: params.fri,
    sat: params.sat,
    sun: params.sun,
    active: params.active ?? true,
  }

  const [result] = await supabase
    .insert(broadcastSettings)
    .values(broadcastSetting)
    .returning()

  return result
}
