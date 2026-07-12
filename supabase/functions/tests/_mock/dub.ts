import * as sinon from 'npm:sinon'

// Define the shape of our mock client that matches the real Dub client
class MockDubClient {
  options: { token: string }

  constructor(options: { token: string }) {
    this.options = options
  }

  tags = {
    list: sinon.stub(),
    create: sinon.stub(),
  }

  links = {
    list: sinon.stub(),
    createMany: sinon.stub(),
    deleteMany: sinon.stub(),
  }
}

// Create a singleton instance of our mock client
const mockDubClientInstance = new MockDubClient({ token: 'mock-token' })

export class Dub {
  constructor(options: { token: string }) {
    // Instead of returning the mock instance (which causes TypeScript errors),
    // we modify the prototype of this instance to match the mock
    Object.setPrototypeOf(this, mockDubClientInstance)
    return this as unknown as MockDubClient
  }
}

// Export the mock instance so tests can configure it
export const dubMock = mockDubClientInstance
