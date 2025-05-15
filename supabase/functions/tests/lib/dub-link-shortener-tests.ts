import { afterEach, beforeEach, describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import * as sinon from 'npm:sinon'

import '../setup.ts'

// Get the original module
import DubLinkShortener from '../../_shared/lib/DubLinkShortener.ts'

// Import the dubMock that's now directly exported from our mock file
import { dubMock } from '../_mock/dub.ts'

// Create a sandbox for managing all the stubs
const sandbox = sinon.createSandbox()

describe('DubLinkShortener', () => {
  beforeEach(() => {
    // Reset all stubs between tests
    sandbox.reset()

    // Mock console methods to avoid cluttering test output
    sandbox.stub(console, 'log')
    sandbox.stub(console, 'error')

    // Reset all mock methods to clear any previous test configurations
    Object.values(dubMock.tags).forEach((method) => {
      if (typeof method.reset === 'function') method.reset()
    })
    Object.values(dubMock.links).forEach((method) => {
      if (typeof method.reset === 'function') method.reset()
    })
  })

  afterEach(() => {
    // Restore all stubs
    sandbox.restore()
  })

  describe('shortenLinksInMessage', () => {
    it('should return the message unchanged when there are no URLs', async () => {
      // Setup
      const message = 'This is a message with no URLs'
      const broadcastId = 123

      // Run the test
      const [result, changed] = await DubLinkShortener.shortenLinksInMessage(message, broadcastId)

      // Verify results
      assertEquals(result, message)
      assertEquals(changed, false)
    })

    it('should create a tag for the broadcast if URLs are detected', async () => {
      // Setup - create test message with URL
      const message = 'Check out https://example.com for more information'
      const broadcastId = 123
      const tagName = `broadcast-${broadcastId}`

      // Setup stub responses
      dubMock.tags.list.withArgs({ search: tagName }).resolves([])
      dubMock.tags.create.withArgs({ name: tagName }).resolves({ id: 'tag1', name: tagName })
      dubMock.links.list.withArgs({ tagNames: [tagName] }).resolves({ result: [] })
      dubMock.links.createMany.resolves([{
        id: 'link1',
        url: 'https://example.com',
        shortLink: 'https://dub.sh/abc123',
        tagNames: [tagName],
      }])

      // Run the test
      const [result, changed] = await DubLinkShortener.shortenLinksInMessage(message, broadcastId)

      // Check that URL was replaced
      assertEquals(result, 'Check out https://dub.sh/abc123 for more information')
      assertEquals(changed, true)

      // Verify that the correct methods were called
      sinon.assert.calledWith(dubMock.tags.list, { search: tagName })
      sinon.assert.calledWith(dubMock.tags.create, { name: tagName })
      sinon.assert.calledWith(dubMock.links.list, { tagNames: [tagName] })
      sinon.assert.calledWith(dubMock.links.createMany, [{
        url: 'https://example.com',
        tagNames: [tagName],
      }])
    })

    it('should not create a tag if it already exists', async () => {
      // Setup
      const message = 'Check out https://example.com for more information'
      const broadcastId = 123
      const tagName = `broadcast-${broadcastId}`

      // Setup stub responses - tag already exists
      dubMock.tags.list.withArgs({ search: tagName }).resolves([
        { id: 'tag1', name: tagName },
      ])
      dubMock.links.list.withArgs({ tagNames: [tagName] }).resolves({ result: [] })
      dubMock.links.createMany.resolves([{
        id: 'link1',
        url: 'https://example.com',
        shortLink: 'https://dub.sh/abc123',
        tagNames: [tagName],
      }])

      // Run the test
      const [result, changed] = await DubLinkShortener.shortenLinksInMessage(message, broadcastId)

      // Check that URL was replaced
      assertEquals(result, 'Check out https://dub.sh/abc123 for more information')
      assertEquals(changed, true)

      // Verify tag.create was not called
      sinon.assert.calledWith(dubMock.tags.list, { search: tagName })
      sinon.assert.notCalled(dubMock.tags.create)
    })

    it('should use existing shortened links if available', async () => {
      // Setup
      const message = 'Check out https://example.com and https://example.org'
      const broadcastId = 123
      const tagName = `broadcast-${broadcastId}`

      // Setup stub responses - one link already exists
      dubMock.tags.list.withArgs({ search: tagName }).resolves([
        { id: 'tag1', name: tagName },
      ])

      // Setup existing links - only example.com has a shortened link
      dubMock.links.list.withArgs({ tagNames: [tagName] }).resolves({
        result: [{
          id: 'link1',
          url: 'https://example.com',
          shortLink: 'https://dub.sh/abc123',
          tagNames: [tagName],
        }],
      })

      // Setup createMany to return a new shortened link for example.org
      dubMock.links.createMany.resolves([{
        id: 'link2',
        url: 'https://example.org',
        shortLink: 'https://dub.sh/def456',
        tagNames: [tagName],
      }])

      // Run the test
      const [result, changed] = await DubLinkShortener.shortenLinksInMessage(message, broadcastId)

      // Both URLs should be replaced
      assertEquals(result, 'Check out https://dub.sh/abc123 and https://dub.sh/def456')
      assertEquals(changed, true)

      // Only the new URL should be sent for creation
      sinon.assert.calledWith(dubMock.links.createMany, [{
        url: 'https://example.org',
        tagNames: [tagName],
      }])

      // Verify createMany was called exactly once
      sinon.assert.calledOnce(dubMock.links.createMany)
    })

    it('should handle multiple occurrences of the same URL', async () => {
      // Setup
      const message = 'Check https://example.com here and https://example.com there'
      const broadcastId = 123
      const tagName = `broadcast-${broadcastId}`

      // Setup stub responses
      dubMock.tags.list.withArgs({ search: tagName }).resolves([
        { id: 'tag1', name: tagName },
      ])
      dubMock.links.list.withArgs({ tagNames: [tagName] }).resolves({ result: [] })
      dubMock.links.createMany.resolves([{
        id: 'link1',
        url: 'https://example.com',
        shortLink: 'https://dub.sh/abc123',
        tagNames: [tagName],
      }])

      // Run the test
      const [result, changed] = await DubLinkShortener.shortenLinksInMessage(message, broadcastId)

      // Both occurrences should be replaced
      assertEquals(result, 'Check https://dub.sh/abc123 here and https://dub.sh/abc123 there')
      assertEquals(changed, true)
      // Only one URL should be sent for creation (unique URLs)
      sinon.assert.calledOnce(dubMock.links.createMany)
    })

    it('should handle GitHub repository URLs correctly', async () => {
      // Setup
      const message = 'https://dub.sh/GhVrND3 https://github.com/PublicDataWorks/txt-outlier-backend/pull/85'
      const broadcastId = 123
      const tagName = `broadcast-${broadcastId}`

      // Setup stub responses
      dubMock.tags.list.withArgs({ search: tagName }).resolves([
        { id: 'tag1', name: tagName },
      ])
      dubMock.links.list.withArgs({ tagNames: [tagName] }).resolves({ result: [] })

      // Setup createMany to return shortened links for both URLs
      dubMock.links.createMany.resolves([
        {
          id: 'link1',
          url: 'https://dub.sh/GhVrND3',
          shortLink: 'https://dub.sh/short1',
          tagNames: [tagName],
        },
        {
          id: 'link2',
          url: 'https://github.com/PublicDataWorks/txt-outlier-backend/pull/85',
          shortLink: 'https://dub.sh/short2',
          tagNames: [tagName],
        },
      ])

      // Run the test
      const [result, changed] = await DubLinkShortener.shortenLinksInMessage(message, broadcastId)

      // Both URLs should be replaced
      assertEquals(result, 'https://dub.sh/GhVrND3 https://dub.sh/short2')
      assertEquals(changed, true)

      // Both URLs should be sent for creation
      sinon.assert.calledWith(dubMock.links.createMany, [
        { url: 'https://github.com/PublicDataWorks/txt-outlier-backend/pull/85', tagNames: [tagName] },
      ])
    })

    it('should properly handle URLs with trailing punctuation', async () => {
      // Setup
      const message = 'Check out https://example.com. Also visit https://example.org, and maybe https://example.net!'
      const broadcastId = 123
      const tagName = `broadcast-${broadcastId}`

      // Setup stub responses
      dubMock.tags.list.withArgs({ search: tagName }).resolves([
        { id: 'tag1', name: tagName },
      ])
      dubMock.links.list.withArgs({ tagNames: [tagName] }).resolves({ result: [] })

      // Setup createMany to return shortened links for all URLs
      dubMock.links.createMany.resolves([
        {
          id: 'link1',
          url: 'https://example.com',
          shortLink: 'https://dub.sh/abc123',
          tagNames: [tagName],
        },
        {
          id: 'link2',
          url: 'https://example.org',
          shortLink: 'https://dub.sh/def456',
          tagNames: [tagName],
        },
        {
          id: 'link3',
          url: 'https://example.net',
          shortLink: 'https://dub.sh/ghi789',
          tagNames: [tagName],
        },
      ])

      // Run the test
      const [result, changed] = await DubLinkShortener.shortenLinksInMessage(message, broadcastId)

      // URLs should be replaced while preserving punctuation
      assertEquals(
        result,
        'Check out https://dub.sh/abc123. Also visit https://dub.sh/def456, and maybe https://dub.sh/ghi789!',
      )
      assertEquals(changed, true)

      // Should call createMany once with all three URLs
      sinon.assert.calledWith(dubMock.links.createMany, [
        { url: 'https://example.com', tagNames: [tagName] },
        { url: 'https://example.org', tagNames: [tagName] },
        { url: 'https://example.net', tagNames: [tagName] },
      ])
    })

    it('should correctly identify and handle URLs with parentheses and other special punctuation', async () => {
      // Setup
      const message = 'See this page (https://example.com) and this too: https://example.org;'
      const broadcastId = 123
      const tagName = `broadcast-${broadcastId}`

      // Setup stub responses
      dubMock.tags.list.withArgs({ search: tagName }).resolves([
        { id: 'tag1', name: tagName },
      ])
      dubMock.links.list.withArgs({ tagNames: [tagName] }).resolves({ result: [] })

      // Setup createMany to return shortened links for all URLs
      dubMock.links.createMany.resolves([
        {
          id: 'link1',
          url: 'https://example.com',
          shortLink: 'https://dub.sh/abc123',
          tagNames: [tagName],
        },
        {
          id: 'link2',
          url: 'https://example.org',
          shortLink: 'https://dub.sh/def456',
          tagNames: [tagName],
        },
      ])

      // Run the test
      const [result, changed] = await DubLinkShortener.shortenLinksInMessage(message, broadcastId)

      // URLs should be replaced
      assertEquals(
        result,
        'See this page (https://dub.sh/abc123) and this too: https://dub.sh/def456;',
      )
      assertEquals(changed, true)

      // Verify createMany was called with both URLs
      sinon.assert.calledWith(dubMock.links.createMany, [
        { url: 'https://example.com', tagNames: [tagName] },
        { url: 'https://example.org', tagNames: [tagName] },
      ])
    })

    it('should handle URLs directly inside parentheses without spaces', async () => {
      // Setup
      const message = 'Check out this page (https://google.com) for more info'
      const broadcastId = 123
      const tagName = `broadcast-${broadcastId}`

      // Setup stub responses
      dubMock.tags.list.withArgs({ search: tagName }).resolves([
        { id: 'tag1', name: tagName },
      ])
      dubMock.links.list.withArgs({ tagNames: [tagName] }).resolves({ result: [] })

      // Setup createMany to return a shortened link
      dubMock.links.createMany.resolves([
        {
          id: 'link1',
          url: 'https://google.com',
          shortLink: 'https://dub.sh/goo123',
          tagNames: [tagName],
        },
      ])

      // Run the test
      const [result, changed] = await DubLinkShortener.shortenLinksInMessage(message, broadcastId)

      // URL inside parentheses should be replaced
      assertEquals(
        result,
        'Check out this page (https://dub.sh/goo123) for more info',
      )
      assertEquals(changed, true)

      // Verify createMany was called with the URL
      sinon.assert.calledWith(dubMock.links.createMany, [
        { url: 'https://google.com', tagNames: [tagName] },
      ])
    })

    it('should not shorten URLs that are already shortened', async () => {
      // Setup
      const message =
        'Check out https://bit.ly/abcdef and https://dub.sh/xyz and https://tinyurl.com/abc and https://goo.gl/abc123'
      const broadcastId = 123
      const tagName = `broadcast-${broadcastId}`

      // Setup stub responses
      dubMock.tags.list.withArgs({ search: tagName }).resolves([
        { id: 'tag1', name: tagName },
      ])
      dubMock.links.list.withArgs({ tagNames: [tagName] }).resolves({ result: [] })

      // Run the test
      const [result, changed] = await DubLinkShortener.shortenLinksInMessage(message, broadcastId)

      // The message should remain unchanged since all URLs are already shortened
      assertEquals(result, message)
      assertEquals(changed, false)

      // CreateMany should not be called since no URLs need shortening
      sinon.assert.notCalled(dubMock.links.createMany)
    })

    it('should handle error scenarios gracefully', async () => {
      // Setup
      const message = 'Check out https://example.com for more information'
      const broadcastId = 123

      // Setup stub to throw an error
      dubMock.tags.list.throws(new Error('API Error'))

      // Run the test
      const [result, changed] = await DubLinkShortener.shortenLinksInMessage(message, broadcastId)

      // Original message should be returned on error
      assertEquals(result, message)
      assertEquals(changed, false)

      // Error should be logged
      sinon.assert.called(console.error as sinon.SinonStub)
    })
  })
})
