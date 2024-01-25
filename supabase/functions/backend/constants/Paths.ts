export default {
  Base: "/backend",
  Users: {
    Base: "/users",
    Get: "/all",
  },
  Broadcast: {
    Base: "/broadcasts",
    Get: "",
    Make: "/make",
    Draft: "/draft",
    ID: "/:id",
  },
} as const;
