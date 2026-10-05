import { describe, it, expect } from 'vitest'
import { parseCsv } from './csv'

describe('parseCsv', () => {
  it('básico com vírgula', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('ponto e vírgula, BOM e CRLF', () => {
    expect(parseCsv('\uFEFFa;b\r\n1;2')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('aspas com vírgula, aspas escapadas e quebra de linha', () => {
    expect(parseCsv('c\n"olá, ""mundo""\nlinha 2"')).toEqual([['c'], ['olá, "mundo"\nlinha 2']])
  })
  it('ignora linhas vazias', () => {
    expect(parseCsv('a\n\n1\n')).toEqual([['a'], ['1']])
  })
})
