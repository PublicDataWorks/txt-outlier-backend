const EnvVars = {
  Port: Number(Deno.env.get('PORT') ?? 8000),
} as const

export default EnvVars
