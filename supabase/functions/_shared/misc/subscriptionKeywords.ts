// Decides whether an incoming text asks to unsubscribe or resubscribe.
//
// Unsubscribe is deliberately generous, because a missed opt-out is worse than an extra one:
// - A one-word reply that contains "stop" or "unsub" counts. On production those are misspelled opt-outs ("stope",
//   "sstop", "stop2end"), and the carrier ignores them because it only knows the exact keywords.
// - In a sentence, "stop" (also stretched, "stoppp") or any word starting with "unsub" counts, so "Can you stop
//   texting me" and "I want to be unsubscribed" unsubscribe. "Stopped by" and "nonstop" do not: they are everyday words.
// - The carrier's other opt-out keywords (CANCEL, END, QUIT, STOPALL, OPTOUT, REVOKE) count only as the whole
//   message, because most of them are ordinary words in a sentence.
//
// A reaction is not an opt-out. When someone reacts to one of our texts on a phone that can't send the reaction itself,
// the phone texts us the reaction as words with our whole message quoted: Loved “… STOP to unsubscribe …”. Every
// broadcast and welcome text ends with "STOP to unsubscribe", so matching the quote would unsubscribe someone for
// liking it.
//
// Resubscribe is deliberately strict: the whole message has to be one of the keywords. Matching anywhere in the text
// used to resubscribe people who had asked us to stop as soon as they texted something like "I live in Detroit".

const UNSUBSCRIBE_EXACT = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'revoke']
const RESUBSCRIBE_EXACT = ['start', 'unstop', 'resubscribe', 'detroit']

// NFKD turns fullwidth letters ("ＳＴＯＰ") into plain ones and splits accents off ("stöp"), so the accents can be
// dropped before everything else non-alphanumeric becomes a space.
const normalize = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// Only s, t and p stretch: a doubled o is "stoop", an everyday word in Detroit.
const isOptOutWord = (word: string): boolean => /^s+t+op+$/.test(word) || word.startsWith('unsub')

// iMessage sends "Loved “…”", "Laughed at “…”", "Reacted 😂 to “…”" and "Removed a heart from “…”"; Android phones send
// the same shapes with straight quotes. Between "Reacted" or "Removed" and the quote only the reaction itself is allowed
// (an emoji or a reaction name), so a sentence there is still read.
const REACTION_PREFIX = new RegExp(
  '^\\s*(?:loved|liked|disliked|laughed at|emphasi[sz]ed|questioned' +
    '|reacted\\s+(?:with\\s+)?[^\\p{L}\\p{N}“"]{1,16}?\\s*to' +
    '|removed\\s+(?:an?\\s+)?(?:heart|like|dislike|laugh|exclamation(?: mark)?|question mark|emphasis|[^\\p{L}\\p{N}\\s“"]{1,16})' +
    '\\s+from)\\s*([“"])',
  'iu',
)

// The words the resident typed outside our quoted message. Only the opening quote has to be there, because Missive can
// cut a long message's preview before the closing one; everything after an unclosed quote counts as quoted. The quote
// ends at the first closing quote, so a resident who quotes something again after it ("Please stop saying “hi”") is
// still read. If one of our own texts ever contains a closing quote, the rest of it gets read too, which can only
// unsubscribe someone, the safer mistake.
const textOutsideReactionQuote = (text: string): string | null => {
  const match = REACTION_PREFIX.exec(text)
  if (!match) return null
  const quoteStart = match[0].length
  const closingQuote = match[1] === '“' ? '”' : '"'
  const quoteEnd = text.indexOf(closingQuote, quoteStart)
  return quoteEnd >= quoteStart ? text.slice(quoteEnd + 1) : ''
}

const isUnsubscribeRequest = (text: string): boolean => {
  const outsideQuote = textOutsideReactionQuote(text)
  if (outsideQuote !== null) return outsideQuote.trim() !== '' && isUnsubscribeRequest(outsideQuote)
  const normalized = normalize(text)
  // UNSTOP contains "stop" but asks for the opposite.
  if (RESUBSCRIBE_EXACT.includes(normalized)) return false
  if (UNSUBSCRIBE_EXACT.includes(normalized)) return true
  const words = normalized.split(' ')
  if (words.length === 1) return /stop|unsub/.test(normalized)
  return words.some(isOptOutWord)
}

const isResubscribeRequest = (text: string): boolean => RESUBSCRIBE_EXACT.includes(normalize(text))

export { isResubscribeRequest, isUnsubscribeRequest, normalize }
