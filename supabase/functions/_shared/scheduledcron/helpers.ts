// deno-lint-ignore no-explicit-any
import supabase from "../lib/supabase.ts";
import { sql } from "drizzle-orm";
import { JOB_NAMES, SELECT_JOB_NAMES } from "./cron.ts";

const escapeLiteral = (val: any): string => {
  if (val == null) {
    return 'NULL'
  }
  if (typeof val === 'number') {
    return `'${val}'`
  }
  if (typeof val === 'boolean') {
    return `'${val.toString()}'`
  }

  if (Array.isArray(val)) {
    const vals = val.map(escapeLiteral)
    return '(' + vals.join(', ') + ')'
  }

  const backslash = val.indexOf('\\') !== -1
  const prefix = backslash ? 'E' : ''
  val = val.replace(/'/g, "''")
  val = val.replace(/\\/g, '\\\\')

  return prefix + "'" + val + "'"
}

const isBroadcastRunning = async (): Promise<boolean> => {
  const jobs = await supabase.execute(sql.raw(SELECT_JOB_NAMES))
  return jobs.some((job: { jobname: string }) => job.jobname != 'invoke-broadcast' && JOB_NAMES.includes(job.jobname))
}

export { escapeLiteral, isBroadcastRunning };
