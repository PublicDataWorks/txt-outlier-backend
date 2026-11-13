import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'

import { isResubscribeRequest, isUnsubscribeRequest } from '../_shared/misc/subscriptionKeywords.ts'

describe('isUnsubscribeRequest', () => {
  it('matches stop and unsubscribe as whole words anywhere in the message', () => {
    for (
      const text of ['STOP', 'Stop.', ' stop ', 'Can you stop calling me please', 'pls unsubscribe me!', 'STOP!!!']
    ) {
      assertEquals(isUnsubscribeRequest(text), true, text)
    }
  })

  it('matches a stretched stop or a word starting with unsub inside a sentence', () => {
    for (
      const text of [
        'Stopp texting me',
        'sstop texting',
        'stoppp pls',
        'I want to be unsubscribed',
        'how do I unsubcribe',
      ]
    ) {
      assertEquals(isUnsubscribeRequest(text), true, text)
    }
  })

  it('folds fullwidth and accented letters before matching', () => {
    for (const text of ['ＳＴＯＰ', 'stöp', 'Stóp texting me']) {
      assertEquals(isUnsubscribeRequest(text), true, text)
    }
  })

  it('matches carrier opt-out keywords only as the whole message', () => {
    for (const text of ['CANCEL', 'end', 'Quit', 'STOPALL', 'OPTOUT', 'Revoke']) {
      assertEquals(isUnsubscribeRequest(text), true, text)
    }
    for (const text of ['cancel my water shutoff', 'at the end of the block', 'I quit my job', 'revoke my permit']) {
      assertEquals(isUnsubscribeRequest(text), false, text)
    }
  })

  it('matches a one-word reply that contains stop or unsub, the way misspelled opt-outs arrive', () => {
    for (const text of ['stope', 'Stoppppp', 'sstop', 'stop2end', 'Stopped', 'unsubcribe']) {
      assertEquals(isUnsubscribeRequest(text), true, text)
    }
  })

  it('ignores words that only contain stop inside a sentence', () => {
    for (
      const text of [
        'I stopped by',
        'nonstop traffic all day',
        'stopping by later',
        'sitting on my stoop',
        '123',
        'hello',
        '',
      ]
    ) {
      assertEquals(isUnsubscribeRequest(text), false, text)
    }
  })

  it('does not treat UNSTOP as an opt-out', () => {
    for (const text of ['UNSTOP', 'unstop.']) {
      assertEquals(isUnsubscribeRequest(text), false, text)
    }
  })
})

describe('isResubscribeRequest', () => {
  it('matches a keyword sent on its own', () => {
    for (const text of ['START', 'start', 'Start.', ' Detroit ', 'UNSTOP', 'resubscribe']) {
      assertEquals(isResubscribeRequest(text), true, text)
    }
  })

  it('ignores keywords inside a longer message', () => {
    for (const text of ['I live in Detroit', 'when does it start?', 'start11232', 'restart', 'hello']) {
      assertEquals(isResubscribeRequest(text), false, text)
    }
  })
})
