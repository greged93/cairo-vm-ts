import { MemorySegmentManager } from 'memory/memoryManager';
import { Felt } from 'primitives/felt';
import { Uint64, UnsignedInteger } from 'primitives/uint';
import { RunContext } from 'run-context/runContext';
import { Instruction, Opcode, ResLogic } from './instruction';
import { MaybeRelocatable } from 'primitives/relocatable';
import { BaseError, ErrorType } from 'result/error';
import { InstructionError } from 'result/memory';

import { Result } from 'result/result';
import {
  DiffAssertValuesError,
  EndOfInstructionsError,
  InvalidDstOperand,
  InvalidOperand0,
  UnconstrainedResError,
} from 'result/virtualMachine';

// operand 0 is the first operand in the right side of the computation
// operand 1 is the second operand in the right side of the computation
// res is the result of the computation
// dst is the destination of the computation i.e. the left side of the computation
// Example:
// assert [fp - 3] = [ap + 7] * [ap + 8]
// In this case, op0 = [ap + 7], op1 = [ap + 8], res = op0 * op1, dst = [fp - 3]
export type Operands = {
  op0: MaybeRelocatable | undefined;
  op1: MaybeRelocatable | undefined;
  res: MaybeRelocatable | undefined;
  dst: MaybeRelocatable | undefined;
};

export class VirtualMachine {
  private runContext: RunContext;
  private currentStep: Uint64;
  private segments: MemorySegmentManager;

  constructor() {
    this.currentStep = UnsignedInteger.ZERO_UINT64;
    this.segments = new MemorySegmentManager();
    this.runContext = RunContext.default();
  }

  step(): void {
    const maybeEncodedInstruction = this.segments.memory.get(
      this.runContext.getPc()
    );

    if (maybeEncodedInstruction === undefined) {
      throw new BaseError(ErrorType.MemoryError, EndOfInstructionsError);
    }

    const encodedInstruction = maybeEncodedInstruction;

    if (!(encodedInstruction instanceof Felt)) {
      throw new BaseError(ErrorType.MemoryError, InstructionError);
    }

    const { value: encodedInstructionUint, error } =
      encodedInstruction.toUint64();
    if (error !== undefined) {
      throw error;
    }
    // decode and run instruction
    const instruction = Instruction.decodeInstruction(encodedInstructionUint);

    // return this.runInstruction();
    throw new Error('TODO: Not Implemented');
  }

  // Compute the operands of an instruction. The VM can either
  // fetch them from memory and if it fails to do so, it can
  // deduce them from the instruction itself.
  computeOperands(instruction: Instruction): Result<Operands> {
    let res: MaybeRelocatable | undefined;
    // Compute the destination address based on the dstReg and
    // the offset
    const { value: dstAddr, error: dstError } = this.runContext.computeAddress(
      instruction.dstReg,
      instruction.offDst
    );
    if (dstError !== undefined) {
      return { value: undefined, error: dstError };
    }
    let dst = this.segments.memory.get(dstAddr);

    // Compute the first operand address based on the op0Reg and
    // the offset
    const { value: op0Addr, error: op0Error } = this.runContext.computeAddress(
      instruction.op0Reg,
      instruction.offOp0
    );
    if (op0Error !== undefined) {
      return { value: undefined, error: op0Error };
    }
    let op0 = this.segments.memory.get(op0Addr);

    // Compute the second operand address based on the op1Src and
    // the offset
    const { value: op1Addr, error: op1Error } =
      this.runContext.computeOp1Address(
        instruction.op1Src,
        instruction.offOp1,
        op0
      );
    if (op1Error !== undefined) {
      return { value: undefined, error: op1Error };
    }
    let op1 = this.segments.memory.get(op1Addr);

    // If op0 is undefined, then we can deduce it from the instruction, dst and op1
    // We also deduce the result based on the result logic
    if (op0 === undefined) {
      const { value: deducedValues, error: deducedOp0Error } = this.deduceOp0(
        instruction,
        dst,
        op1
      );
      if (deducedOp0Error !== undefined) {
        return { value: undefined, error: deducedOp0Error };
      }
      const [deducedOp0, deducedRes] = deducedValues;
      if (deducedOp0 !== undefined) {
        this.segments.memory.insert(op0Addr, deducedOp0);
      }
      res = deducedRes;
    }

    // If operand 1 is undefined, then we can deduce it from the instruction,
    // destination and operand 0.
    // We also deduce the result based on the result logic
    if (op1 === undefined) {
      const { value: deducedValues, error: deducedOp1Error } = this.deduceOp1(
        instruction,
        dst,
        op0
      );
      if (deducedOp1Error !== undefined) {
        return { value: undefined, error: deducedOp1Error };
      }
      const [deducedOp1, deducedRes] = deducedValues;
      if (deducedOp1 !== undefined) {
        this.segments.memory.insert(op1Addr, deducedOp1);
      }
      if (res === undefined) {
        res = deducedRes;
      }
    }

    // If res is still undefined, then we can compute it from op0 and op1
    if (res === undefined) {
      const { value: computedRes, error: computedResError } = this.computeRes(
        instruction,
        op0 as MaybeRelocatable,
        op1 as MaybeRelocatable
      );
      if (computedResError !== undefined) {
        return { value: undefined, error: computedResError };
      }
      res = computedRes;
    }

    // If dst is undefined, then we can deduce it from the instruction and res
    if (dst === undefined) {
      const { value: deducedDst, error: deducedDstError } = this.deduceDst(
        instruction,
        res
      );
      if (deducedDstError !== undefined) {
        return { value: undefined, error: deducedDstError };
      }
      if (deducedDst !== undefined) {
        this.segments.memory.insert(dstAddr, deducedDst);
      }
      dst = deducedDst;
    }

    return {
      value: {
        op0,
        op1,
        res,
        dst,
      },
      error: undefined,
    };
  }

  // Deduce the operands of an instruction based on the instruction
  // itself. Deduces op0 and result when possible.
  deduceOp0(
    instruction: Instruction,
    dst: MaybeRelocatable | undefined,
    op1: MaybeRelocatable | undefined
  ): Result<[MaybeRelocatable | undefined, MaybeRelocatable | undefined]> {
    // We can deduce the first operand from the destination and the second
    // operand, based on which opcode is used.
    switch (instruction.opcode) {
      // If the opcode is a call, then the first operand can be found at pc
      // + instruction size.
      case Opcode.Call:
        const pc = this.runContext.getPc();
        const { value, error } = pc.add(instruction.size());
        if (error !== undefined) {
          return { value: undefined, error };
        }
        return { value: [value, undefined], error: undefined };
      // If the opcode is an assert eq, then we can deduce the first operand
      // based on the result logic. For add, res = op0 + op1. For mul,
      // res = op0 * op1. We also know that the result is the same as
      // the destination operand.
      case Opcode.AssertEq:
        switch (instruction.resLogic) {
          case ResLogic.Add:
            if (dst !== undefined && op1 !== undefined) {
              const { value, error } = dst.sub(op1);
              if (error !== undefined) {
                return { value: undefined, error };
              }
              return { value: [value, dst], error: undefined };
            }
          case ResLogic.Mul:
            if (dst !== undefined && op1 !== undefined) {
              const { value, error } = dst.div(op1);
              if (error !== undefined) {
                return { value: [undefined, undefined], error: undefined };
              }
              return { value: [value, dst], error: undefined };
            }
            break;
        }
    }
    return { value: [undefined, undefined], error: undefined };
  }

  deduceOp1(
    instruction: Instruction,
    dst: MaybeRelocatable | undefined,
    op0: MaybeRelocatable | undefined
  ): Result<[MaybeRelocatable | undefined, MaybeRelocatable | undefined]> {
    // We can deduce the second operand from the destination and the first
    // operand, based on the result logic, only if the opcode is an assert eq
    // because this is the only opcode that allows us to assume dst = res.
    if (instruction.opcode === Opcode.AssertEq) {
      switch (instruction.resLogic) {
        // If the result logic is op1, then res = op1 = dst.
        case ResLogic.Op1:
          return { value: [dst, dst], error: undefined };
        // If the result logic is add, then the second operand is the destination
        // operand subtracted from the first operand.
        case ResLogic.Add:
          if (dst !== undefined && op0 !== undefined) {
            const { value, error } = dst.sub(op0);
            if (error !== undefined) {
              return { value: undefined, error };
            }
            return { value: [value, dst], error: undefined };
          }
          break;
        // If the result logic is mul, then the second operand is the destination
        // operand divided from the first operand.
        case ResLogic.Mul:
          if (dst !== undefined && op0 !== undefined) {
            const { value, error } = dst.div(op0);
            if (error !== undefined) {
              return { value: [undefined, undefined], error: undefined };
            }
            return { value: [value, dst], error: undefined };
          }
          break;
      }
    }
    return { value: [undefined, undefined], error: undefined };
  }

  // Compute the result of an instruction based on result logic
  // for the instruction.
  computeRes(
    instruction: Instruction,
    op0: MaybeRelocatable,
    op1: MaybeRelocatable
  ): Result<MaybeRelocatable | undefined> {
    switch (instruction.resLogic) {
      case ResLogic.Op1:
        return { value: op1, error: undefined };
      case ResLogic.Add:
        return op0.add(op1);
      case ResLogic.Mul:
        return op0.mul(op1);
      case ResLogic.Unconstrained:
        return { value: undefined, error: undefined };
    }
  }

  // Deduce the destination of an instruction. We can only deduce
  // for assert eq and call instructions.
  deduceDst(
    instruction: Instruction,
    res: MaybeRelocatable | undefined
  ): Result<MaybeRelocatable | undefined> {
    switch (instruction.opcode) {
      // As stated above, for an assert eq instruction, we have res = dst.
      case Opcode.AssertEq:
        return { value: res, error: undefined };
      // For a call instruction, we have dst = fp.
      case Opcode.Call:
        return { value: this.runContext.getFp(), error: undefined };
    }
    return { value: undefined, error: undefined };
  }

  // When using the assert or the call opcode, we need to assert that the following
  // conditions are met:
  //    - For assert eq, res = dst
  //    - For call, op0 = pc + instruction size and dst = fp
  opcodeAssertion(instruction: Instruction, operands: Operands): Result<void> {
    switch (instruction.opcode) {
      // For a assert eq, check that res is defined and equals dst.
      // This is because dst represents the left side of the computation, and
      // res represents the right side of the computation.
      case Opcode.AssertEq:
        if (operands.res === undefined) {
          return {
            value: undefined,
            error: new BaseError(ErrorType.VMError, UnconstrainedResError),
          };
        }
        if (operands.dst !== operands.res) {
          return {
            value: undefined,
            error: new BaseError(ErrorType.VMError, DiffAssertValuesError),
          };
        }
        break;
      // For a call, check that op0 = pc + instruction size and dst = fp.
      // op0 is used to store the return pc (the address of the instruction
      // following the call instruction). dst is used to store the frame pointer.
      case Opcode.Call:
        const { value: returnPc, error: returnPcError } = this.runContext
          .getPc()
          .add(instruction.size());
        if (returnPcError !== undefined) {
          return { value: undefined, error: returnPcError };
        }
        if (operands.op0 === undefined || !returnPc.eq(operands.op0)) {
          return {
            value: undefined,
            error: new BaseError(ErrorType.VMError, InvalidOperand0),
          };
        }
        const fp = this.runContext.getFp();
        if (fp !== operands.dst) {
          return {
            value: undefined,
            error: new BaseError(ErrorType.VMError, InvalidDstOperand),
          };
        }
        break;
    }
    return { value: undefined, error: undefined };
  }
}
