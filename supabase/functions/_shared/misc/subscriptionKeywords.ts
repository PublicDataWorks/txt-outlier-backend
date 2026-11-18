// Decides whether an incoming text asks to unsubscribe or resubscribe.
//
// Opt-outs fall into three groups:
// - 'optout': clearly a request to stop. The backend unsubscribes the resident and closes the conversation.
//   - The whole message, or one sentence of it, is a carrier opt-out keyword (STOP, UNSUBSCRIBE, CANCEL, END, QUIT,
//     STOPALL, OPTOUT, REVOKE), optionally repeated or with "please", "now", "thanks" and the like ("stop please",
//     "STOP STOP", "Stop. Who is this?").
//   - A one-word reply that contains "stop" or "unsub". On production those are misspelled opt-outs ("stope",
//     "sstop", "stop2end").
//   - A sentence with an explicit opt-out phrase: "stop texting me", "unsubscribe me", "remove me", "take me off",
//     "don't text me", "no more texts", "I want to unsubscribe".
// - 'possible': "stop" or a word starting with "unsub" appears, but not in an explicit opt-out phrase. Residents
//   often use "stop" about their own problem ("how do I stop my water shutoff", "help me stop the foreclosure"), so
//   the backend only flags these for an editor and does not unsubscribe.
// - 'none': everything else, including phone reactions ('Liked “…STOP to unsubscribe…”'), negations ("don't stop
//   sending these") and place words ("bus stop", "stop by").
//
// Resubscribe is deliberately strict: the whole message has to be one of the keywords. Matching anywhere in the text
// used to resubscribe people who had asked us to stop as soon as they texted something like "I live in Detroit".

export type OptOutKind = 'optout' | 'possible' | 'none'

const UNSUBSCRIBE_EXACT = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'opt out', 'revoke']
const RESUBSCRIBE_EXACT = ['start', 'unstop', 'resubscribe', 'detroit']

// Words that can pad a bare keyword without changing its meaning: "stop please", "ok stop now", "stop it thanks".
const FILLER_WORDS = new Set([
  'please',
  'pls',
  'plz',
  'now',
  'it',
  'ok',
  'okay',
  'thanks',
  'thank',
  'you',
  'ty',
  'just',
])

// iPhone and Android send a reaction as a text that quotes our whole message, which usually includes "STOP to
// unsubscribe" and "Detroit". The quote must follow the prefix, so "I loved the article, please stop" still counts.
const REACTION = /^\s*(loved|liked|disliked|laughed at|emphasi[sz]ed|questioned|reacted\s+\S{1,12}\s+to)\s*[“"]/i

const UNSUB_ASKS = 'want|wanna|would like|need|trying|how do i|how can i|how to|can you|could you|please|pls|plz'
const TEXT_VERB = '(text|txt|tex|message|msg|contact|call|send|spam|email|bother|hit up)(ing|in|s)?'
const STOP_WORD = 's+t+op+'

// Clear opt-out phrases, matched against the normalized text (lowercase, letters and digits, single spaces).
const OPT_OUT_PHRASES = [
  new RegExp(`\\b${STOP_WORD} ${TEXT_VERB}\\b`), // stop texting, stop sending, stop calling me
  new RegExp(`\\b${STOP_WORD} (all |the |these |your |this )*(texts?|txts?|messages?|msgs?|spam|subscription)\\b`),
  /\b(unsub\w*|remove|opt) me\b/, // unsubscribe me, remove me, opt me out
  /\btake me off\b/,
  /\bopt (me )?out\b/,
  new RegExp(`\\b(don t|dont|do not|never) ${TEXT_VERB} (me|this number|my number)\\b`),
  /\bno more (texts?|txts?|messages?|msgs?)\b/,
  // I want to unsubscribe, how do I unsubscribe, can you unsubscribe me, please unsubscribe
  new RegExp(`\\b(${UNSUB_ASKS})( to)?( be)? unsub\\w*`),
]

// "stop" negated ("don't stop sending these"). Removed before looking for opt-out phrases.
const NEGATED_STOP = new RegExp(
  `\\b(don t|dont|do not|never|can t|cant|cannot|not|won t|wont|didn t|didnt) ${STOP_WORD}\\b`,
  'g',
)

// "stop" as a place or a visit: "bus stop", "stop sign", "stop by".
const PLACE_STOP = new RegExp(
  [
    `\\b(bus|truck|pit|last|next|one|first|rest|traffic|full|my|your|the|a) ${STOP_WORD}\\b`,
    `\\b${STOP_WORD} (sign|light|by|in|at|over|off|the bus)\\b`,
  ].join('|'),
  'g',
)

// NFKD turns fullwidth letters ("ＳＴＯＰ") into plain ones and splits accents off ("stöp"), so the accents can be
// dropped before everything else non-alphanumeric becomes a space.
const normalize = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// Only s, t and p stretch: a doubled o is "stoop", an everyday word in Detroit.
const isStopWord = (word: string): boolean => new RegExp(`^${STOP_WORD}$`).test(word)
const isKeywordWord = (word: string): boolean => isStopWord(word) || UNSUBSCRIBE_EXACT.includes(word)

const isBareKeyword = (segment: string): boolean => {
  const meaningful = normalize(segment).split(' ').filter((word) => word && !FILLER_WORDS.has(word))
  return meaningful.length > 0 && meaningful.every(isKeywordWord)
}

const classifyOptOut = (text: string): OptOutKind => {
  if (REACTION.test(text)) return 'none'
  const normalized = normalize(text)
  if (!normalized) return 'none'
  // UNSTOP contains "stop" but asks for the opposite.
  if (RESUBSCRIBE_EXACT.includes(normalized)) return 'none'
  if (UNSUBSCRIBE_EXACT.includes(normalized)) return 'optout'

  const words = normalized.split(' ')
  if (words.length === 1) return /stop|unsub/.test(normalized) ? 'optout' : 'none'

  // A bare keyword padded with filler, on its own or as its own sentence: "stop please", "STOP STOP",
  // "Stop. Who is this?"
  if (text.split(/[.!?;\n]+/).some(isBareKeyword)) return 'optout'

  const withoutNegations = normalized.replace(NEGATED_STOP, ' ')
  if (OPT_OUT_PHRASES.some((phrase) => phrase.test(withoutNegations))) return 'optout'

  // Drop the harmless uses of "stop", then see whether any stop or unsub word is left.
  const remaining = withoutNegations.replace(PLACE_STOP, ' ').split(' ')
  if (remaining.some((word) => isStopWord(word) || word.startsWith('unsub'))) return 'possible'
  return 'none'
}

const isUnsubscribeRequest = (text: string): boolean => classifyOptOut(text) === 'optout'

const isResubscribeRequest = (text: string): boolean =>
  !REACTION.test(text) && RESUBSCRIBE_EXACT.includes(normalize(text))

export { classifyOptOut, isResubscribeRequest, isUnsubscribeRequest, normalize }
