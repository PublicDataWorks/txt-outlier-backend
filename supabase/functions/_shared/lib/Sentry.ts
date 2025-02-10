import * as Sentry from 'sentry'

Sentry.init({
  // https://docs.sentry.io/product/sentry-basics/concepts/dsn-explainer/#where-to-find-your-dsn
  dsn: Deno.env.get('SENTRY_DSN_CLIENT_KEY'),
  defaultIntegrations: false,
  // Performance Monitoring
  tracesSampleRate: 1.0,
})

export default Sentry
