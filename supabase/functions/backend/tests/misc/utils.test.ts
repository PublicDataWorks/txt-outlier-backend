import { assertEquals } from 'testing/asserts.ts'
import { describe, it } from 'testing/bdd.ts'
import { intervalToString } from '../../misc/utils.ts'

describe('intervalToString', () => {
  it('should return hours, minutes, and seconds when all are present', () => {
    assertEquals(intervalToString('2:30:45'), '2 hours, 30 minutes, 45 seconds')
    assertEquals(intervalToString('1:1:1'), '1 hour, 1 minute, 1 second')
  })

  it('should return hours and minutes when seconds are not present', () => {
    assertEquals(intervalToString('2:30:0'), '2 hours, 30 minutes')
    assertEquals(intervalToString('1:1:0'), '1 hour, 1 minute')
  })

  it('should return hours and seconds when minutes are not present', () => {
    assertEquals(intervalToString('2:0:45'), '2 hours, 45 seconds')
    assertEquals(intervalToString('1:0:1'), '1 hour, 1 second')
  })

  it('should return minutes and seconds when hours are not present', () => {
    assertEquals(intervalToString('0:30:45'), '30 minutes, 45 seconds')
    assertEquals(intervalToString('0:1:1'), '1 minute, 1 second')
  })

  it('should return hours when only hours are present', () => {
    assertEquals(intervalToString('2:0:0'), '2 hours')
    assertEquals(intervalToString('1:0:0'), '1 hour')
  })

  it('should return minutes when only minutes are present', () => {
    assertEquals(intervalToString('0:30:0'), '30 minutes')
    assertEquals(intervalToString('0:1:0'), '1 minute')
  })

  it('should return seconds when only seconds are present', () => {
    assertEquals(intervalToString('0:0:45'), '45 seconds')
    assertEquals(intervalToString('0:0:1'), '1 second')
  })

  it('should return "Invalid interval format" when no hours, minutes, or seconds are present', () => {
    assertEquals(intervalToString('0:0:0'), 'Invalid interval format')
  })

  it('should return "Invalid interval format" for invalid input', () => {
    assertEquals(intervalToString('invalid'), 'Invalid interval format')
  })
})
