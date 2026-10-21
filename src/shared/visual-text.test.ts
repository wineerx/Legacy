import { expect,it } from 'vitest'
import { wrapText } from './visual-text'
it('preserves single-letter spaces, explicit blank lines and unbroken graphemes',()=>{
  expect(wrapText('a b c',3,v=>v.length)).toEqual(['a b','c'])
  expect(wrapText('texto\n\noutro',100,v=>v.length)).toEqual(['texto','','outro'])
  expect(wrapText('abcdef',3,v=>v.length)).toEqual(['abc','def'])
  expect(wrapText('👩‍👩‍👧‍👦',1,v=>v.length)).toEqual(['👩‍👩‍👧‍👦'])
})
