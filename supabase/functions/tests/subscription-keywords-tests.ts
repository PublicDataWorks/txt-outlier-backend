import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'

import { classifyOptOut, isResubscribeRequest, isUnsubscribeRequest } from '../_shared/misc/subscriptionKeywords.ts'

const expectAll = (kind: 'optout' | 'possible' | 'none', texts: string[]) => {
  for (const text of texts) {
    assertEquals(classifyOptOut(text), kind, text)
  }
}

describe('classifyOptOut', () => {
  it('treats a bare keyword, with or without filler, as a clear opt-out', () => {
    expectAll('optout', [
      'STOP',
      'Stop.',
      ' stop ',
      'STOP!!!',
      'stop please',
      'Please stop',
      'STOP STOP',
      'ok stop now',
      'stop it',
      'CANCEL',
      'end',
      'Quit',
      'STOPALL',
      'OPTOUT',
      'opt out',
      'Revoke',
    ])
  })

  it('treats STOP as its own sentence inside a longer message as a clear opt-out', () => {
    expectAll('optout', ['Stop. Who is this?', 'Who is this? Stop', 'ＳＴＯＰ。Who is this?'])
  })

  it('treats a one-word reply that contains stop or unsub as a clear opt-out, the way typos arrive', () => {
    expectAll('optout', ['stope', 'Stoppppp', 'sstop', 'stop2end', 'Stopped', 'unsubcribe'])
  })

  it('treats explicit opt-out phrases as clear opt-outs', () => {
    expectAll('optout', [
      'Can you stop calling me please',
      'Can you stop texting me',
      'Stopp texting me',
      'sstop texting',
      'stop sending these messages',
      'please stop the texts',
      'pls unsubscribe me!',
      'I want to be unsubscribed',
      'how do I unsubcribe',
      'I would like to unsubscribe',
      'Remove me from this list',
      'remove me please',
      'Remove me',
      'take me off your list',
      "I don't care, stop texting me",
      'opt me out',
      "don't text me anymore",
      'Do not contact me',
      'no more texts please',
      'I loved the article, please stop texting me',
    ])
  })

  it('folds fullwidth and accented letters before matching', () => {
    expectAll('optout', ['ＳＴＯＰ', 'stöp', 'Stóp texting me'])
  })

  it('flags other uses of stop or unsub for an editor instead of unsubscribing', () => {
    expectAll('possible', [
      'how do I stop my water shutoff',
      'Can you help me stop the foreclosure',
      'I need to stop the eviction',
      'make this stop',
      'did I unsubscribe by accident?',
    ])
  })

  it('ignores negated stop and stop as a place or a visit', () => {
    expectAll('none', [
      "please don't stop sending these",
      'I never stop reading your texts',
      'waiting at the bus stop',
      'I will stop by tomorrow',
      'turn left at the stop sign',
      "Please don't ever stop texting me",
      "Please don't unsubscribe me",
      "I'm at the bus stop. Text me when you get here.",
    ])
  })

  it('ignores phone reactions that quote our STOP line', () => {
    expectAll('none', [
      "Liked “Hello from Outlier Media, Detroit's nonprofit newsroom. STOP to unsubscribe.”",
      'Loved "Reply STOP to unsubscribe"',
      'Reacted 👍 to “STOP to unsubscribe. HELP for support”',
      'Removed ❤️ from “Reply STOP to unsubscribe”',
      'Loved “Hello from Outlier Media. Reply STOP to unsub', // Missive cut the preview before the closing quote
    ])
  })

  it('still checks what the resident typed after a quoted reaction', () => {
    expectAll('optout', ['Loved "the story", please stop texting me'])
  })

  it('ignores ordinary messages and carrier keywords used in a sentence', () => {
    expectAll('none', [
      'I stopped by',
      'nonstop traffic all day',
      'sitting on my stoop',
      'cancel my water shutoff',
      'at the end of the block',
      'I quit my job',
      'revoke my permit',
      'can you take me to the hearing',
      'Remove me from the raffle',
      "I can't make the meeting. Cancel it.",
      '123',
      'hello',
      '',
    ])
  })

  it('does not treat UNSTOP as an opt-out', () => {
    expectAll('none', ['UNSTOP', 'unstop.'])
  })
})

describe('isUnsubscribeRequest', () => {
  it('is true only for clear opt-outs', () => {
    assertEquals(isUnsubscribeRequest('stop texting me'), true)
    assertEquals(isUnsubscribeRequest('how do I stop my water shutoff'), false)
    assertEquals(isUnsubscribeRequest('hello'), false)
  })
})

describe('isResubscribeRequest', () => {
  it('matches a keyword sent on its own', () => {
    for (const text of ['START', 'start', 'Start.', ' Detroit ', 'UNSTOP', 'resubscribe']) {
      assertEquals(isResubscribeRequest(text), true, text)
    }
  })

  it('ignores keywords inside a longer message or a phone reaction', () => {
    const texts = ['I live in Detroit', 'when does it start?', 'start11232', 'restart', 'hello', 'Loved “Detroit”']
    for (const text of texts) {
      assertEquals(isResubscribeRequest(text), false, text)
    }
  })
})
