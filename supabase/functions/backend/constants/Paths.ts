export default {
  Base: "/backend",
  Users: {
    Base: "/users",
    Get: "/all",
  },
  Broadcast: {
    Base: "/broadcasts",
    Make: "/make",
    Draft: "/draft",
  },
} as const;
