// Read-only comparison of the q4 info-gap prompt against the newsroom's own Missive impact labels.
//
// Two samples, both drawn from conversation_analyses (nothing is written anywhere):
//   A. Conversations a reporter labelled in Missive (tag_source = 'missive-label'). The human tag is the
//      answer key; model_tag is what the previous prompt said; this script re-asks the model with the new
//      prompt. Impact labels are withheld from the prompt exactly as in production, so the model never sees
//      the answer.
//   B. Conversations the model alone tagged info-gap (tag_source = 'model', tag = 'info-gap'): the posts the
//      newsroom has been seeing in Slack. Shows how many the new prompt still calls info-gap.
//
// The script only SELECTs and calls OpenAI with store:false. Run it with a read-only database role (for
// example readonly_outlier) so it cannot write even by mistake.
//
// Usage, from the repo root:
//   DB_POOL_URL=<read-only connection string> OPENAI_API_KEY=... OUTLIER_PHONE_NUMBER=<+1 number> \
//     deno run --allow-env --allow-net --allow-write=./info-gap-comparison \
//     supabase/scripts/compare_info_gap.ts --limit-a 150 --limit-b 60
//
// Output: a summary on stdout and ./info-gap-comparison/rows.csv (conversation id, Missive link, tags, and
// counts of staff/automated/broadcast messages). No message text is written to the CSV.
import { and, desc, eq, sql } from 'drizzle-orm'
import supabase, { postgresClient } from '../functions/_shared/lib/supabase.ts'
import { analysisTags, conversationAnalyses } from '../functions/_shared/drizzle/schema.ts'
import {
  analyzeTranscript,
  getConversationTranscript,
  getResidentNames,
  PROMPT_VERSION,
} from '../functions/_shared/services/AnalysisService.ts'
import { formatLabelsForPrompt, getConversationLabels } from '../functions/_shared/services/MissiveLabels.ts'

// Mirrors 20261118120000_analysis_tags_info_gap_definition.sql, so the comparison measures the new definition
// even when it runs before that migration has been applied.
const NEW_DESCRIPTIONS: Record<string, string> = {
  'info-gap':
    "A staff member personally answered the resident's specific question about their own situation with usable information (a fact, rule, eligibility answer, deadline, contact, location or next step). Automated keyword, broadcast or campaign replies alone never count",
  'reporter-engaged':
    'A staff member personally engaged with the resident one-on-one (a check-in they answered, an offer to look into something, a back-and-forth) without delivering a specific answer to a specific need. Signed automated replies do not count',
  'no-impact':
    'Resident received broadcast, campaign or automated content, or a staff check-in, and took no further meaningful action',
}

const arg = (name: string, fallback: number): number => {
  const index = Deno.args.indexOf(name)
  const value = index >= 0 ? Number(Deno.args[index + 1]) : NaN
  return Number.isFinite(value) && value > 0 ? value : fallback
}
const LIMIT_A = arg('--limit-a', 150)
const LIMIT_B = arg('--limit-b', 60)
const OUT_DIR = './info-gap-comparison'

type Row = {
  sample: 'A' | 'B'
  conversationId: string
  humanTag: string | null
  oldTag: string | null
  newTag: string | null
  newSecondary: string
  staff: number
  automated: number
  broadcast: number
  error: string
}

const loadTags = async () => {
  const rows = await supabase
    .select({ name: analysisTags.name, description: analysisTags.description })
    .from(analysisTags)
    .where(eq(analysisTags.active, true))
  return rows.map((tag) => ({ ...tag, description: NEW_DESCRIPTIONS[tag.name] ?? tag.description }))
}

const loadSample = async (sample: 'A' | 'B', limit: number) => {
  const condition = sample === 'A'
    ? and(eq(conversationAnalyses.status, 'completed'), eq(conversationAnalyses.tagSource, 'missive-label'))
    : and(
      eq(conversationAnalyses.status, 'completed'),
      eq(conversationAnalyses.tagSource, 'model'),
      eq(conversationAnalyses.tag, 'info-gap'),
    )
  return await supabase
    .select({
      conversationId: conversationAnalyses.conversationId,
      tag: conversationAnalyses.tag,
      modelTag: conversationAnalyses.modelTag,
    })
    .from(conversationAnalyses)
    .where(condition)
    .orderBy(desc(sql`coalesce(${conversationAnalyses.lastMessageAt}, ${conversationAnalyses.createdAt})`))
    .limit(limit)
}

const runOne = async (
  sample: 'A' | 'B',
  record: { conversationId: string; tag: string | null; modelTag: string | null },
  tags: { name: string; description: string }[],
): Promise<Row> => {
  const row: Row = {
    sample,
    conversationId: record.conversationId,
    humanTag: sample === 'A' ? record.tag : null,
    oldTag: sample === 'A' ? record.modelTag : record.tag,
    newTag: null,
    newSecondary: '',
    staff: 0,
    automated: 0,
    broadcast: 0,
    error: '',
  }
  try {
    const transcript = await getConversationTranscript(record.conversationId)
    for (const message of transcript) {
      if (message.sentBy) row[message.sentBy] += 1
    }
    if (!transcript.some((message) => message.direction === 'inbound')) {
      row.error = 'no inbound message'
      return row
    }
    const residentNames = await getResidentNames(record.conversationId)
    const labelContext = formatLabelsForPrompt(await getConversationLabels(record.conversationId))
    const result = await analyzeTranscript(transcript, tags, { residentNames, labelContext })
    row.newTag = result.tag
    row.newSecondary = result.secondaryTags.join('|')
  } catch (error) {
    row.error = error instanceof Error ? error.message.slice(0, 200) : String(error)
  }
  return row
}

// Runs a few requests at a time: fast enough for a few hundred conversations, gentle on rate limits.
const runAll = async (
  sample: 'A' | 'B',
  records: { conversationId: string; tag: string | null; modelTag: string | null }[],
  tags: { name: string; description: string }[],
) => {
  const results: Row[] = []
  for (let start = 0; start < records.length; start += 4) {
    const batch = records.slice(start, start + 4)
    results.push(...await Promise.all(batch.map((record) => runOne(sample, record, tags))))
    console.error(`sample ${sample}: ${results.length}/${records.length}`)
  }
  return results
}

const pct = (part: number, whole: number) => (whole === 0 ? 'n/a' : `${Math.round((part / whole) * 100)}%`)

const infoGapScores = (rows: Row[], pick: (row: Row) => string | null) => {
  const scored = rows.filter((row) => row.humanTag && pick(row))
  const truePositive = scored.filter((row) => row.humanTag === 'info-gap' && pick(row) === 'info-gap').length
  const predicted = scored.filter((row) => pick(row) === 'info-gap').length
  const actual = scored.filter((row) => row.humanTag === 'info-gap').length
  const agree = scored.filter((row) => row.humanTag === pick(row)).length
  return { n: scored.length, agree, truePositive, predicted, actual }
}

const confusion = (rows: Row[], pick: (row: Row) => string | null) => {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (!row.humanTag || !pick(row)) continue
    const key = `${row.humanTag} -> ${pick(row)}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

const csvCell = (value: string | number | null) => {
  const text = value === null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const main = async () => {
  const tags = await loadTags()
  console.error(`prompt ${PROMPT_VERSION}, ${tags.length} active tags`)

  const rowsA = await runAll('A', await loadSample('A', LIMIT_A), tags)
  const rowsB = await runAll('B', await loadSample('B', LIMIT_B), tags)

  const lines: string[] = []
  const say = (line = '') => lines.push(line)
  say(`Info gap comparison, prompt ${PROMPT_VERSION}, run ${new Date().toISOString()}`)
  say()
  say(
    `Sample A: ${rowsA.length} conversations reporters labelled in Missive (errors: ${
      rowsA.filter((r) => r.error).length
    })`,
  )
  for (
    const [label, pick] of [['Previous prompt', (r: Row) => r.oldTag], ['New prompt', (r: Row) => r.newTag]] as const
  ) {
    const s = infoGapScores(rowsA, pick)
    say(`  ${label}: agrees with the reporter on ${s.agree} of ${s.n} (${pct(s.agree, s.n)}).`)
    say(
      `    Info gap: called ${s.predicted}, of which ${s.truePositive} the reporter also labelled info gap ` +
        `(precision ${pct(s.truePositive, s.predicted)}); found ${s.truePositive} of the reporter's ${s.actual} ` +
        `(recall ${pct(s.truePositive, s.actual)}).`,
    )
  }
  say('  Most common reporter -> new prompt pairs:')
  for (const [pair, count] of confusion(rowsA, (r) => r.newTag).slice(0, 10)) say(`    ${pair}: ${count}`)
  say()
  const stillInfoGap = rowsB.filter((row) => row.newTag === 'info-gap').length
  const scoredB = rowsB.filter((row) => row.newTag).length
  say(
    `Sample B: ${rowsB.length} conversations the model alone tagged info gap (errors: ${
      rowsB.filter((r) => r.error).length
    })`,
  )
  say(`  New prompt keeps ${stillInfoGap} of ${scoredB} as info gap (${pct(stillInfoGap, scoredB)}).`)
  const movedTo = new Map<string, number>()
  for (const row of rowsB) {
    if (row.newTag && row.newTag !== 'info-gap') movedTo.set(row.newTag, (movedTo.get(row.newTag) ?? 0) + 1)
  }
  for (const [tag, count] of [...movedTo.entries()].sort((a, b) => b[1] - a[1])) say(`    now ${tag}: ${count}`)
  const noStaff = rowsB.filter((row) => row.staff === 0).length
  say(`  ${noStaff} of ${rowsB.length} had no message sent from a staff account at all.`)
  say()
  say('Sender check: if most sample A info-gap conversations show no staff messages, sender_id may not mark staff')
  say('replies reliably (for example address lookup replies sent through a staff account). Look at the CSV.')
  const report = lines.join('\n')
  console.log(report)

  await Deno.mkdir(OUT_DIR, { recursive: true })
  const header =
    'sample,conversation_id,missive_link,human_tag,previous_tag,new_tag,new_secondary,staff_msgs,automated_msgs,broadcast_msgs,error'
  const csv = [
    header,
    ...[...rowsA, ...rowsB].map((row) =>
      [
        row.sample,
        row.conversationId,
        `https://mail.missiveapp.com/#inbox/conversations/${row.conversationId}`,
        row.humanTag,
        row.oldTag,
        row.newTag,
        row.newSecondary,
        row.staff,
        row.automated,
        row.broadcast,
        row.error,
      ].map(csvCell).join(',')
    ),
  ].join('\n')
  await Deno.writeTextFile(`${OUT_DIR}/rows.csv`, csv + '\n')
  await Deno.writeTextFile(`${OUT_DIR}/summary.txt`, report + '\n')
  console.error(`wrote ${OUT_DIR}/rows.csv and ${OUT_DIR}/summary.txt`)
}

try {
  await main()
} finally {
  await postgresClient.end()
}
