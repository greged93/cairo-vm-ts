import { test, expect, describe } from 'bun:test';
import { Memory, WriteOnceError } from './memory';
import { Relocatable, SegmentError } from 'primitives/relocatable';
import { Felt } from 'primitives/felt';
import { None } from 'option-pattern/option';

describe('Memory', () => {
  describe('get', () => {
    test('should return None if address is not written to', () => {
      const memory = new Memory();
      const address = new Relocatable(0, 0);
      const result = memory.get(address);
      expect(result).toEqual(new None());
    });

    test('should return the value at the address', () => {
      const memory = new Memory();
      memory.incrementNumSegments();
      const address = new Relocatable(0, 0);
      const value = new Felt(10n);
      memory.insert(address, value);
      let result = memory.get(address).unwrap();
      expect(result).toEqual(value);
    });
  });

  describe('insert', () => {
    test('should return error if relocatable is out of memory segment bounds', () => {
      const memory = new Memory();
      const address = new Relocatable(1, 0);
      const value = new Felt(10n);
      const result = memory.insert(address, value).unwrapErr();
      expect(result).toEqual(SegmentError);
    });

    test('should return error if address is already written to', () => {
      let memory = new Memory();
      memory.incrementNumSegments();
      const address = new Relocatable(0, 0);
      const value = new Felt(10n);
      memory.insert(address, value);
      const err = memory.insert(address, value).unwrapErr();
      expect(err).toEqual(WriteOnceError);
    });
  });
});
