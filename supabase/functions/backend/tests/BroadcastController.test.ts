import { describe, it } from 'https://deno.land/std@0.210.0/testing/bdd.ts'
import { createBroadcast } from './fixtures/broadcast.ts'
import { createSegment } from './fixtures/segment.ts'
import { req, supabaseInTest } from './utils.ts'
import { broadcasts, outgoingMessages } from '../drizzle/schema.ts'
import { createTwilioMessages } from './fixtures/twilioMessage.ts'
import { assert, assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts'

describe(
	'Broadcast',
	{ sanitizeOps: false, sanitizeResources: false },
	() => {
		it('make', async () => {
			const broadcast = await createBroadcast(60)
			let results = await supabaseInTest.select().from(broadcasts)
			assert(results[0].editable)

			await createSegment(1, broadcast.id)
			await createTwilioMessages(30)
			await req(`broadcasts/make`)

			results = await supabaseInTest.select().from(outgoingMessages)
			assertEquals(results.length, 24)

			results = await supabaseInTest.select().from(broadcasts)
			assert(!results[0].editable)
		})

		it('make with multiple segments', async () => {
			const broadcast = await createBroadcast(60)
			await createSegment(2, broadcast.id)
			await createTwilioMessages(30)
			await req(`broadcasts/make`)

			const results = await supabaseInTest.select().from(outgoingMessages)
			assertEquals(results.length, 48)
		})

		it('next broadcast not found', async () => {
			await req(`broadcasts/make`)
			const results = await supabaseInTest.select().from(outgoingMessages)
			assertEquals(results.length, 0)
		})

		it('next broadcast not available', async () => {
			const broadcast = await createBroadcast(
				60,
				new Date(Date.now() + 25 * 60 * 60 * 1000),
			)
			await createSegment(1, broadcast.id)
			await createTwilioMessages(30)

			await req(`broadcasts/make`)
			const results = await supabaseInTest.select().from(outgoingMessages)
			assertEquals(results.length, 0)
		})
	},
)
