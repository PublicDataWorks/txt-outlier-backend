// Recognizes incoming texts that a phone sent on its own or that only react to a message, so they aren't read as a
// resident writing to us. Neither kind is an opt-out, and neither counts as a reply to a broadcast.
//
// Reactions. When someone reacts to a text on a phone that can't send the reaction itself, the phone texts it as
// words with the message quoted. These all came in on production:
//   Emphasized “Hello from Outlier Media, … text COLD.”
//   Reacted 😊 to “Thank you! I have been trying to sign up.”
// iMessage also sends Loved, Liked, Disliked, Laughed at and Questioned, "Reacted <emoji> to" for any other emoji, and
// "Removed a heart from" when a reaction is taken back. Android phones send the same shapes with straight quotes.
//
// Auto-replies. These came in on production, and each one got the ELSE auto-reply:
//   I'm Driving / - Sent from My Car            (a car's driving mode, the most common one by far)
//   AUTO REPLY: I will be on vacation …          (and "Auto reply: Thank you for reaching out to …")
// iPhone's driving Focus sends "I'm driving with notifications silenced. I'll see your message when I get where I'm
// going." Older iPhones said "I'm driving with Do Not Disturb While Driving turned on." Only these exact shapes count:
// a resident who types "I'm driving past 5200 Woodward, who owns it?" is writing to us.

// Between "Reacted" or "Removed" and the quote only the reaction itself is allowed (an emoji or a reaction name), so a
// sentence there is still read.
const REACTION_PREFIX = new RegExp(
  '^\\s*(?:loved|liked|disliked|laughed at|emphasi[sz]ed|questioned' +
    '|reacted\\s+(?:with\\s+)?[^\\p{L}\\p{N}“"]{1,16}?\\s*to' +
    '|removed\\s+(?:an?\\s+)?(?:heart|like|dislike|laugh|exclamation(?: mark)?|question mark|emphasis|[^\\p{L}\\p{N}\\s“"]{1,16})' +
    '\\s+from)\\s*([“"])',
  'iu',
)

// The words the resident typed outside the quoted message, or null when the text isn't shaped like a reaction. Only
// the opening quote has to be there, because Missive can cut a long message's preview before the closing one;
// everything after an unclosed quote counts as quoted. The quote ends at the first closing quote, so a resident who
// quotes something again after it ("Please stop saying “hi”") is still read. If one of our own texts ever contains a
// closing quote, the rest of it gets read too, which can only unsubscribe someone, the safer mistake.
const textOutsideReactionQuote = (text: string): string | null => {
  const match = REACTION_PREFIX.exec(text)
  if (!match) return null
  const quoteStart = match[0].length
  const closingQuote = match[1] === '“' ? '”' : '"'
  const quoteEnd = text.indexOf(closingQuote, quoteStart)
  return quoteEnd >= quoteStart ? text.slice(quoteEnd + 1) : ''
}

// A reaction with nothing typed after the quote. One with words after it is a resident writing to us.
const isReaction = (text: string): boolean => textOutsideReactionQuote(text)?.trim() === ''

const AUTO_REPLIES = [
  // "AUTO REPLY:", "Auto reply:", "Auto-reply", "Autoreply", "Automatic reply"
  /^\s*auto(?:matic)?[\s-]*reply\b/i,
  // A car's driving mode signs its text this way.
  /\bsent from my car\s*$/i,
  // iPhone's driving Focus, and the older Do Not Disturb While Driving.
  /^\s*i(?:['’]m| am) driving with (?:notifications silenced|do not disturb)/i,
]

const isAutoReply = (text: string): boolean => AUTO_REPLIES.some((pattern) => pattern.test(text))

export { isAutoReply, isReaction, textOutsideReactionQuote }
