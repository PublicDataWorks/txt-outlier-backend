export default {
  Base: '/backend',
  Users: {
    Base: '/users',
    All: '/all',
  },
  Broadcast: {
    Base: '/broadcasts',
    All: '',
    Make: '/make',
    Draft: '/draft/:broadcastID',
    ID: '/:id',
    UpdateTwilioStatus: '/twilio/:broadcastID',
  },
} as const
