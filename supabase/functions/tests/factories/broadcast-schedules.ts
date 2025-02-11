import { z } from "https://deno.land/x/zod@v3.24.1/mod.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'


const createBroadcastParamsSchema = z.object({
  mon: z.string().nullable(),
  tue: z.string().nullable(),
  wed: z.string().nullable(),
  thu: z.string().nullable(),
  fri: z.string().nullable(),
  sat: z.string().nullable(),
  sun: z.string().nullable(),
  active: z.boolean().default(true),
})

type CreateBroadcastParams = z.infer<typeof createBroadcastParamsSchema>

export const createBroadcastSchedule = async (
  input: CreateBroadcastParams
) => {
  try {
    const supabase = createClient(
      "http://localhost:54321",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
    )

    // Validate input against schema
    const validatedData = createBroadcastParamsSchema.parse(input)

    // Insert into broadcast_schedules table
    const { data, error } = await supabase
      .from('broadcast_schedules')
      .insert([validatedData])
      .select()
      .single()

    console.log(data)
    console.log("error",error)
    if (error) {
      console.error(error)
      throw new Error(`Failed to create broadcast schedule: ${error.message}`)
    }

    return data
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Validation error: ${error.message}`)
    }
    throw error
  }
}
