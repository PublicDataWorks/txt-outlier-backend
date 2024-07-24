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
    SendNow: '/send-now',
    Status: '/status',
    Draft: '/draft/:broadcastID',
    ID: '/:id',
    UpdateTwilioStatus: '/twilio/:broadcastID',
  },
  Comment: {
    Base: '',
    Unsubscribe: '/unsubscribe',
    Resubscribe: '/resubscribe',
  },
} as const
