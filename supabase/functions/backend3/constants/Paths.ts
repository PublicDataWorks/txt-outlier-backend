export default {
  Base: "/backend3",
  Users: {
    Base: "/users",
    All: "/all",
  },
  Broadcast: {
    Base: "/broadcasts",
    All: "",
    Make: "/make",
    Draft: "/draft/:broadcastID",
    ID: "/:id",
  },
} as const;
