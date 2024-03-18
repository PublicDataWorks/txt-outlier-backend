import { assertEquals } from 'testing/asserts.ts'
import { describe, it } from 'testing/bdd.ts'
import { intervalToString } from '../misc/utils.ts'
import { escapeLiteral } from '../scheduledcron/helpers.ts'

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

describe('escapeLiteral', () => {
  it('should return NULL for null', () => {
    assertEquals(escapeLiteral(null), 'NULL')
    assertEquals(escapeLiteral(undefined), 'NULL')
    assertEquals(escapeLiteral(''), "''")
  })

  it('should return a tuple for arrays', () => {
    assertEquals(escapeLiteral(['foo', 'bar', "baz' DROP TABLE foo;"]), "('foo', 'bar', 'baz'' DROP TABLE foo;')")
  })

  it('should quote', () => {
    assertEquals(escapeLiteral('hello world'), "'hello world'")
    assertEquals(escapeLiteral('105 OR 1=1'), "'105 OR 1=1'")
    assertEquals(escapeLiteral('105; DROP TABLE Suppliers --'), "'105; DROP TABLE Suppliers --'")
  })

  it('should escape quotes', () => {
    assertEquals(escapeLiteral("O'Reilly"), "'O''Reilly'")
  })

  it('should escape backslashes', () => {
    assertEquals(escapeLiteral('\\whoop\\'), "E'\\\\whoop\\\\'")
  })

  it('should handle empty arrays', () => {
    assertEquals(escapeLiteral([]), '()')
  })

  it('should handle arrays with mixed values', () => {
    assertEquals(escapeLiteral(['foo', 42, true, null]), "('foo', '42', 'true', NULL)")
  })

  it('should handle nested arrays', () => {
    assertEquals(escapeLiteral(['foo', ['bar', 'baz']]), "('foo', ('bar', 'baz'))")
  })

  it('should handle strings with special characters', () => {
    assertEquals(escapeLiteral('hello\nworld'), "'hello\nworld'")
    assertEquals(escapeLiteral('hello\tworld'), "'hello\tworld'")
    assertEquals(escapeLiteral('hello\rworld'), "'hello\rworld'")
    assertEquals(escapeLiteral('hello\0world'), "'hello\0world'")
  })

  it('should handle strings with Unicode characters', () => {
    assertEquals(escapeLiteral('hello世界'), "'hello世界'")
    assertEquals(escapeLiteral('😊'), "'😊'")
  })

  it('should handle non-string values', () => {
    assertEquals(escapeLiteral(42), "'42'")
    assertEquals(escapeLiteral(true), "'true'")
    assertEquals(escapeLiteral(false), "'false'")
  })
})
