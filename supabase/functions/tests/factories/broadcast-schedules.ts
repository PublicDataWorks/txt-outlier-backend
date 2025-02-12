// factories/broadcastSchedule.ts
import { faker } from 'faker'
import { broadcastSchedules } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'

type CreateBroadcastScheduleParams = {
  mon?: string | null
  tue?: string | null
  wed?: string | null
  thu?: string | null
  fri?: string | null
  sat?: string | null
  sun?: string | null
  active?: boolean
}

const generateRandomTime = (): string => {
  const hours = faker.datatype.number({ min: 0, max: 23 })
  const minutes = faker.datatype.number({ min: 0, max: 59 })
  const seconds = faker.datatype.number({ min: 0, max: 59 })

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

export const createBroadcastSchedule = async (params: CreateBroadcastScheduleParams = {}) => {
  const broadcastSchedule = {
    mon: params.mon ?? generateRandomTime(),
    tue: params.tue ?? generateRandomTime(),
    wed: params.wed ?? generateRandomTime(),
    thu: params.thu ?? generateRandomTime(),
    fri: params.fri ?? generateRandomTime(),
    sat: params.sat ?? generateRandomTime(),
    sun: params.sun ?? generateRandomTime(),
    active: params.active ?? true,
  }

  const [result] = await supabase
    .insert(broadcastSchedules)
    .values(broadcastSchedule)
    .returning()

  return result
}

export const createBroadcastSchedules = async (times = 1) => {
  const newSchedules = Array.from({ length: times }, () => ({
    mon: generateRandomTime(),
    tue: generateRandomTime(),
    wed: generateRandomTime(),
    thu: generateRandomTime(),
    fri: generateRandomTime(),
    sat: generateRandomTime(),
    sun: generateRandomTime(),
    active: true,
  }))

  return supabase
    .insert(broadcastSchedules)
    .values(newSchedules)
    .returning()
}
