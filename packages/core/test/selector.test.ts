import { describe, expect, it } from 'vitest';
import { normalizeSelector } from '../src/selector';

describe('normalizeSelector', () => {
  it('drops positional pseudo-classes', () => {
    expect(normalizeSelector('div > div:nth-child(3) > button')).toBe('div > div > button');
    expect(normalizeSelector('ul li:first-child a')).toBe('ul li a');
  });
  it('drops generated class names but keeps semantic ones', () => {
    expect(normalizeSelector('.css-1x2y3z > .btn-primary')).toBe('* > .btn-primary');
    expect(normalizeSelector('.sc-bdVaJa')).toBe('*');
    expect(normalizeSelector('button.Button_root__a1b2c.large')).toBe('button.large');
  });
  it('drops generated ids', () => {
    expect(normalizeSelector('#\\:r1\\: > input')).toBe('* > input');
    expect(normalizeSelector('#radix-12 button')).toBe('* button');
    expect(normalizeSelector('#checkout-form input')).toBe('#checkout-form input');
  });
  it('reduces generated attribute values to presence checks', () => {
    expect(normalizeSelector('[aria-controls="radix-5"]')).toBe('[aria-controls]');
    expect(normalizeSelector('input[name="email"]')).toBe('input[name="email"]');
  });
  it('is stable across two builds with different hashes', () => {
    const a = normalizeSelector('main > .ProductCard_card__x9a1b:nth-child(2) > .css-abc123 button');
    const b = normalizeSelector('main > .ProductCard_card__q7z2k:nth-child(5) > .css-zz9911 button');
    expect(a).toBe(b);
  });
});
