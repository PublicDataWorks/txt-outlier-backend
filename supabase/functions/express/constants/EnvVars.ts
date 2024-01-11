/**
 * Environments variables declared here.
 */

/* eslint-disable node/no-process-env */


const EnvVars = {
  NodeEnv: (Deno.env.get('NODE_ENV') ?? ''),
  Port: Number(Deno.env.get('PORT') ?? 8000),
  CookieProps: {
    Key: 'ExpressGeneratorTs',
    Secret: (Deno.env.get('COOKIE_SECRET') ?? ''),
    // Casing to match express cookie options
    Options: {
      httpOnly: true,
      signed: true,
      path: (Deno.env.get('COOKIE_PATH') ?? ''),
      maxAge: Number(Deno.env.get('COOKIE_EXP') ?? 0),
      domain: (Deno.env.get('COOKIE_DOMAIN') ?? ''),
      secure: (Deno.env.get('SECURE_COOKIE') === 'true'),
    },
  },
  Jwt: {
    Secret: (Deno.env.get('JWT_SECRET') ??  ''),
    Exp: (Deno.env.get('COOKIE_EXP') ?? ''), // exp at the same time as the cookie
  },
} as const;

export default EnvVars;
