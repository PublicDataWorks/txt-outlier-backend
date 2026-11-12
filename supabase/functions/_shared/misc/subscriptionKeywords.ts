// Decides whether an incoming text asks to unsubscribe or resubscribe.
//
// Unsubscribe is deliberately generous: "stop" or "unsubscribe" as a whole word anywhere in the message counts, so
// "Can you stop texting me" unsubscribes. Words that merely contain those letters ("stopped", "nonstop") do not.
// The standard carrier opt-out keywords (CANCEL, END, QUIT, STOPALL) count only when they are the whole message,
// because they are ordinary words in a sentence.
//
// Resubscribe is deliberately strict: the whole message has to be one of the keywords. Matching anywhere in the text
// used to resubscribe people who had asked us to stop as soon as they texted something like "I live in Detroit".

const UNSUBSCRIBE_WORDS = ['stop', 'unsubscribe']
const UNSUBSCRIBE_EXACT = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']
const RESUBSCRIBE_EXACT = ['start', 'unstop', 'resubscribe', 'detroit']

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const isUnsubscribeRequest = (text: string): boolean => {
  const normalized = normalize(text)
  if (UNSUBSCRIBE_EXACT.includes(normalized)) return true
  const words = normalized.split(' ')
  return UNSUBSCRIBE_WORDS.some((term) => words.includes(term))
}

const isResubscribeRequest = (text: string): boolean => RESUBSCRIBE_EXACT.includes(normalize(text))

export { isResubscribeRequest, isUnsubscribeRequest, normalize }
