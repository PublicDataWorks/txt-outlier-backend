import { describe, it, beforeEach, afterEach } from 'jsr:@std/testing/bdd'
import { assertEquals, assertNotEquals } from 'jsr:@std/assert'
import * as sinon from 'npm:sinon'

// Import the setup
import '../setup.ts'

// Get the original module
import DubLinkShortener from '../../_shared/lib/DubLinkShortener.ts'

// Import the dubMock that's now directly exported from our mock file
import { dubMock } from '../_mock/dub.ts'

// Create a sandbox for managing all the stubs
const sandbox = sinon.createSandbox();

describe('DubLinkShortener', () => {
  beforeEach(() => {
    // Reset all stubs between tests
    sandbox.reset();

    // Mock console methods to avoid cluttering test output
    sandbox.stub(console, 'log');
    sandbox.stub(console, 'error');

    // Reset all mock methods to clear any previous test configurations
    Object.values(dubMock.tags).forEach(method => {
      if (typeof method.reset === 'function') method.reset();
    });
    Object.values(dubMock.links).forEach(method => {
      if (typeof method.reset === 'function') method.reset();
    });
  });

  afterEach(() => {
    // Restore all stubs
    sandbox.restore();
  });

  describe('shortenLinksInMessage', () => {
    it('should return the message unchanged when there are no URLs', async () => {
      // Setup
      const message = 'This is a message with no URLs';
      const broadcastId = 123;

      // Run the test
      const result = await DubLinkShortener.shortenLinksInMessage(message, broadcastId);

      // Verify results
      assertEquals(result, message);
    });

    it('should create a tag for the broadcast if URLs are detected', async () => {
      // Setup - create test message with URL
      const message = 'Check out https://example.com for more information';
      const broadcastId = 123;
      const tagName = `broadcast-${broadcastId}`;

      // Setup stub responses
      dubMock.tags.list.withArgs({ search: tagName }).resolves([]);
      dubMock.tags.create.withArgs({ name: tagName }).resolves({ id: 'tag1', name: tagName });
      dubMock.links.list.withArgs({ tagNames: [tagName] }).resolves({ result: [] });
      dubMock.links.createMany.resolves([{
        id: 'link1',
        url: 'https://example.com',
        shortLink: 'https://dub.sh/abc123',
        tagNames: [tagName]
      }]);

      // Run the test
      const result = await DubLinkShortener.shortenLinksInMessage(message, broadcastId);

      // Check that URL was replaced
      assertEquals(result, 'Check out https://dub.sh/abc123 for more information');

      // Verify that the correct methods were called
      sinon.assert.calledWith(dubMock.tags.list, { search: tagName });
      sinon.assert.calledWith(dubMock.tags.create, { name: tagName });
      sinon.assert.calledWith(dubMock.links.list, { tagNames: [tagName] });
      sinon.assert.calledWith(dubMock.links.createMany, [{
        url: 'https://example.com',
        tagNames: [tagName]
      }]);
    });
    
    it('should not create a tag if it already exists', async () => {
      // Setup
      const message = 'Check out https://example.com for more information';
      const broadcastId = 123;
      const tagName = `broadcast-${broadcastId}`;

      // Setup stub responses - tag already exists
      dubMock.tags.list.withArgs({ search: tagName }).resolves([
        { id: 'tag1', name: tagName }
      ]);
      dubMock.links.list.withArgs({ tagNames: [tagName] }).resolves({ result: [] });
      dubMock.links.createMany.resolves([{
        id: 'link1',
        url: 'https://example.com',
        shortLink: 'https://dub.sh/abc123',
        tagNames: [tagName]
      }]);

      // Run the test
      const result = await DubLinkShortener.shortenLinksInMessage(message, broadcastId);

      // Check that URL was replaced
      assertEquals(result, 'Check out https://dub.sh/abc123 for more information');

      // Verify tag.create was not called
      sinon.assert.calledWith(dubMock.tags.list, { search: tagName });
      sinon.assert.notCalled(dubMock.tags.create);
    });

    it('should use existing shortened links if available', async () => {
      // Setup
      const message = 'Check out https://example.com and https://example.org';
      const broadcastId = 123;
      const tagName = `broadcast-${broadcastId}`;

      // Setup stub responses - one link already exists
      dubMock.tags.list.withArgs({ search: tagName }).resolves([
        { id: 'tag1', name: tagName }
      ]);

      // Setup existing links - only example.com has a shortened link
      dubMock.links.list.withArgs({ tagNames: [tagName] }).resolves({
        result: [{
          id: 'link1',
          url: 'https://example.com',
          shortLink: 'https://dub.sh/abc123',
          tagNames: [tagName]
        }]
      });

      // Setup createMany to return a new shortened link for example.org
      dubMock.links.createMany.resolves([{
        id: 'link2',
        url: 'https://example.org',
        shortLink: 'https://dub.sh/def456',
        tagNames: [tagName]
      }]);

      // Run the test
      const result = await DubLinkShortener.shortenLinksInMessage(message, broadcastId);

      // Both URLs should be replaced
      assertEquals(result, 'Check out https://dub.sh/abc123 and https://dub.sh/def456');

      // Only the new URL should be sent for creation
      sinon.assert.calledWith(dubMock.links.createMany, [{
        url: 'https://example.org',
        tagNames: [tagName]
      }]);

      // Verify createMany was called exactly once
      sinon.assert.calledOnce(dubMock.links.createMany);
    });

    it('should handle multiple occurrences of the same URL', async () => {
      // Setup
      const message = 'Check https://example.com here and https://example.com there';
      const broadcastId = 123;
      const tagName = `broadcast-${broadcastId}`;

      // Setup stub responses
      dubMock.tags.list.withArgs({ search: tagName }).resolves([
        { id: 'tag1', name: tagName }
      ]);
      dubMock.links.list.withArgs({ tagNames: [tagName] }).resolves({ result: [] });
      dubMock.links.createMany.resolves([{
        id: 'link1',
        url: 'https://example.com',
        shortLink: 'https://dub.sh/abc123',
        tagNames: [tagName]
      }]);

      // Run the test
      const result = await DubLinkShortener.shortenLinksInMessage(message, broadcastId);

      // Both occurrences should be replaced
      assertEquals(result, 'Check https://dub.sh/abc123 here and https://dub.sh/abc123 there');

      // Only one URL should be sent for creation (unique URLs)
      sinon.assert.calledOnce(dubMock.links.createMany);
    });

    it('should handle error scenarios gracefully', async () => {
      // Setup
      const message = 'Check out https://example.com for more information';
      const broadcastId = 123;

      // Setup stub to throw an error
      dubMock.tags.list.throws(new Error('API Error'));

      // Run the test
      const result = await DubLinkShortener.shortenLinksInMessage(message, broadcastId);

      // Original message should be returned on error
      assertEquals(result, message);

      // Error should be logged
      sinon.assert.called((console.error as sinon.SinonStub));
    });
  });

  describe('cleanupUnusedLinks', () => {
    it('should not delete links when no URLs are found', async () => {
      // Setup
      const broadcastId = 123;
      const firstMessage = 'This is a message with no URLs';
      const secondMessage = 'This is another message with no URLs';

      // Run the test
      await DubLinkShortener.cleanupUnusedLinks(broadcastId, firstMessage, secondMessage);

      // Should not call links.list or links.deleteMany
      sinon.assert.notCalled(dubMock.links.list);
      sinon.assert.notCalled(dubMock.links.deleteMany);

      // Should log a message
      sinon.assert.calledWithMatch((console.log as sinon.SinonStub), 'No URLs found in the messages. Skipping cleanup.');
    });

    it('should delete links that are not in either message', async () => {
      // Setup
      const broadcastId = 123;
      const tagName = `broadcast-${broadcastId}`;
      const firstMessage = 'Check out https://example.com for more information';
      const secondMessage = 'Also visit https://example.org for details';

      // Setup stub responses with existing links
      dubMock.links.list.withArgs({ tagNames: [tagName] }).resolves({
        result: [
          {
            id: 'link1',
            url: 'https://example.com',
            shortLink: 'https://dub.sh/abc123',
            tagNames: [tagName]
          },
          {
            id: 'link2',
            url: 'https://example.org',
            shortLink: 'https://dub.sh/def456',
            tagNames: [tagName]
          },
          {
            id: 'link3',
            url: 'https://unused-link.com',
            shortLink: 'https://dub.sh/ghi789',
            tagNames: [tagName]
          }
        ]
      });

      // Run the test
      await DubLinkShortener.cleanupUnusedLinks(broadcastId, firstMessage, secondMessage);

      // Should call links.list and links.deleteMany
      sinon.assert.calledWith(dubMock.links.list, { tagNames: [tagName] });
      sinon.assert.calledWith(dubMock.links.deleteMany, { linkIds: ['link3'] });
    });

    it('should handle error scenarios gracefully', async () => {
      // Setup
      const broadcastId = 123;
      const firstMessage = 'Check out https://example.com for more information';

      // Setup stub to throw an error
      dubMock.links.list.throws(new Error('API Error'));

      // Run the test
      await DubLinkShortener.cleanupUnusedLinks(broadcastId, firstMessage);

      // Error should be logged
      sinon.assert.called((console.error as sinon.SinonStub));
    });
  });
});