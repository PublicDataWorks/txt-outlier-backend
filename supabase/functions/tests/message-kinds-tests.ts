import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'

import { isAutoReply, isReaction } from '../_shared/misc/messageKinds.ts'

const welcome =
  "Hello from Outlier Media, Detroit's nonprofit newsroom. STOP to unsubscribe. HELP for customer support."

describe('isReaction', () => {
  it('matches every iMessage reaction, with curly or straight quotes', () => {
    for (
      const word of ['Loved', 'Liked', 'Disliked', 'Laughed at', 'Emphasized', 'Emphasised', 'Questioned', 'loved']
    ) {
      assertEquals(isReaction(`${word} “${welcome}”`), true, word)
      assertEquals(isReaction(`${word} "${welcome}"`), true, `${word} with straight quotes`)
    }
  })

  it('matches a reaction with any emoji, and a reaction taken back', () => {
    for (
      const text of [
        // Seen on production, reacting to the resident's own text.
        'Reacted 😊 to “Thank you! I have been trying to sign up.”',
        `Reacted 👍🏽 to “${welcome}”`,
        `Reacted ❤️ to "${welcome}"`,
        `Reacted with 😂 to “${welcome}”`,
        `Removed a heart from “${welcome}”`,
        `Removed a like from “${welcome}”`,
        `Removed an exclamation mark from “${welcome}”`,
        `Removed 😊 from “${welcome}”`,
      ]
    ) {
      assertEquals(isReaction(text), true, text)
    }
  })

  it('matches a reaction to a long text whose preview was cut before the closing quote', () => {
    assertEquals(isReaction(`Emphasized “${welcome.slice(0, 40)}`), true)
  })

  it('ignores a reaction with words typed after it, and ordinary texts', () => {
    for (
      const text of [
        'Loved “the update”. Can someone call me?',
        'Loved it, thank you',
        'I liked your last text',
        'Reacted badly to “the news”',
        'Removed a tree from “my yard”',
        '👍',
        'Thanks!',
      ]
    ) {
      assertEquals(isReaction(text), false, text)
    }
  })
})

describe('isAutoReply', () => {
  it('matches the auto-replies seen on production', () => {
    for (
      const text of [
        "I'm Driving\n\n- Sent from My Car",
        "I'm Driving\n\n- Sent from My Car\n",
        'AUTO REPLY: I will be on vacation with no access to phone or emails from 9/8 to 9/21.',
        'Auto reply: Thank you for reaching out. We are with patients at the moment.',
      ]
    ) {
      assertEquals(isAutoReply(text), true, text)
    }
  })

  it("matches iPhone's driving Focus and other auto-reply labels", () => {
    for (
      const text of [
        "I'm driving with notifications silenced. I'll see your message when I get where I'm going.",
        'I’m driving with notifications silenced. I’ll see your message when I get where I’m going.',
        "I'm driving with Do Not Disturb While Driving turned on. I'll see your message when I get where I'm going.",
        'Auto-reply: out of the office until Monday',
        'Automatic reply: I am away',
        'Autoreply - closed today',
      ]
    ) {
      assertEquals(isAutoReply(text), true, text)
    }
  })

  it('ignores a resident who mentions driving or auto replies', () => {
    for (
      const text of [
        "I'm driving past 5200 Woodward, who owns it?",
        "I'm driving right now, can you call me later",
        'I got an auto reply from you, is anyone there?',
        'My car was towed',
      ]
    ) {
      assertEquals(isAutoReply(text), false, text)
    }
  })
})
