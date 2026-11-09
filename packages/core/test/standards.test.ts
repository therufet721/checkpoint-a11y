import { describe, expect, it } from 'vitest';
import { applicability, criteriaFromAxeTags } from '../src/standards';

describe('standards', () => {
  it('parses axe tags', () => {
    expect(criteriaFromAxeTags(['cat.color', 'wcag2aa', 'wcag143', 'wcag2411', 'EN-301-549'])).toEqual(['1.4.3', '2.4.11']);
  });
  it('knows which version a criterion belongs to', () => {
    expect(applicability(['2.5.8'])).toEqual({ wcag21: false, wcag22: true });
    expect(applicability(['4.1.1'])).toEqual({ wcag21: true, wcag22: false });
    expect(applicability(['1.4.3'])).toEqual({ wcag21: true, wcag22: true });
    expect(applicability([])).toEqual({ wcag21: false, wcag22: false });
  });
});
