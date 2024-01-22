# Supabase Deno Edge Function project

For local development, install node dependencies

### Usage

Make sure to install Deno: https://deno.land/manual/getting_started/installation

Then start the project:

```
npm dev
```

This will watch the project directory and restart as necessary.

For further instructions see the `package.json` file.

### Testing

- Run `supabase start`.

- `cd supabase/functions/backend`.

- Run
  `supabase functions serve --no-verify-jwt --env-file=supabase/functions/user-actions/tests/.env.test`.

- Run `deno test --no-check --allow-all --env=tests/.env.test -q`.
