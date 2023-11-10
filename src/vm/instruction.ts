// Instruction is the representation of the first word of each Cairo instruction.
// Some instructions spread over two words when they use an immediate value, so
// representing the first one with this struct is enougth.

import { BaseError, ErrorType } from 'result/error';
import {
  HighBitSetError,
  InvalidApUpdate,
  InvalidOp1Src,
  InvalidOpcode,
  InvalidPcUpdate,
  InvalidResultLogic,
} from 'result/instruction';
import { Int16, SignedInteger16 } from 'primitives/int';
import { Uint32, Uint64, UnsignedInteger } from 'primitives/uint';
import { Result } from 'result/result';

//  Structure of the 63-bit that form the first word of each instruction.
//  See Cairo whitepaper, page 32 - https://eprint.iacr.org/2021/1063.pdf.
// ┌─────────────────────────────────────────────────────────────────────────┐
// │                     off_dst (biased representation)                     │
// ├─────────────────────────────────────────────────────────────────────────┤
// │                     off_op0 (biased representation)                     │
// ├─────────────────────────────────────────────────────────────────────────┤
// │                     off_op1 (biased representation)                     │
// ├─────┬─────┬───────────┬───────┬───────────┬─────────┬──────────────┬────┤
// │ dst │ op0 │    op1    │  res  │    pc     │   ap    │    opcode    │ 0  │
// │ reg │ reg │    src    │ logic │  update   │ update  │              │    │
// ├─────┼─────┼───┬───┬───┼───┬───┼───┬───┬───┼────┬────┼────┬────┬────┼────┤
// │  0  │  1  │ 2 │ 3 │ 4 │ 5 │ 6 │ 7 │ 8 │ 9 │ 10 │ 11 │ 12 │ 13 │ 14 │ 15 │
// └─────┴─────┴───┴───┴───┴───┴───┴───┴───┴───┴────┴────┴────┴────┴────┴────┘
// Source: https://github.com/lambdaclass/cairo-vm_in_go/blob/main/pkg/vm/instruction.go

// Dst & Op0 register flags
// If the flag == 0, then the offset will point to Ap
// If the flag == 1, then the offset will point to Fp
export enum RegisterFlag {
  AP = 0,
  FP = 1,
}
export type DstRegister = RegisterFlag;
export type Op0Register = RegisterFlag;

// Op1Src
export enum Op1Src {
  Op0 = 0,
  Imm = 1,
  FP = 2,
  AP = 4,
}

// ResLogic
export enum ResLogic {
  Op1 = 0,
  Add = 1,
  Mul = 2,
  Unconstrained = 3,
}

// Pc Update
export enum PcUpdate {
  Regular = 0,
  Jump = 1,
  JumpRel = 2,
  Jnz = 4,
}

// Ap update
export enum ApUpdate {
  Regular = 0,
  Add = 1,
  Add1 = 2,
  Add2 = 3,
}

// Fp Update
export enum FpUpdate {
  Regular = 0,
  ApPlus2 = 1,
  Dst = 2,
}

export enum Opcode {
  NoOp = 0,
  Call = 1,
  Ret = 2,
  AssertEq = 4,
}

export class Instruction {
  // The offset to add or sub to ap/fp to obtain the Destination Operand
  public offDst: Int16;
  public offOp0: Int16;
  public offOp1: Int16;
  // The register to use as the Destination Operand
  public dstReg: DstRegister;
  // The register to use as the Operand 0
  public op0Reg: Op0Register;
  // The source of the Operand 1
  public op1Src: Op1Src;
  // The result logic
  public resLogic: ResLogic;
  // The logic to use to compute the next pc
  public pcUpdate: PcUpdate;
  // The logic to use to compute the next ap
  public apUpdate: ApUpdate;
  // The logic to use to compute the next fp
  public fpUpdate: FpUpdate;
  // The opcode
  public opcode: Opcode;

  static default(): Instruction {
    return new Instruction(
      0 as Int16,
      0 as Int16,
      0 as Int16,
      RegisterFlag.AP,
      RegisterFlag.AP,
      Op1Src.Op0,
      ResLogic.Op1,
      PcUpdate.Regular,
      ApUpdate.Regular,
      FpUpdate.Regular,
      Opcode.NoOp
    );
  }

  constructor(
    offsetDst: Int16,
    offsetOp0: Int16,
    offsetOp1: Int16,
    desReg: DstRegister,
    op0Reg: Op0Register,
    op1Src: Op1Src,
    resLogic: ResLogic,
    pcUpdate: PcUpdate,
    apUpdate: ApUpdate,
    fpUpdate: FpUpdate,
    opcode: Opcode
  ) {
    this.offDst = offsetDst;
    this.offOp0 = offsetOp0;
    this.offOp1 = offsetOp1;
    this.dstReg = desReg;
    this.op0Reg = op0Reg;
    this.op1Src = op1Src;
    this.resLogic = resLogic;
    this.pcUpdate = pcUpdate;
    this.apUpdate = apUpdate;
    this.fpUpdate = fpUpdate;
    this.opcode = opcode;
  }

  static decodeInstruction(encodedInstruction: Uint64): Result<Instruction> {
    // mask for the high bit of a 64-bit number
    const highBit = 1n << 63n;
    // dstReg is located at bits 0-0. We apply a mask of 0x01 (0b1)
    // and shift 0 bits right
    const dstRegMask = 0x01n;
    const dstRegOff = 0n;
    // op0Reg is located at bits 1-1. We apply a mask of 0x02 (0b10)
    // and shift 1 bit right
    const op0RegMask = 0x02n;
    const op0RegOff = 1n;
    // op1Src is located at bits 2-4. We apply a mask of 0x1c (0b11100)
    // and shift 2 bits right
    const op1SrcMask = 0x1cn;
    const op1SrcOff = 2n;
    // resLogic is located at bits 5-6. We apply a mask of 0x60 (0b1100000)
    // and shift 5 bits right
    const resLogicMask = 0x60n;
    const resLogicOff = 5n;
    // pcUpdate is located at bits 7-9. We apply a mask of 0x380 (0b1110000000)
    // and shift 7 bits right
    const pcUpdateMask = 0x0380n;
    const pcUpdateOff = 7n;
    // apUpdate is located at bits 10-11. We apply a mask of 0xc00 (0b110000000000)
    // and shift 10 bits right
    const apUpdateMask = 0x0c00n;
    const apUpdateOff = 10n;
    // opcode is located at bits 12-14. We apply a mask of 0x7000 (0b111000000000000)
    // and shift 12 bits right
    const opcodeMask = 0x7000n;
    const opcodeOff = 12n;

    if ((highBit & encodedInstruction) !== 0n) {
      return {
        value: undefined,
        error: new BaseError(ErrorType.InstructionError, HighBitSetError),
      };
    }

    // mask for the 16 least significant bits of a 64-bit number
    const mask = 0xffffn;
    const shift = 16n;

    // Get the offset by masking and shifting the encoded instruction
    const { value: offsetDst, error: dstError } = SignedInteger16.fromBiased(
      encodedInstruction & mask
    );
    if (dstError !== undefined) {
      return { value: undefined, error: dstError };
    }
    let shiftedEncodedInstruction = encodedInstruction >> shift;
    const { value: offsetOp0, error: op0Error } = SignedInteger16.fromBiased(
      shiftedEncodedInstruction & mask
    );
    if (op0Error !== undefined) {
      return { value: undefined, error: op0Error };
    }
    shiftedEncodedInstruction = shiftedEncodedInstruction >> shift;
    const { value: offsetOp1, error: op1Error } = SignedInteger16.fromBiased(
      shiftedEncodedInstruction & mask
    );
    if (op1Error !== undefined) {
      return { value: undefined, error: op1Error };
    }

    // Get the flags by shifting the encoded instruction
    const flags = shiftedEncodedInstruction >> shift;

    // Destination register is either Ap or Fp
    const dstRegNum = (flags & dstRegMask) >> dstRegOff;
    let dstReg: DstRegister;
    if (dstRegNum == 0n) {
      dstReg = RegisterFlag.AP;
    } else {
      dstReg = RegisterFlag.FP;
    }
    // Operand 0 register is either Ap or Fp
    const op0RegNum = (flags & op0RegMask) >> op0RegOff;
    let op0Reg: DstRegister;
    if (op0RegNum == 0n) {
      op0Reg = RegisterFlag.AP;
    } else {
      op0Reg = RegisterFlag.FP;
    }

    const op1SrcNum = (flags & op1SrcMask) >> op1SrcOff;
    let op1Src: Op1Src;
    switch (op1SrcNum) {
      case 0n:
        // op1 = m(op0 + offop1)
        op1Src = Op1Src.Op0;
        break;
      case 1n:
        // op1 = m(pc + offop1)
        op1Src = Op1Src.Imm;
        break;
      case 2n:
        // op1 = m(fp + offop1)
        op1Src = Op1Src.FP;
        break;
      case 4n:
        // op1 = m(ap + offop1)
        op1Src = Op1Src.AP;
        break;
      default:
        return {
          value: undefined,
          error: new BaseError(ErrorType.InstructionError, InvalidOp1Src),
        };
    }

    const pcUpdateNum = (flags & pcUpdateMask) >> pcUpdateOff;
    let pcUpdate: PcUpdate;
    switch (pcUpdateNum) {
      case 0n:
        // pc = pc + instruction size
        pcUpdate = PcUpdate.Regular;
        break;
      case 1n:
        // pc = res
        pcUpdate = PcUpdate.Jump;
        break;
      case 2n:
        // pc = pc + res
        pcUpdate = PcUpdate.JumpRel;
        break;
      case 4n:
        // if dst != 0 then pc = pc + instruction_size else pc + op1
        pcUpdate = PcUpdate.Jnz;
        break;
      default:
        return {
          value: undefined,
          error: new BaseError(ErrorType.InstructionError, InvalidPcUpdate),
        };
    }

    const resLogicNum = (flags & resLogicMask) >> resLogicOff;
    let resLogic: ResLogic;
    switch (resLogicNum) {
      case 0n:
        // if pc_update == jnz and res_logic == 0 then
        // res is unconstrained else res = op1
        if (pcUpdate == PcUpdate.Jnz) {
          resLogic = ResLogic.Unconstrained;
        } else {
          resLogic = ResLogic.Op1;
        }
        break;
      case 1n:
        // res = op0 + op1
        resLogic = ResLogic.Add;
        break;
      case 2n:
        // res = op0 * op1
        resLogic = ResLogic.Mul;
        break;
      default:
        return {
          value: undefined,
          error: new BaseError(ErrorType.InstructionError, InvalidResultLogic),
        };
    }

    const opcodeNum = (flags & opcodeMask) >> opcodeOff;
    let opcode: Opcode;
    switch (opcodeNum) {
      case 0n:
        // fp = fp
        opcode = Opcode.NoOp;
        break;
      case 1n:
        // fp = ap + 2
        opcode = Opcode.Call;
        break;
      case 2n:
        // Return: fp = dst
        opcode = Opcode.Ret;
        break;
      case 4n:
        // Assert equal: assert dst == op0, fp = fp
        opcode = Opcode.AssertEq;
        break;
      default:
        return {
          value: undefined,
          error: new BaseError(ErrorType.InstructionError, InvalidOpcode),
        };
    }

    const apUpdateNum = (flags & apUpdateMask) >> apUpdateOff;
    let apUpdate: ApUpdate;
    switch (apUpdateNum) {
      case 0n:
        // call with ap_update = 0: ap = ap + 2
        // else ap = ap
        if (opcode == Opcode.Call) {
          apUpdate = ApUpdate.Add2;
        } else {
          apUpdate = ApUpdate.Regular;
        }
        break;
      case 1n:
        // ap = ap + res
        apUpdate = ApUpdate.Add;
        break;
      case 2n:
        // ap = ap + 1
        apUpdate = ApUpdate.Add1;
        break;
      default:
        return {
          value: undefined,
          error: new BaseError(ErrorType.InstructionError, InvalidApUpdate),
        };
    }

    let fpUpdate: FpUpdate;
    switch (opcode) {
      case Opcode.Call:
        // fp = ap + 2
        fpUpdate = FpUpdate.ApPlus2;
        break;
      case Opcode.Ret:
        // fp = dst
        fpUpdate = FpUpdate.Dst;
        break;
      default:
        // fp = fp
        fpUpdate = FpUpdate.Regular;
    }

    return {
      value: new Instruction(
        offsetDst,
        offsetOp0,
        offsetOp1,
        dstReg,
        op0Reg,
        op1Src,
        resLogic,
        pcUpdate,
        apUpdate,
        fpUpdate,
        opcode
      ),
      error: undefined,
    };
  }

  size(): Uint32 {
    if (this.op1Src == Op1Src.Imm) {
      return UnsignedInteger.TWO_UINT32;
    }
    return UnsignedInteger.ONE_UINT32;
  }
}
