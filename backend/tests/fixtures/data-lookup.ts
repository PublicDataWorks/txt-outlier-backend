import { DataLookup, dataLookup } from '../../drizzle/schema.ts'
import supabase from '../../lib/supabase.ts'
import { faker } from 'faker'

let idCounter = 1

export const createDataLookup = async (times = 1, updatedData: Partial<DataLookup> = {}) => {
  const newDataLookups = []
  for (let i = 0; i < times; i++) {
    const dataLookup = {
      id: idCounter++,
      createdAt: new Date().toISOString(),
      address: faker.address.streetAddress(false),
      taxStatus: 'OK',
      rentalStatus: 'UNREGISTERED',
      zipCode: faker.address.zipCodeByState('MI'),
    }
    newDataLookups.push({ ...dataLookup, ...updatedData })
  }

  return await supabase.insert(dataLookup).values(newDataLookups).returning()
}
