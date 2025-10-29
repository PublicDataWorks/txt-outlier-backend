#!/usr/bin/env -S deno run --allow-env --allow-net

import { Dub } from 'npm:dub'

const DUB_API_KEY = Deno.env.get('DUB_API_KEY')

if (!DUB_API_KEY) {
  console.error('❌ DUB_API_KEY environment variable not set')
  Deno.exit(1)
}

const dub = new Dub({ token: DUB_API_KEY })

console.log('🔍 Testing Dub.co Integration...\n')

// Test 1: List tags
console.log('Test 1: Listing tags...')
try {
  const tags = await dub.tags.list()
  console.log(`✅ Successfully listed ${tags.length} tags`)
  console.log(`   Sample tags: ${tags.slice(0, 3).map(t => t.name).join(', ')}\n`)
} catch (error) {
  console.error(`❌ Failed to list tags:`, error.message)
  console.error(`   Status: ${error.status}`)
  console.error(`   Details: ${JSON.stringify(error, null, 2)}\n`)
}

// Test 2: Create a test tag
const testTagName = `test-${Date.now()}`
console.log(`Test 2: Creating test tag '${testTagName}'...`)
try {
  const tag = await dub.tags.create({ name: testTagName })
  console.log(`✅ Successfully created tag: ${tag.name}\n`)
} catch (error) {
  console.error(`❌ Failed to create tag:`, error.message)
  console.error(`   Status: ${error.status}`)
  console.error(`   Details: ${JSON.stringify(error, null, 2)}\n`)
}

// Test 3: Create a test shortened link
console.log('Test 3: Creating a test shortened link...')
try {
  const link = await dub.links.createMany([{
    url: 'https://example.com/test',
    tagNames: [testTagName],
  }])
  console.log(`✅ Successfully created link:`, link)
  console.log(`   Short URL: ${link[0]?.shortLink}\n`)
} catch (error) {
  console.error(`❌ Failed to create link:`, error.message)
  console.error(`   Status: ${error.status}`)
  console.error(`   Response: ${error.response}`)
  console.error(`   Details: ${JSON.stringify(error, null, 2)}\n`)
}

// Test 4: List links with tag
console.log(`Test 4: Listing links with tag '${testTagName}'...`)
try {
  const linksResponse = await dub.links.list({ tagNames: [testTagName] })
  console.log(`✅ Successfully listed links:`, linksResponse.result.length)
  console.log(`   Links: ${JSON.stringify(linksResponse.result, null, 2)}\n`)
} catch (error) {
  console.error(`❌ Failed to list links:`, error.message)
  console.error(`   Status: ${error.status}`)
  console.error(`   Details: ${JSON.stringify(error, null, 2)}\n`)
}

console.log('✨ Test complete!')
