export default {
  Base: "/backend",
  Users: {
    Base: "/users",
    All: "/all",
  },
  Broadcast: {
    Base: "/broadcasts",
    All: "",
    Make: "/make",
    Draft: "/draft",
    ID: "/:id",
  },
} as const;
