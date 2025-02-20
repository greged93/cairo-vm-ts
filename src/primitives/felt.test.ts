import { test, expect, describe } from 'bun:test';
import { Felt, FeltError } from './felt';
import { NumberConversionError } from './uint';

describe('Felt', () => {
  describe('constructor', () => {
    test('should throw if initializing a felt with a negative inner', () => {
      expect(() => new Felt(-10n)).toThrow(
        new FeltError(
          'FeltError: cannot initialize a Felt with underlying bigint negative, or greater than Felt.PRIME'
        )
      );
    });
    test('should throw a FeltError when initializing with a BigInt larger than PRIME', () => {
      const biggerThanPrime = Felt.PRIME + 1n;
      expect(() => new Felt(biggerThanPrime)).toThrow(
        new FeltError(
          'FeltError: cannot initialize a Felt with underlying bigint negative, or greater than Felt.PRIME'
        )
      );
    });
  });

  describe('conversions', () => {
    test('should convert correctly a felt to a number if inner is below Javascript max safe integer', () => {
      const felt = new Felt(10n);
      const result = felt.toUint64().unwrap();
      expect(result).toEqual(10n);
    });
    test('should convert correctly a felt to its string representation', () => {
      const felt = new Felt(10n);
      expect(felt.toString()).toEqual('10');
    });
    test('should convert correctly a felt to its hexstring representation', () => {
      const felt = new Felt(10n);
      expect(felt.toHexString()).toEqual('a');
    });
  });

  describe('eq', () => {
    test('should assert equality of two identical felts', () => {
      const a = new Felt(1000n);
      const b = new Felt(1000n);
      expect(a.eq(b)).toBeTrue();
    });
    test('should assert inequality of two different felts', () => {
      const a = new Felt(10n);
      const b = new Felt(2n);
      expect(a.eq(b)).toBeFalse();
    });
  });
  describe('add', () => {
    test('should add two felts properly', () => {
      const a = new Felt(1000n);
      const b = new Felt(2000n);
      const c = a.add(b);
      const expected = new Felt(3000n);
      expect(c.eq(expected)).toBeTrue();
    });
    test('should wrap around the prime field when adding', () => {
      const a = new Felt(Felt.PRIME - 1n);
      const b = new Felt(2n);
      const result = a.add(b);
      const expected = new Felt(1n);
      expect(result.eq(expected)).toBeTrue();
    });
  });
  describe('sub', () => {
    test('should sub two felts properly', () => {
      const a = new Felt(3000n);
      const b = new Felt(2000n);
      const c = a.sub(b);
      const expected = new Felt(1000n);
      expect(c.eq(expected)).toBeTrue();
    });
    test('should wrap around the prime field when subtracting', () => {
      const a = new Felt(2n);
      const b = new Felt(5n);
      const result = a.sub(b);
      const expected = new Felt(Felt.PRIME - 3n);
      expect(result.eq(expected)).toBeTrue();
    });
  });
  describe('toUint32', () => {
    test('should return an error if the felt is larger than the max safe integer', () => {
      const a = new Felt(2n ** 53n);
      const result = a.toUint32().unwrapErr();
      expect(result).toEqual(NumberConversionError);
    });
  });
});
