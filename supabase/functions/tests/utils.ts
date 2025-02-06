import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2'

import 'https://deno.land/x/dotenv@v3.2.2/load.ts'

// Set up the configuration for the Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const options = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
}

const client: SupabaseClient = createClient(supabaseUrl, supabaseKey, options)

export { client }
