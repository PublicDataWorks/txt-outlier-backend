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
// liking it. An auto-reply isn't one either: "AUTO REPLY: … please stop by the office" was written by nobody to us.
// messageKinds.ts says how both are recognized.
//
// Resubscribe is deliberately strict: the whole message has to be one of the keywords. Matching anywhere in the text
// used to resubscribe people who had asked us to stop as soon as they texted something like "I live in Detroit".

import { isAutoReply, textOutsideReactionQuote } from './messageKinds.ts'

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

const isUnsubscribeRequest = (text: string): boolean => {
  if (isAutoReply(text)) return false
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
