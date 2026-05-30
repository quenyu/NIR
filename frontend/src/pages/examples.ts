import type { Diagram } from "../types/diagram";

export interface ExamplePreset {
  id: string;
  title: string;
  diagram: Diagram;
  positions: Record<string, { x: number; y: number }>;
}

export const EXAMPLE_PRESETS: ExamplePreset[] = [
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
          type: "Gain",
          parameters: { k: 2 },
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
  }
];
