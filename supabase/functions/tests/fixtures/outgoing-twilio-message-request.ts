import { RequestBody, RuleType } from '../../user-actions/types.ts'

export const newOutgoingSmsRequest: RequestBody = {
  rule: {
    id: '72e519db-e6ad-46ff-b8b7-a0b5a8275a5f',
    description: 'Outgoing SMS',
    type: RuleType.OutgoingSmsMessage,
  },
  conversation: {
    id: '410ca243-af1e-475e-9a20-a86502d9ad2e',
    created_at: 1707452590,
    subject: null,
    latest_message_subject: 'SMS with +11234567891',
    organization: {
      id: '7deec8a7-439a-414c-a10a-059142216786',
      name: 'Outlier Staging',
    },
    // @ts-ignore
    color: null,
    authors: [
      { name: '+11234567890', phone_number: '+11234567890' },
      { name: '+11234567891', phone_number: '+11234567891' },
    ],
    external_authors: [{ name: '+11234567891', phone_number: '+11234567891' }],
    messages_count: 161,
    drafts_count: 0,
    send_later_messages_count: 0,
    attachments_count: 0,
    tasks_count: 0,
    completed_tasks_count: 0,
    users: [
      {
        id: '2d98b928-c3be-4cc6-8087-0baa2235e86e',
        name: 'User 1',
        email: 'user@mail.com',
        unassigned: true,
        closed: false,
        archived: false,
        trashed: false,
        junked: false,
        assigned: false,
        flagged: false,
        snoozed: false,
      },
    ],
    assignees: [],
    assignee_names: '',
    assignee_emails: '',
    shared_label_names: '',
    web_url: 'https://mail.missiveapp.com/#inbox/conversations/410ca243-af1e-475e-9a20-a86502d9ad2e',
    app_url: 'missive://mail.missiveapp.com/#inbox/conversations/410ca243-af1e-475e-9a20-a86502d9ad2e',
    team: {
      id: 'fb0b601e-7d6e-4248-8882-4f129fdfe43c',
      name: 'Outlier Staging',
      organization: '7deec8a7-439a-414c-a10a-059142216786',
    },
    shared_labels: [],
  },
  message: {
    id: '972358ad-eda6-4936-9ff4-63fe7c178241',
    preview: 'Hello from outgoing message',
    type: 'sms',
    delivered_at: 1708418458,
    updated_at: 1708418458,
    created_at: 1708418458,
    references: ['+11234567890+11234567891'],
    // Outgoing message from our number to customer
    from_field: { id: '+11234567890', name: '+11234567890', username: null },
    to_fields: [
      { id: '+11234567891', name: '+11234567891', username: null },
    ],
    external_id: 'SMd76fc9e0453e8bfd0d78623e40437223',
    account_author: { id: '+11234567890', name: '+11234567890', username: null },
    account_recipients: [
      { id: '+11234567891', name: '+11234567891', username: null },
    ],
    attachments: [],
    author: {
      id: 'sender-user-id-123',
    },
  },
}

// Also create an outgoing Twilio message variant
export const newOutgoingTwilioRequest: RequestBody = {
  ...newOutgoingSmsRequest,
  rule: {
    id: '72e519db-e6ad-46ff-b8b7-a0b5a8275a5f',
    description: 'Outgoing Twilio',
    type: RuleType.OutgoingTwilioMessage,
  },
}
