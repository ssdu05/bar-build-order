import { describe, expect, it } from 'vitest'
import { dimensionsFor, rankedFor, skillFor } from './replays'

describe('replay metadata', () => {
  it.each([true, 1, '1'])('classifies explicit ranked flag %s', (ranked_game) =>
    expect(rankedFor({ gameSettings: { ranked_game } })).toBe('Ranked'),
  )
  it.each([false, 0, '0'])(
    'classifies explicit unranked flag %s',
    (ranked_game) =>
      expect(rankedFor({ gameSettings: { ranked_game } })).toBe('Unranked'),
  )
  it.each([undefined, null, '', 'unknown', 2])(
    'does not assume unknown flag %s is unranked',
    (ranked_game) =>
      expect(rankedFor({ gameSettings: { ranked_game } })).toBe('Unknown'),
  )
  it('converts map dimensions into game coordinates', () =>
    expect(dimensionsFor({ Map: { width: 14, height: 8 } })).toEqual({
      width: 7168,
      height: 4096,
    }))
  it('uses recorded OpenSkill including zero; unrelated ranks are ignored', () => {
    expect(skillFor({ skill: '[26.22]' })).toBe('26.22')
    expect(skillFor({ skill: 0 })).toBe('0')
    expect(skillFor({ rank: 8 })).toBe('—')
  })
})
