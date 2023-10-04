import { Result, Err, VMError } from 'result-pattern/result';
import { NumberConversionError, Uint32, Uint64, UnsignedInteger } from './uint';

export class FeltError extends Error {}

export class Felt {
  // TODO: should check for PRIME overflow.
  // TODO: put private to make sure nothing is broken once this is added
  private inner: bigint;
  static PRIME: bigint =
    0x800000000000011000000000000000000000000000000000000000000000001n;
  constructor(_inner: bigint) {
    if (_inner < 0n || _inner > Felt.PRIME) {
      throw new FeltError(
        'FeltError: cannot initialize a Felt with underlying bigint negative, or greater than Felt.PRIME'
      );
    }
    this.inner = _inner;
  }

  add(other: Felt): Felt {
    return new Felt((this.inner + other.inner) % Felt.PRIME);
  }

  sub(other: Felt): Felt {
    let result = this.inner - other.inner;
    if (result < 0n) {
      result += Felt.PRIME;
    }
    return new Felt(result);
  }

  eq(other: Felt): boolean {
    return this.inner == other.inner;
  }

  toString(): string {
    return this.inner.toString();
  }

  toUint32(): Result<Uint32, VMError> {
    if (this.inner > Number.MAX_SAFE_INTEGER) {
      return new Err(NumberConversionError);
    }
    return UnsignedInteger.toUint32(Number(this.inner));
  }

  toUint64(): Result<Uint64, VMError> {
    return UnsignedInteger.toUint64(this.inner);
  }

  toHexString(): string {
    return this.inner.toString(16);
  }
}
