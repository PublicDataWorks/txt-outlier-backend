import * as sinon from 'npm:sinon'

class MockMissiveUtils {
  sendMessage = sinon.stub()
  createPost = sinon.stub()
  verifySignature = sinon.stub()
  getMissiveMessage = sinon.stub()
  getMissiveConversation = sinon.stub()
  createLabel = sinon.stub()
  findLabelByName = sinon.stub()
  CREATE_MESSAGE_URL = 'https://public.missiveapp.com/v1/drafts'
}

const mockMissiveInstance = new MockMissiveUtils()

export default mockMissiveInstance

export const missiveMock = mockMissiveInstance
