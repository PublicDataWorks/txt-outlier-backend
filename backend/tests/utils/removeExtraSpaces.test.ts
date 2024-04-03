import { describe, it } from 'testing/bdd.ts'
import { assertEquals } from 'testing/asserts.ts'

import { removeExtraSpaces } from '../../misc/utils.ts'
describe('removeExtraSpaces', () => {
  it('should remove extra spaces from the string', () => {
    const result = removeExtraSpaces('This   is a   string     with  extra   spaces.')
    assertEquals(result, 'This is a string with extra spaces.')
  })

  it('should return the same string if there are no extra spaces', () => {
    const result = removeExtraSpaces('This is a normal string.')
    assertEquals(result, 'This is a normal string.')
  })

  it('should replace multiple spaces at start and end', () => {
    const result = removeExtraSpaces('    This is a string with extra spaces.    ')
    assertEquals(result, ' This is a string with extra spaces. ')
  })

  it('should return an empty string if input is an empty string', () => {
    const result = removeExtraSpaces('')
    assertEquals(result, '')
  })

  it('should return a string with single space if input is a string with multiple spaces', () => {
    const result = removeExtraSpaces('       ')
    assertEquals(result, ' ')
  })
})
