import type { BlockType, Diagram, DiagramBlock } from "../types/diagram";

export interface ExamplePreset {
  id: string;
  title: string;
  diagram: Diagram;
  positions: Record<string, { x: number; y: number }>;
}

function dynamicBlock(
  id: string,
  type: Exclude<BlockType, "Subsystem" | "SubsystemInput" | "SubsystemOutput" | "StepInput" | "Scope">,
  parameters: Record<string, unknown>,
): DiagramBlock {
  return {
    id,
    type,
    parameters,
    input_ports: ["in"],
    output_ports: ["out"],
  };
}

function wrapSubsystem(id: string, name: string, core: DiagramBlock): DiagramBlock {
  return {
    id,
    type: "Subsystem",
    parameters: {
      name,
      diagram: {
        blocks: [
          { id: "input", type: "SubsystemInput", parameters: { port: "in" }, input_ports: [], output_ports: ["out"] },
          core,
          { id: "output", type: "SubsystemOutput", parameters: { port: "out" }, input_ports: ["in"], output_ports: [] },
        ],
        connections: [
          { from_block: "input", from_port: "out", to_block: core.id, to_port: "in" },
          { from_block: core.id, from_port: "out", to_block: "output", to_port: "in" },
        ],
      },
      layout: {
        positions: {
          input: { x: 40, y: 150 },
          [core.id]: { x: 290, y: 150 },
          output: { x: 540, y: 150 },
        },
      },
    },
    input_ports: ["in"],
    output_ports: ["out"],
  };
}

function sourceSubsystem(id: string, name: string): DiagramBlock {
  return {
    id,
    type: "Subsystem",
    parameters: {
      name,
      diagram: {
        blocks: [
          { id: "step", type: "StepInput", parameters: { amplitude: 1, t0: 0 }, input_ports: [], output_ports: ["out"] },
          { id: "output", type: "SubsystemOutput", parameters: { port: "out" }, input_ports: ["in"], output_ports: [] },
        ],
        connections: [
          { from_block: "step", from_port: "out", to_block: "output", to_port: "in" },
        ],
      },
      layout: {
        positions: {
          step: { x: 60, y: 150 },
          output: { x: 330, y: 150 },
        },
      },
    },
    input_ports: [],
    output_ports: ["out"],
  };
}

function sinkSubsystem(id: string, name: string, core: DiagramBlock): DiagramBlock {
  return {
    id,
    type: "Subsystem",
    parameters: {
      name,
      diagram: {
        blocks: [
          { id: "input", type: "SubsystemInput", parameters: { port: "in" }, input_ports: [], output_ports: ["out"] },
          core,
          { id: "scope", type: "Scope", parameters: { label: "omega" }, input_ports: ["in"], output_ports: [] },
        ],
        connections: [
          { from_block: "input", from_port: "out", to_block: core.id, to_port: "in" },
          { from_block: core.id, from_port: "out", to_block: "scope", to_port: "in" },
        ],
      },
      layout: {
        positions: {
          input: { x: 40, y: 150 },
          [core.id]: { x: 290, y: 150 },
          scope: { x: 540, y: 150 },
        },
      },
    },
    input_ports: ["in"],
    output_ports: [],
  };
}

const compactMeasurementSubsystem = sinkSubsystem(
  "measurement",
  "Измерение",
  wrapSubsystem(
    "sensor_path",
    "Измерительный тракт",
    wrapSubsystem(
      "adc_stage",
      "АЦП и нормализация",
      wrapSubsystem(
        "signal_filter",
        "Фильтр сигнала",
        dynamicBlock("filter", "FirstOrderLag", { k: 1, T: 0.05, y0: 0 }),
      ),
    ),
  ),
);

export const EXAMPLE_PRESETS: ExamplePreset[] = [
  {
    id: "defenseDemo",
    title: "Демонстрация для защиты",
    diagram: {
      blocks: [
        {
          id: "control_input",
          type: "StepInput",
          parameters: { amplitude: 1, t0: 0 },
          input_ports: [],
          output_ports: ["out"],
        },
        {
          id: "plant",
          type: "SecondOrderOscillator",
          parameters: { k: 1, wn: 2.5, zeta: 0.45, y0: 0, v0: 0 },
          input_ports: ["in"],
          output_ports: ["out"],
        },
        {
          id: "measured_output",
          type: "Scope",
          parameters: { name: "Измеряемый выход", label: "y" },
          input_ports: ["in"],
          output_ports: [],
        },
      ],
      connections: [
        { from_block: "control_input", from_port: "out", to_block: "plant", to_port: "in" },
        { from_block: "plant", from_port: "out", to_block: "measured_output", to_port: "in" },
      ],
    },
    positions: {
      control_input: { x: 80, y: 190 },
      plant: { x: 360, y: 190 },
      measured_output: { x: 640, y: 190 },
    },
  },
  {
    id: "gain",
    title: "Только усиление",
    diagram: {
      blocks: [
        {
          id: "step1",
          type: "StepInput",
          parameters: { amplitude: 1, t0: 0 },
          input_ports: [],
          output_ports: ["out"]
        },
        {
          id: "gain1",
          type: "PIDController",
          parameters: { kp: 2, ki: 0, kd: 0, filter_n: 20 },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "scope1",
          type: "Scope",
          parameters: { label: "y" },
          input_ports: ["in"],
          output_ports: []
        }
      ],
      connections: [
        { from_block: "step1", from_port: "out", to_block: "gain1", to_port: "in" },
        { from_block: "gain1", from_port: "out", to_block: "scope1", to_port: "in" }
      ]
    },
    positions: {
      step1: { x: 40, y: 100 },
      gain1: { x: 260, y: 100 },
      scope1: { x: 500, y: 100 }
    }
  },
  {
    id: "integrator",
    title: "Интегратор + ступень",
    diagram: {
      blocks: [
        {
          id: "step1",
          type: "StepInput",
          parameters: { amplitude: 1, t0: 0 },
          input_ports: [],
          output_ports: ["out"]
        },
        {
          id: "int1",
          type: "Integrator",
          parameters: { k: 1, y0: 0 },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "scope1",
          type: "Scope",
          parameters: { label: "y" },
          input_ports: ["in"],
          output_ports: []
        }
      ],
      connections: [
        { from_block: "step1", from_port: "out", to_block: "int1", to_port: "in" },
        { from_block: "int1", from_port: "out", to_block: "scope1", to_port: "in" }
      ]
    },
    positions: {
      step1: { x: 40, y: 140 },
      int1: { x: 260, y: 140 },
      scope1: { x: 500, y: 140 }
    }
  },
  {
    id: "firstOrder",
    title: "Звено 1-го порядка + ступень",
    diagram: {
      blocks: [
        {
          id: "step1",
          type: "StepInput",
          parameters: { amplitude: 1, t0: 0 },
          input_ports: [],
          output_ports: ["out"]
        },
        {
          id: "lag1",
          type: "FirstOrderLag",
          parameters: { k: 2, T: 0.5, y0: 0 },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "scope1",
          type: "Scope",
          parameters: { label: "y" },
          input_ports: ["in"],
          output_ports: []
        }
      ],
      connections: [
        { from_block: "step1", from_port: "out", to_block: "lag1", to_port: "in" },
        { from_block: "lag1", from_port: "out", to_block: "scope1", to_port: "in" }
      ]
    },
    positions: {
      step1: { x: 40, y: 180 },
      lag1: { x: 260, y: 180 },
      scope1: { x: 500, y: 180 }
    }
  },
  {
    id: "secondOrder",
    title: "Колебательное звено + ступень",
    diagram: {
      blocks: [
        {
          id: "step1",
          type: "StepInput",
          parameters: { amplitude: 1, t0: 0 },
          input_ports: [],
          output_ports: ["out"]
        },
        {
          id: "osc1",
          type: "SecondOrderOscillator",
          parameters: { k: 1.5, wn: 3, zeta: 0.2, y0: 0, v0: 0 },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "scope1",
          type: "Scope",
          parameters: { label: "y" },
          input_ports: ["in"],
          output_ports: []
        }
      ],
      connections: [
        { from_block: "step1", from_port: "out", to_block: "osc1", to_port: "in" },
        { from_block: "osc1", from_port: "out", to_block: "scope1", to_port: "in" }
      ]
    },
    positions: {
      step1: { x: 40, y: 220 },
      osc1: { x: 280, y: 220 },
      scope1: { x: 540, y: 220 }
    }
  },
  {
    id: "closedLoop",
    title: "Замкнутый контур с отрицательной ОС",
    diagram: {
      blocks: [
        {
          id: "step1",
          type: "StepInput",
          parameters: { amplitude: 1, t0: 0 },
          input_ports: [],
          output_ports: ["out"]
        },
        {
          id: "sum1",
          type: "Sum",
          parameters: { signs: ["+", "-"] },
          input_ports: ["in1", "in2"],
          output_ports: ["out"]
        },
        {
          id: "lag1",
          type: "FirstOrderLag",
          parameters: { k: 1, T: 0.8, y0: 0 },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "fb1",
          type: "Gain",
          parameters: { k: 1 },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "scope1",
          type: "Scope",
          parameters: { label: "y" },
          input_ports: ["in"],
          output_ports: []
        }
      ],
      connections: [
        { from_block: "step1", from_port: "out", to_block: "sum1", to_port: "in1" },
        { from_block: "sum1", from_port: "out", to_block: "lag1", to_port: "in" },
        { from_block: "lag1", from_port: "out", to_block: "fb1", to_port: "in" },
        { from_block: "fb1", from_port: "out", to_block: "sum1", to_port: "in2" },
        { from_block: "lag1", from_port: "out", to_block: "scope1", to_port: "in" }
      ]
    },
    positions: {
      step1: { x: 40, y: 160 },
      sum1: { x: 260, y: 160 },
      lag1: { x: 440, y: 160 },
      fb1: { x: 440, y: 320 },
      scope1: { x: 660, y: 160 }
    }
  },
  {
    id: "closedLoopPController",
    title: "Замкнутый контур с P-регулятором",
    diagram: {
      blocks: [
        {
          id: "step1",
          type: "StepInput",
          parameters: { amplitude: 1, t0: 0 },
          input_ports: [],
          output_ports: ["out"]
        },
        {
          id: "sum1",
          type: "Sum",
          parameters: { signs: ["+", "-"] },
          input_ports: ["in1", "in2"],
          output_ports: ["out"]
        },
        {
          id: "controller1",
          type: "Gain",
          parameters: { k: 2 },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "plant1",
          type: "TransferFunction",
          parameters: { numerator: [1], denominator: [1, 1] },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "scope1",
          type: "Scope",
          parameters: { label: "y" },
          input_ports: ["in"],
          output_ports: []
        }
      ],
      connections: [
        { from_block: "step1", from_port: "out", to_block: "sum1", to_port: "in1" },
        { from_block: "sum1", from_port: "out", to_block: "controller1", to_port: "in" },
        { from_block: "controller1", from_port: "out", to_block: "plant1", to_port: "in" },
        { from_block: "plant1", from_port: "out", to_block: "scope1", to_port: "in" },
        { from_block: "plant1", from_port: "out", to_block: "sum1", to_port: "in2" }
      ]
    },
    positions: {
      step1: { x: 40, y: 150 },
      sum1: { x: 260, y: 140 },
      controller1: { x: 500, y: 150 },
      plant1: { x: 760, y: 150 },
      scope1: { x: 1040, y: 150 }
    }
  },
  {
    id: "parallelTransferFunctions",
    title: "Параллельные ветви в сумматор",
    diagram: {
      blocks: [
        {
          id: "step1",
          type: "StepInput",
          parameters: { amplitude: 1, t0: 0 },
          input_ports: [],
          output_ports: ["out"]
        },
        {
          id: "tf1",
          type: "TransferFunction",
          parameters: { numerator: [1], denominator: [1, 1] },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "tf2",
          type: "TransferFunction",
          parameters: { numerator: [2], denominator: [1, 2] },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "tf3",
          type: "TransferFunction",
          parameters: { numerator: [0.5], denominator: [1, 0.5] },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "sum1",
          type: "Sum",
          parameters: { signs: ["+", "+", "+"] },
          input_ports: ["in1", "in2", "in3"],
          output_ports: ["out"]
        },
        {
          id: "scope1",
          type: "Scope",
          parameters: { label: "y" },
          input_ports: ["in"],
          output_ports: []
        }
      ],
      connections: [
        { from_block: "step1", from_port: "out", to_block: "tf1", to_port: "in" },
        { from_block: "step1", from_port: "out", to_block: "tf2", to_port: "in" },
        { from_block: "step1", from_port: "out", to_block: "tf3", to_port: "in" },
        { from_block: "tf1", from_port: "out", to_block: "sum1", to_port: "in1" },
        { from_block: "tf2", from_port: "out", to_block: "sum1", to_port: "in2" },
        { from_block: "tf3", from_port: "out", to_block: "sum1", to_port: "in3" },
        { from_block: "sum1", from_port: "out", to_block: "scope1", to_port: "in" }
      ]
    },
    positions: {
      step1: { x: 40, y: 210 },
      tf1: { x: 300, y: 60 },
      tf2: { x: 300, y: 210 },
      tf3: { x: 300, y: 360 },
      sum1: { x: 640, y: 185 },
      scope1: { x: 930, y: 210 }
    }
  },
  {
    id: "unstableTransferFunction",
    title: "Неустойчивое звено",
    diagram: {
      blocks: [
        {
          id: "step1",
          type: "StepInput",
          parameters: { amplitude: 1, t0: 0 },
          input_ports: [],
          output_ports: ["out"]
        },
        {
          id: "tf1",
          type: "TransferFunction",
          parameters: { numerator: [1], denominator: [1, -1] },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "scope1",
          type: "Scope",
          parameters: { label: "y" },
          input_ports: ["in"],
          output_ports: []
        }
      ],
      connections: [
        { from_block: "step1", from_port: "out", to_block: "tf1", to_port: "in" },
        { from_block: "tf1", from_port: "out", to_block: "scope1", to_port: "in" }
      ]
    },
    positions: {
      step1: { x: 40, y: 160 },
      tf1: { x: 300, y: 160 },
      scope1: { x: 560, y: 160 }
    }
  },
  {
    id: "butterworthSimple",
    title: "ФНЧ Баттерворта + ступень",
    diagram: {
      blocks: [
        {
          id: "step1",
          type: "StepInput",
          parameters: { amplitude: 1, t0: 0 },
          input_ports: [],
          output_ports: ["out"]
        },
        {
          id: "bw1",
          type: "ButterworthLPF",
          parameters: { order: 2, cutoff_freq: 10, y0: 0 },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "scope1",
          type: "Scope",
          parameters: { label: "y" },
          input_ports: ["in"],
          output_ports: []
        }
      ],
      connections: [
        { from_block: "step1", from_port: "out", to_block: "bw1", to_port: "in" },
        { from_block: "bw1", from_port: "out", to_block: "scope1", to_port: "in" }
      ]
    },
    positions: {
      step1: { x: 40, y: 140 },
      bw1: { x: 300, y: 140 },
      scope1: { x: 580, y: 140 }
    }
  },
  {
    id: "butterworthClosedLoop",
    title: "Замкнутый контур с ФНЧ Баттерворта",
    diagram: {
      blocks: [
        {
          id: "step1",
          type: "StepInput",
          parameters: { amplitude: 1, t0: 0 },
          input_ports: [],
          output_ports: ["out"]
        },
        {
          id: "sum1",
          type: "Sum",
          parameters: { signs: ["+", "-"] },
          input_ports: ["in1", "in2"],
          output_ports: ["out"]
        },
        {
          id: "gain1",
          type: "Gain",
          parameters: { k: 5 },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "bw1",
          type: "ButterworthLPF",
          parameters: { order: 3, cutoff_freq: 8, y0: 0 },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "scope1",
          type: "Scope",
          parameters: { label: "y" },
          input_ports: ["in"],
          output_ports: []
        }
      ],
      connections: [
        { from_block: "step1", from_port: "out", to_block: "sum1", to_port: "in1" },
        { from_block: "sum1", from_port: "out", to_block: "gain1", to_port: "in" },
        { from_block: "gain1", from_port: "out", to_block: "bw1", to_port: "in" },
        { from_block: "bw1", from_port: "out", to_block: "scope1", to_port: "in" },
        { from_block: "bw1", from_port: "out", to_block: "sum1", to_port: "in2" }
      ]
    },
    positions: {
      step1: { x: 40, y: 150 },
      sum1: { x: 260, y: 150 },
      gain1: { x: 480, y: 150 },
      bw1: { x: 720, y: 150 },
      scope1: { x: 980, y: 150 }
    }
  },
  {
    id: "pidClosedLoop",
    title: "Замкнутый контур с PID-регулятором",
    diagram: {
      blocks: [
        {
          id: "reference",
          type: "StepInput",
          parameters: { amplitude: 1, t0: 0 },
          input_ports: [],
          output_ports: ["out"]
        },
        {
          id: "error",
          type: "Sum",
          parameters: { signs: ["+", "-"] },
          input_ports: ["in1", "in2"],
          output_ports: ["out"]
        },
        {
          id: "pid",
          type: "PIDController",
          parameters: { kp: 2.4, ki: 1.1, kd: 0.08, filter_n: 20 },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "plant",
          type: "SecondOrderOscillator",
          parameters: { k: 1, wn: 2.5, zeta: 0.55, y0: 0, v0: 0 },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "scope",
          type: "Scope",
          parameters: { label: "y" },
          input_ports: ["in"],
          output_ports: []
        }
      ],
      connections: [
        { from_block: "reference", from_port: "out", to_block: "error", to_port: "in1" },
        { from_block: "error", from_port: "out", to_block: "pid", to_port: "in" },
        { from_block: "pid", from_port: "out", to_block: "plant", to_port: "in" },
        { from_block: "plant", from_port: "out", to_block: "scope", to_port: "in" },
        { from_block: "plant", from_port: "out", to_block: "error", to_port: "in2" }
      ]
    },
    positions: {
      reference: { x: 20, y: 150 },
      error: { x: 235, y: 140 },
      pid: { x: 455, y: 150 },
      plant: { x: 700, y: 150 },
      scope: { x: 960, y: 150 }
    }
  },
  {
    id: "dcMotorSpeedControl",
    title: "САУ скоростью двигателя постоянного тока",
    diagram: {
      blocks: [
        {
          id: "speed_setpoint",
          type: "StepInput",
          parameters: { name: "Заданная скорость", amplitude: 1, t0: 0 },
          input_ports: [],
          output_ports: ["out"]
        },
        {
          id: "speed_error",
          type: "Sum",
          parameters: { name: "Ошибка e(t)", signs: ["+", "-"] },
          input_ports: ["in1", "in2"],
          output_ports: ["out"]
        },
        {
          id: "speed_pid",
          type: "PIDController",
          parameters: { name: "Регулятор скорости", kp: 0.5, ki: 0.5, kd: 0.02, filter_n: 20 },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "dc_motor",
          type: "Subsystem",
          parameters: {
            name: "Двигатель DC",
            diagram: {
              blocks: [
                {
                  id: "voltage_in",
                  type: "SubsystemInput",
                  parameters: { name: "Напряжение u", port: "u" },
                  input_ports: [],
                  output_ports: ["out"]
                },
                {
                  id: "voltage_sum",
                  type: "Sum",
                  parameters: { name: "u − Kₑω", signs: ["+", "-"] },
                  input_ports: ["in1", "in2"],
                  output_ports: ["out"]
                },
                {
                  id: "electromagnetic",
                  type: "TransferFunction",
                  parameters: {
                    name: "Якорная цепь и момент",
                    numerator: [0.1],
                    denominator: [0.1, 2]
                  },
                  input_ports: ["in"],
                  output_ports: ["out"]
                },
                {
                  id: "mechanics",
                  type: "TransferFunction",
                  parameters: {
                    name: "Механическая часть",
                    numerator: [1],
                    denominator: [0.02, 0.02]
                  },
                  input_ports: ["in"],
                  output_ports: ["out"]
                },
                {
                  id: "back_emf",
                  type: "Gain",
                  parameters: { name: "Противо-ЭДС", k: 0.1 },
                  input_ports: ["in"],
                  output_ports: ["out"]
                },
                {
                  id: "speed_out",
                  type: "SubsystemOutput",
                  parameters: { name: "Скорость ω", port: "omega" },
                  input_ports: ["in"],
                  output_ports: []
                }
              ],
              connections: [
                { from_block: "voltage_in", from_port: "out", to_block: "voltage_sum", to_port: "in1" },
                { from_block: "voltage_sum", from_port: "out", to_block: "electromagnetic", to_port: "in" },
                { from_block: "electromagnetic", from_port: "out", to_block: "mechanics", to_port: "in" },
                { from_block: "mechanics", from_port: "out", to_block: "speed_out", to_port: "in" },
                { from_block: "mechanics", from_port: "out", to_block: "back_emf", to_port: "in" },
                { from_block: "back_emf", from_port: "out", to_block: "voltage_sum", to_port: "in2" }
              ]
            },
            layout: {
              positions: {
                voltage_in: { x: 20, y: 170 },
                voltage_sum: { x: 230, y: 160 },
                electromagnetic: { x: 470, y: 170 },
                mechanics: { x: 730, y: 170 },
                speed_out: { x: 1010, y: 170 },
                back_emf: { x: 790, y: 380 }
              }
            }
          },
          input_ports: ["u"],
          output_ports: ["omega"]
        },
        {
          id: "speed_scope",
          type: "Scope",
          parameters: { name: "Скорость двигателя", label: "ω(t), рад/с", reference: 1 },
          input_ports: ["in"],
          output_ports: []
        }
      ],
      connections: [
        { from_block: "speed_setpoint", from_port: "out", to_block: "speed_error", to_port: "in1" },
        { from_block: "speed_error", from_port: "out", to_block: "speed_pid", to_port: "in" },
        { from_block: "speed_pid", from_port: "out", to_block: "dc_motor", to_port: "u" },
        { from_block: "dc_motor", from_port: "omega", to_block: "speed_scope", to_port: "in" },
        { from_block: "dc_motor", from_port: "omega", to_block: "speed_error", to_port: "in2" }
      ]
    },
    positions: {
      speed_setpoint: { x: 20, y: 180 },
      speed_error: { x: 330, y: 170 },
      speed_pid: { x: 640, y: 180 },
      dc_motor: { x: 970, y: 170 },
      speed_scope: { x: 1300, y: 180 }
    }
  },
  {
    id: "compactSubsystemChain",
    title: "5 подсистем: компактная цепочка",
    diagram: {
      blocks: [
        sourceSubsystem("reference", "Фильтр задания"),
        wrapSubsystem(
          "controller",
          "PID-контур",
          dynamicBlock("pid", "PIDController", { kp: 2.4, ki: 1.1, kd: 0.08, filter_n: 20 }),
        ),
        wrapSubsystem(
          "drive",
          "Силовой привод",
          dynamicBlock("drive_lag", "FirstOrderLag", { k: 1, T: 0.12, y0: 0 }),
        ),
        wrapSubsystem(
          "motor",
          "Двигатель DC",
          dynamicBlock("motor_model", "SecondOrderOscillator", { k: 1, wn: 3.2, zeta: 0.62, y0: 0, v0: 0 }),
        ),
        compactMeasurementSubsystem,
      ],
      connections: [
        { from_block: "reference", from_port: "out", to_block: "controller", to_port: "in" },
        { from_block: "controller", from_port: "out", to_block: "drive", to_port: "in" },
        { from_block: "drive", from_port: "out", to_block: "motor", to_port: "in" },
        { from_block: "motor", from_port: "out", to_block: "measurement", to_port: "in" },
      ],
    },
    positions: {
      reference: { x: 20, y: 170 },
      controller: { x: 230, y: 170 },
      drive: { x: 440, y: 170 },
      motor: { x: 650, y: 170 },
      measurement: { x: 860, y: 170 },
    },
  },
  {
    id: "hierarchicalPlant",
    title: "Подсистема: объект 1-го порядка",
    diagram: {
      blocks: [
        {
          id: "step1",
          type: "StepInput",
          parameters: { amplitude: 1, t0: 0 },
          input_ports: [],
          output_ports: ["out"]
        },
        {
          id: "plant",
          type: "Subsystem",
          parameters: {
            name: "Объект управления",
            diagram: {
              blocks: [
                { id: "input", type: "SubsystemInput", parameters: { port: "in" }, input_ports: [], output_ports: ["out"] },
                { id: "lag", type: "FirstOrderLag", parameters: { k: 2, T: 0.5, y0: 0 }, input_ports: ["in"], output_ports: ["out"] },
                { id: "output", type: "SubsystemOutput", parameters: { port: "out" }, input_ports: ["in"], output_ports: [] }
              ],
              connections: [
                { from_block: "input", from_port: "out", to_block: "lag", to_port: "in" },
                { from_block: "lag", from_port: "out", to_block: "output", to_port: "in" }
              ]
            },
            layout: {
              positions: {
                input: { x: 40, y: 150 },
                lag: { x: 290, y: 150 },
                output: { x: 560, y: 150 }
              }
            }
          },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "scope1",
          type: "Scope",
          parameters: { label: "y" },
          input_ports: ["in"],
          output_ports: []
        }
      ],
      connections: [
        { from_block: "step1", from_port: "out", to_block: "plant", to_port: "in" },
        { from_block: "plant", from_port: "out", to_block: "scope1", to_port: "in" }
      ]
    },
    positions: {
      step1: { x: 40, y: 160 },
      plant: { x: 300, y: 160 },
      scope1: { x: 900, y: 160 }
    }
  },
  {
    id: "nestedCascade",
    title: "3 уровня: каскад звеньев",
    diagram: {
      blocks: [
        {
          id: "step",
          type: "StepInput",
          parameters: { amplitude: 1, t0: 0 },
          input_ports: [],
          output_ports: ["out"]
        },
        {
          id: "cascade",
          type: "Subsystem",
          parameters: {
            name: "Каскад звеньев",
            diagram: {
              blocks: [
                { id: "input", type: "SubsystemInput", parameters: { port: "in" }, input_ports: [], output_ports: ["out"] },
                {
                  id: "fast_stage",
                  type: "Subsystem",
                  parameters: {
                    name: "Быстрое звено",
                    diagram: {
                      blocks: [
                        { id: "input", type: "SubsystemInput", parameters: { port: "in" }, input_ports: [], output_ports: ["out"] },
                        { id: "lag_fast", type: "FirstOrderLag", parameters: { k: 1.5, T: 0.25, y0: 0 }, input_ports: ["in"], output_ports: ["out"] },
                        { id: "output", type: "SubsystemOutput", parameters: { port: "out" }, input_ports: ["in"], output_ports: [] }
                      ],
                      connections: [
                        { from_block: "input", from_port: "out", to_block: "lag_fast", to_port: "in" },
                        { from_block: "lag_fast", from_port: "out", to_block: "output", to_port: "in" }
                      ]
                    },
                    layout: {
                      positions: {
                        input: { x: 40, y: 150 },
                        lag_fast: { x: 290, y: 150 },
                        output: { x: 560, y: 150 }
                      }
                    }
                  },
                  input_ports: ["in"],
                  output_ports: ["out"]
                },
                { id: "lag_slow", type: "FirstOrderLag", parameters: { k: 0.8, T: 0.6, y0: 0 }, input_ports: ["in"], output_ports: ["out"] },
                { id: "output", type: "SubsystemOutput", parameters: { port: "out" }, input_ports: ["in"], output_ports: [] }
              ],
              connections: [
                { from_block: "input", from_port: "out", to_block: "fast_stage", to_port: "in" },
                { from_block: "fast_stage", from_port: "out", to_block: "lag_slow", to_port: "in" },
                { from_block: "lag_slow", from_port: "out", to_block: "output", to_port: "in" }
              ]
            },
            layout: {
              positions: {
                input: { x: 30, y: 150 },
                fast_stage: { x: 260, y: 150 },
                lag_slow: { x: 520, y: 150 },
                output: { x: 790, y: 150 }
              }
            }
          },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        { id: "scope", type: "Scope", parameters: { label: "y" }, input_ports: ["in"], output_ports: [] }
      ],
      connections: [
        { from_block: "step", from_port: "out", to_block: "cascade", to_port: "in" },
        { from_block: "cascade", from_port: "out", to_block: "scope", to_port: "in" }
      ]
    },
    positions: {
      step: { x: 40, y: 160 },
      cascade: { x: 300, y: 160 },
      scope: { x: 900, y: 160 }
    }
  },
  {
    id: "hierarchicalClosedLoop",
    title: "Подсистемы: замкнутая САУ",
    diagram: {
      blocks: [
        { id: "reference", type: "StepInput", parameters: { amplitude: 1, t0: 0 }, input_ports: [], output_ports: ["out"] },
        { id: "error", type: "Sum", parameters: { signs: ["+", "-"] }, input_ports: ["in1", "in2"], output_ports: ["out"] },
        {
          id: "controller",
          type: "Subsystem",
          parameters: {
            name: "Регулятор",
            diagram: {
              blocks: [
                { id: "input", type: "SubsystemInput", parameters: { port: "in" }, input_ports: [], output_ports: ["out"] },
                { id: "gain", type: "Gain", parameters: { k: 2 }, input_ports: ["in"], output_ports: ["out"] },
                { id: "output", type: "SubsystemOutput", parameters: { port: "out" }, input_ports: ["in"], output_ports: [] }
              ],
              connections: [
                { from_block: "input", from_port: "out", to_block: "gain", to_port: "in" },
                { from_block: "gain", from_port: "out", to_block: "output", to_port: "in" }
              ]
            },
            layout: {
              positions: {
                input: { x: 40, y: 150 },
                gain: { x: 290, y: 150 },
                output: { x: 560, y: 150 }
              }
            }
          },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        {
          id: "plant",
          type: "Subsystem",
          parameters: {
            name: "Объект управления",
            diagram: {
              blocks: [
                { id: "input", type: "SubsystemInput", parameters: { port: "in" }, input_ports: [], output_ports: ["out"] },
                {
                  id: "actuator",
                  type: "Subsystem",
                  parameters: {
                    name: "Исполнительный механизм",
                    diagram: {
                      blocks: [
                        { id: "input", type: "SubsystemInput", parameters: { port: "in" }, input_ports: [], output_ports: ["out"] },
                        { id: "actuator_lag", type: "FirstOrderLag", parameters: { k: 1, T: 0.2, y0: 0 }, input_ports: ["in"], output_ports: ["out"] },
                        { id: "output", type: "SubsystemOutput", parameters: { port: "out" }, input_ports: ["in"], output_ports: [] }
                      ],
                      connections: [
                        { from_block: "input", from_port: "out", to_block: "actuator_lag", to_port: "in" },
                        { from_block: "actuator_lag", from_port: "out", to_block: "output", to_port: "in" }
                      ]
                    },
                    layout: {
                      positions: {
                        input: { x: 40, y: 150 },
                        actuator_lag: { x: 290, y: 150 },
                        output: { x: 560, y: 150 }
                      }
                    }
                  },
                  input_ports: ["in"],
                  output_ports: ["out"]
                },
                { id: "oscillator", type: "SecondOrderOscillator", parameters: { k: 1, wn: 2.5, zeta: 0.55, y0: 0, v0: 0 }, input_ports: ["in"], output_ports: ["out"] },
                { id: "output", type: "SubsystemOutput", parameters: { port: "out" }, input_ports: ["in"], output_ports: [] }
              ],
              connections: [
                { from_block: "input", from_port: "out", to_block: "actuator", to_port: "in" },
                { from_block: "actuator", from_port: "out", to_block: "oscillator", to_port: "in" },
                { from_block: "oscillator", from_port: "out", to_block: "output", to_port: "in" }
              ]
            },
            layout: {
              positions: {
                input: { x: 30, y: 150 },
                actuator: { x: 260, y: 150 },
                oscillator: { x: 520, y: 150 },
                output: { x: 790, y: 150 }
              }
            }
          },
          input_ports: ["in"],
          output_ports: ["out"]
        },
        { id: "scope", type: "Scope", parameters: { label: "y" }, input_ports: ["in"], output_ports: [] }
      ],
      connections: [
        { from_block: "reference", from_port: "out", to_block: "error", to_port: "in1" },
        { from_block: "error", from_port: "out", to_block: "controller", to_port: "in" },
        { from_block: "controller", from_port: "out", to_block: "plant", to_port: "in" },
        { from_block: "plant", from_port: "out", to_block: "scope", to_port: "in" },
        { from_block: "plant", from_port: "out", to_block: "error", to_port: "in2" }
      ]
    },
    positions: {
      reference: { x: 20, y: 140 },
      error: { x: 240, y: 130 },
      controller: { x: 460, y: 140 },
      plant: { x: 700, y: 140 },
      scope: { x: 1300, y: 140 }
    }
  }
];

export interface StarterPreset {
  id: string;
  title: string;
  category: string;
  description: string;
  preset: ExamplePreset;
}

const STARTER_DEFINITIONS = [
  { id: "defenseDemo", title: "Демонстрация для защиты", category: "Защита", description: "Модель → наблюдатель → LQG за три шага" },
  { id: "firstOrder", title: "Звено 1-го порядка", category: "Базовая модель", description: "Переходная характеристика K/(Ts+1)" },
  { id: "secondOrder", title: "Колебательная система", category: "Динамика", description: "Перерегулирование и коэффициент затухания" },
  { id: "closedLoop", title: "Отрицательная обратная связь", category: "Анализ", description: "Замкнутый контур и проверка устойчивости" },
  { id: "dcMotorSpeedControl", title: "САУ скоростью двигателя", category: "Эталонная модель", description: "PID, физическая модель ДПТ и обратная связь" },
  { id: "butterworthSimple", title: "ФНЧ Баттерворта", category: "Частотный анализ", description: "Фильтр 2-го порядка и его характеристики" },
  { id: "compactSubsystemChain", title: "Многоуровневая модель", category: "Иерархия", description: "Пять компактных инженерных подсистем" },
] as const;

export const STARTER_PRESETS: StarterPreset[] = STARTER_DEFINITIONS.map((definition) => {
  const preset = EXAMPLE_PRESETS.find((candidate) => candidate.id === definition.id);
  if (!preset) {
    throw new Error(`Starter preset ${definition.id} is not registered`);
  }
  return { ...definition, preset };
});
