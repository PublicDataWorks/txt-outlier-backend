const EnvVars = {
  Port: Number(Deno.env.get("PORT") ?? 8000),
  Jwt: {
    Secret: Deno.env.get("JWT_SECRET")!,
  },
} as const;

export default EnvVars;
