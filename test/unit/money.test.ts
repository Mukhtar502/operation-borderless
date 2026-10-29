import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/lib/errors.js';
import { convert, formatAmount, Money, parseAmount } from '../../src/domain/money.js';

function errorOf(fn: () => unknown): AppError {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('expected an AppError');
}

describe('parseAmount', () => {
  it.each(['1', '100.50', '0.000001', '999999999999.999999', '1000000000000'])(
    'accepts %s',
    (input) => {
      expect(parseAmount(input, 'USDx').toFixed()).toBe(new Money(input).toFixed());
    },
  );

  it.each([
    ['a JSON number', 100],
    ['zero', '0'],
    ['zero with decimals', '0.000000'],
    ['a negative amount', '-5'],
    ['an exponent', '1e5'],
    ['a leading plus', '+5'],
    ['leading zeros', '007'],
    ['a trailing dot', '5.'],
    ['whitespace', ' 5'],
    ['too many decimals', '1.0000001'],
    ['more than the per-request limit', '1000000000000.000001'],
    ['empty string', ''],
    ['null', null],
  ])('rejects %s', (_label, input) => {
    const error = errorOf(() => parseAmount(input, 'USDx'));
    expect(error.status).toBe(400);
    expect(error.code).toBe('INVALID_AMOUNT');
  });

  it('keeps full precision with no float error', () => {
    const sum = parseAmount('0.1', 'USDx').plus(parseAmount('0.2', 'USDx'));
    expect(sum.toFixed()).toBe('0.3');
  });
});

describe('convert', () => {
  it('multiplies by the rate', () => {
    expect(convert(new Money('100'), new Money('1550.25'), 'cNGN').toFixed()).toBe('155025');
  });

  it('rounds down to the target precision so conversions never create value', () => {
    // 1 / 3 = 0.333333333... -> 0.333333, never 0.333334
    expect(convert(new Money('1'), new Money(1).div(3), 'USDx').toFixed()).toBe('0.333333');
    expect(convert(new Money('0.000001'), new Money('0.9'), 'EURx').toFixed()).toBe('0');
  });
});

describe('formatAmount', () => {
  it('pads to the currency precision', () => {
    expect(formatAmount(new Money('100.5'), 'USDx')).toBe('100.500000');
  });
});
