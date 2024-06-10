import { LookupHistory, lookupHistory } from '../../drizzle/schema.ts'
import supabase from '../../lib/supabase.ts'
import { faker } from 'faker'


export const createDataLookup = async (times = 1, updatedData: Partial<LookupHistory> = {}) => {
  const newDataLookups = []
  for (let i = 0; i < times; i++) {
    const dataLookup = {
      createdAt: new Date().toISOString(),
      address: faker.address.streetAddress(false),
      taxStatus: 'OK',
      rentalStatus: 'UNREGISTERED',
      zipCode: faker.address.zipCodeByState('MI'),
    }
    newDataLookups.push({ ...dataLookup, ...updatedData })
  }

  return await supabase.insert(lookupHistory).values(newDataLookups).returning()
}
