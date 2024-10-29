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
    SendPost: '/send-post/:broadcastID',
    HandleFailedDeliveries: '/handle-failures/',
  },
  Comment: {
    Base: '',
    Unsubscribe: '/unsubscribe',
    Resubscribe: '/resubscribe',
  },
} as const
