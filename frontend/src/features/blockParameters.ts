/**
 * Parameter rules of the blocks, one table for the editor and the JSON import.
 *
 * Mirrors validate_parameters() in backend/app/core/block_specs.py. The
 * server stays the source of truth (it checks again before every assembly);
 * these rules exist to point at the faulty block before a request is sent.
 */

import type { BlockType } from "../types/diagram";

export interface ParameterProblem {
  key: string;
  message: string;
}

type Parameters = Record<string, unknown>;

function toNumber(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && raw.trim().length > 0) return Number(raw);
  return Number.NaN;
}

class Checker {
  readonly problems: ParameterProblem[] = [];

  constructor(private readonly parameters: Parameters) {}

  fail(key: string, message: string): void {
    this.problems.push({ key, message });
  }

  number(key: string, fallback: number): number | null {
    const value = toNumber(this.parameters[key] ?? fallback);
    if (!Number.isFinite(value)) {
      this.fail(key, `параметр ${key} должен быть конечным числом`);
      return null;
    }
    return value;
  }

  vector(key: string, fallback: number[]): number[] | null {
    const raw = this.parameters[key] ?? fallback;
    if (!Array.isArray(raw) || raw.length === 0) {
      this.fail(key, `параметр ${key} должен быть непустым массивом чисел`);
      return null;
    }
    const values = raw.map(toNumber);
    if (values.some((value) => !Number.isFinite(value))) {
      this.fail(key, `параметр ${key} содержит нечисловое значение`);
      return null;
    }
    return values;
  }

  require(key: string, value: number | null, ok: (value: number) => boolean, requirement: string): void {
    if (value !== null && !ok(value)) this.fail(key, `параметр ${key} ${requirement}`);
  }
}

export function polynomialOrder(coefficients: readonly number[]): number {
  const first = coefficients.findIndex((coefficient) => coefficient !== 0);
  return first < 0 ? 0 : coefficients.length - first - 1;
}

export function blockParameterProblems(type: BlockType, parameters: Parameters): ParameterProblem[] {
  const check = new Checker(parameters);
  switch (type) {
    case "StepInput":
      check.number("amplitude", 1);
      check.number("t0", 0);
      break;
    case "Gain":
      check.number("k", 1);
      break;
    case "Integrator":
      check.number("k", 1);
      check.number("y0", 0);
      break;
    case "FirstOrderLag":
      check.number("k", 1);
      check.require("T", check.number("T", 1), (v) => v > 0, "должен быть больше 0");
      check.number("y0", 0);
      break;
    case "SecondOrderOscillator":
      check.number("k", 1);
      check.require("wn", check.number("wn", 1), (v) => v > 0, "должен быть больше 0");
      check.require("zeta", check.number("zeta", 0.2), (v) => v >= 0, "не должен быть меньше 0");
      check.number("y0", 0);
      check.number("v0", 0);
      break;
    case "TransferFunction": {
      const numerator = check.vector("numerator", [1]);
      const denominator = check.vector("denominator", [1, 1]);
      if (denominator && denominator[0] === 0) {
        check.fail("denominator", "старший коэффициент знаменателя не должен быть равен 0");
      } else if (numerator && denominator && polynomialOrder(numerator) > denominator.length - 1) {
        check.fail("numerator", "порядок числителя не должен превышать порядок знаменателя");
      }
      break;
    }
    case "PIDController":
      check.number("kp", 1);
      check.number("ki", 0);
      check.number("kd", 0);
      check.require("filter_n", check.number("filter_n", 20), (v) => v > 0, "должен быть больше 0");
      break;
    case "ButterworthLPF":
      check.require("order", check.number("order", 2), (v) => Number.isInteger(v) && v >= 1 && v <= 10,
        "должен быть целым числом от 1 до 10");
      check.require("cutoff_freq", check.number("cutoff_freq", 10), (v) => v > 0, "должен быть больше 0");
      check.number("y0", 0);
      break;
    case "Sum": {
      const signs = parameters.signs ?? ["+", "-"];
      if (!Array.isArray(signs) || signs.length === 0) {
        check.fail("signs", "параметр signs должен быть непустым списком знаков");
      } else if (signs.some((sign) => sign !== "+" && sign !== "-")) {
        check.fail("signs", "параметр signs может содержать только «+» и «-»");
      }
      break;
    }
    case "Scope":
      if (parameters.label !== undefined && parameters.label !== null && typeof parameters.label === "object") {
        check.fail("label", "имя сигнала должно быть строкой");
      }
      if ("reference" in parameters) check.number("reference", 0);
      break;
    case "SubsystemInput":
    case "SubsystemOutput":
      if (typeof parameters.port !== "string" || parameters.port.trim().length === 0) {
        check.fail("port", "имя внешнего порта не задано");
      }
      break;
    case "Subsystem":
      break;
  }
  return check.problems;
}
