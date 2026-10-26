// Сгенерировано backend/scripts/kp_examples.py — примеры курсового проекта (ПИ, перекрёстные связи, ЭГСП).
import type { ExamplePreset } from "./examples";

export const KP_PRESETS: ExamplePreset[] = [
  {
    "id": "kp_pi",
    "title": "Контур с ПИ-регулятором",
    "diagram": {
      "blocks": [
        {
          "id": "r",
          "type": "StepInput",
          "parameters": {
            "amplitude": 1.0,
            "t0": 0.0
          },
          "input_ports": [],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "e",
          "type": "Sum",
          "parameters": {
            "signs": [
              "+",
              "-"
            ],
            "name": "Ошибка"
          },
          "input_ports": [
            "in1",
            "in2"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "pi",
          "type": "PIDController",
          "parameters": {
            "kp": 2.0,
            "ki": 1.0,
            "kd": 0.0,
            "filter_n": 100.0,
            "name": "ПИ-регулятор"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "lag1",
          "type": "FirstOrderLag",
          "parameters": {
            "k": 1.0,
            "T": 1.0,
            "y0": 0.0,
            "name": "Звено 1/(s+1)"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "lag2",
          "type": "FirstOrderLag",
          "parameters": {
            "k": 1.0,
            "T": 0.5,
            "y0": 0.0,
            "name": "Звено 1/(0,5s+1)"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "y",
          "type": "Scope",
          "parameters": {
            "label": "y"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": []
        }
      ],
      "connections": [
        {
          "from_block": "r",
          "from_port": "out",
          "to_block": "e",
          "to_port": "in1"
        },
        {
          "from_block": "e",
          "from_port": "out",
          "to_block": "pi",
          "to_port": "in"
        },
        {
          "from_block": "pi",
          "from_port": "out",
          "to_block": "lag1",
          "to_port": "in"
        },
        {
          "from_block": "lag1",
          "from_port": "out",
          "to_block": "lag2",
          "to_port": "in"
        },
        {
          "from_block": "lag2",
          "from_port": "out",
          "to_block": "e",
          "to_port": "in2"
        },
        {
          "from_block": "lag2",
          "from_port": "out",
          "to_block": "y",
          "to_port": "in"
        }
      ]
    },
    "positions": {
      "r": {
        "x": 40,
        "y": 200
      },
      "e": {
        "x": 280,
        "y": 200
      },
      "pi": {
        "x": 520,
        "y": 200
      },
      "lag1": {
        "x": 780,
        "y": 200
      },
      "lag2": {
        "x": 1040,
        "y": 200
      },
      "y": {
        "x": 1300,
        "y": 200
      }
    }
  },
  {
    "id": "kp_crossed",
    "title": "Перекрёстные обратные связи",
    "diagram": {
      "blocks": [
        {
          "id": "r",
          "type": "StepInput",
          "parameters": {
            "amplitude": 1.0,
            "t0": 0.0
          },
          "input_ports": [],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "s1",
          "type": "Sum",
          "parameters": {
            "signs": [
              "+",
              "-",
              "-"
            ],
            "name": "Σ₁"
          },
          "input_ports": [
            "in1",
            "in2",
            "in3"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "g1",
          "type": "FirstOrderLag",
          "parameters": {
            "k": 1.0,
            "T": 1.0,
            "y0": 0.0,
            "name": "G₁"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "s2",
          "type": "Sum",
          "parameters": {
            "signs": [
              "+",
              "-"
            ],
            "name": "Σ₂"
          },
          "input_ports": [
            "in1",
            "in2"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "g2",
          "type": "FirstOrderLag",
          "parameters": {
            "k": 2.0,
            "T": 0.5,
            "y0": 0.0,
            "name": "G₂"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "g3",
          "type": "Integrator",
          "parameters": {
            "k": 1.0,
            "y0": 0.0,
            "name": "G₃"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "h1",
          "type": "Gain",
          "parameters": {
            "k": 0.5,
            "name": "H₁"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "h2",
          "type": "Gain",
          "parameters": {
            "k": 1.0,
            "name": "H₂"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "y",
          "type": "Scope",
          "parameters": {
            "label": "y"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": []
        }
      ],
      "connections": [
        {
          "from_block": "r",
          "from_port": "out",
          "to_block": "s1",
          "to_port": "in1"
        },
        {
          "from_block": "g3",
          "from_port": "out",
          "to_block": "s1",
          "to_port": "in2"
        },
        {
          "from_block": "h1",
          "from_port": "out",
          "to_block": "s1",
          "to_port": "in3"
        },
        {
          "from_block": "s1",
          "from_port": "out",
          "to_block": "g1",
          "to_port": "in"
        },
        {
          "from_block": "g1",
          "from_port": "out",
          "to_block": "s2",
          "to_port": "in1"
        },
        {
          "from_block": "h2",
          "from_port": "out",
          "to_block": "s2",
          "to_port": "in2"
        },
        {
          "from_block": "s2",
          "from_port": "out",
          "to_block": "g2",
          "to_port": "in"
        },
        {
          "from_block": "g2",
          "from_port": "out",
          "to_block": "g3",
          "to_port": "in"
        },
        {
          "from_block": "g2",
          "from_port": "out",
          "to_block": "h1",
          "to_port": "in"
        },
        {
          "from_block": "g3",
          "from_port": "out",
          "to_block": "h2",
          "to_port": "in"
        },
        {
          "from_block": "g3",
          "from_port": "out",
          "to_block": "y",
          "to_port": "in"
        }
      ]
    },
    "positions": {
      "r": {
        "x": 40,
        "y": 220
      },
      "s1": {
        "x": 260,
        "y": 220
      },
      "g1": {
        "x": 500,
        "y": 220
      },
      "s2": {
        "x": 740,
        "y": 220
      },
      "g2": {
        "x": 980,
        "y": 220
      },
      "g3": {
        "x": 1220,
        "y": 220
      },
      "y": {
        "x": 1480,
        "y": 220
      },
      "h1": {
        "x": 740,
        "y": 420
      },
      "h2": {
        "x": 980,
        "y": 20
      }
    }
  },
  {
    "id": "kp_egsp",
    "title": "ЭГСП 8-го порядка",
    "diagram": {
      "blocks": [
        {
          "id": "U",
          "type": "StepInput",
          "parameters": {
            "amplitude": 0.01,
            "t0": 0.0
          },
          "input_ports": [],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "err",
          "type": "Sum",
          "parameters": {
            "signs": [
              "+",
              "-"
            ],
            "name": "Сравнение U − k_ос·Y"
          },
          "input_ports": [
            "in1",
            "in2"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "amp",
          "type": "Gain",
          "parameters": {
            "k": 50.0,
            "name": "Усилитель k_ус"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "coil",
          "type": "TransferFunction",
          "parameters": {
            "numerator": [
              1.0
            ],
            "denominator": [
              0.4,
              80.0
            ],
            "name": "Обмотка ЭМП"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "torque",
          "type": "Sum",
          "parameters": {
            "signs": [
              "+",
              "-"
            ],
            "name": "Моменты на якоре"
          },
          "input_ports": [
            "in1",
            "in2"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "armature",
          "type": "TransferFunction",
          "parameters": {
            "numerator": [
              1.0
            ],
            "denominator": [
              3e-07,
              7e-05,
              0.1
            ],
            "name": "Якорь ЭМП"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "flap",
          "type": "Gain",
          "parameters": {
            "k": 0.001,
            "name": "Заслонка k_Qφ"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "flow",
          "type": "Sum",
          "parameters": {
            "signs": [
              "+",
              "-"
            ],
            "name": "Расход Q_у − F_з·ẋ"
          },
          "input_ports": [
            "in1",
            "in2"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "pressure",
          "type": "Gain",
          "parameters": {
            "k": 1000000.0,
            "name": "Перепад 1/k_Qp"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "spool",
          "type": "Subsystem",
          "parameters": {
            "diagram": {
              "blocks": [
                {
                  "id": "in",
                  "type": "SubsystemInput",
                  "parameters": {
                    "port": "in"
                  },
                  "input_ports": [],
                  "output_ports": [
                    "out"
                  ]
                },
                {
                  "id": "force",
                  "type": "Gain",
                  "parameters": {
                    "k": 7.85e-05,
                    "name": "Сила F·u"
                  },
                  "input_ports": [
                    "in"
                  ],
                  "output_ports": [
                    "out"
                  ]
                },
                {
                  "id": "balance",
                  "type": "Sum",
                  "parameters": {
                    "signs": [
                      "+",
                      "-",
                      "-"
                    ],
                    "name": "Баланс сил"
                  },
                  "input_ports": [
                    "in1",
                    "in2",
                    "in3"
                  ],
                  "output_ports": [
                    "out"
                  ]
                },
                {
                  "id": "per_mass",
                  "type": "Gain",
                  "parameters": {
                    "k": 200.0,
                    "name": "Ускорение 1/m"
                  },
                  "input_ports": [
                    "in"
                  ],
                  "output_ports": [
                    "out"
                  ]
                },
                {
                  "id": "velocity",
                  "type": "Integrator",
                  "parameters": {
                    "k": 1.0,
                    "y0": 0.0,
                    "name": "Скорость ẋ"
                  },
                  "input_ports": [
                    "in"
                  ],
                  "output_ports": [
                    "out"
                  ]
                },
                {
                  "id": "position",
                  "type": "Integrator",
                  "parameters": {
                    "k": 1.0,
                    "y0": 0.0,
                    "name": "Положение x"
                  },
                  "input_ports": [
                    "in"
                  ],
                  "output_ports": [
                    "out"
                  ]
                },
                {
                  "id": "friction",
                  "type": "Gain",
                  "parameters": {
                    "k": 0.25,
                    "name": "Трение h"
                  },
                  "input_ports": [
                    "in"
                  ],
                  "output_ports": [
                    "out"
                  ]
                },
                {
                  "id": "spring",
                  "type": "Gain",
                  "parameters": {
                    "k": 2.0,
                    "name": "Жёсткость c"
                  },
                  "input_ports": [
                    "in"
                  ],
                  "output_ports": [
                    "out"
                  ]
                },
                {
                  "id": "x",
                  "type": "SubsystemOutput",
                  "parameters": {
                    "port": "x"
                  },
                  "input_ports": [
                    "in"
                  ],
                  "output_ports": []
                },
                {
                  "id": "v",
                  "type": "SubsystemOutput",
                  "parameters": {
                    "port": "v"
                  },
                  "input_ports": [
                    "in"
                  ],
                  "output_ports": []
                }
              ],
              "connections": [
                {
                  "from_block": "in",
                  "from_port": "out",
                  "to_block": "force",
                  "to_port": "in"
                },
                {
                  "from_block": "force",
                  "from_port": "out",
                  "to_block": "balance",
                  "to_port": "in1"
                },
                {
                  "from_block": "friction",
                  "from_port": "out",
                  "to_block": "balance",
                  "to_port": "in2"
                },
                {
                  "from_block": "spring",
                  "from_port": "out",
                  "to_block": "balance",
                  "to_port": "in3"
                },
                {
                  "from_block": "balance",
                  "from_port": "out",
                  "to_block": "per_mass",
                  "to_port": "in"
                },
                {
                  "from_block": "per_mass",
                  "from_port": "out",
                  "to_block": "velocity",
                  "to_port": "in"
                },
                {
                  "from_block": "velocity",
                  "from_port": "out",
                  "to_block": "position",
                  "to_port": "in"
                },
                {
                  "from_block": "velocity",
                  "from_port": "out",
                  "to_block": "friction",
                  "to_port": "in"
                },
                {
                  "from_block": "position",
                  "from_port": "out",
                  "to_block": "spring",
                  "to_port": "in"
                },
                {
                  "from_block": "position",
                  "from_port": "out",
                  "to_block": "x",
                  "to_port": "in"
                },
                {
                  "from_block": "velocity",
                  "from_port": "out",
                  "to_block": "v",
                  "to_port": "in"
                }
              ]
            },
            "name": "Золотник ЭГУ",
            "layout": {
              "positions": {
                "in": {
                  "x": 20,
                  "y": 200
                },
                "force": {
                  "x": 240,
                  "y": 200
                },
                "balance": {
                  "x": 460,
                  "y": 200
                },
                "per_mass": {
                  "x": 680,
                  "y": 200
                },
                "velocity": {
                  "x": 900,
                  "y": 200
                },
                "position": {
                  "x": 1120,
                  "y": 200
                },
                "x": {
                  "x": 1360,
                  "y": 120
                },
                "v": {
                  "x": 1360,
                  "y": 300
                },
                "friction": {
                  "x": 680,
                  "y": 400
                },
                "spring": {
                  "x": 680,
                  "y": 560
                }
              }
            }
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "x",
            "v"
          ]
        },
        {
          "id": "spool_area",
          "type": "Gain",
          "parameters": {
            "k": 7.85e-05,
            "name": "Площадь F_з"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "mech_fb",
          "type": "Gain",
          "parameters": {
            "k": 10.0,
            "name": "Обр. связь k_мос"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "valve",
          "type": "Gain",
          "parameters": {
            "k": 4.3,
            "name": "Распределитель k_Qx"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "cyl_flow",
          "type": "Sum",
          "parameters": {
            "signs": [
              "+",
              "-"
            ],
            "name": "Расход Q − F·Ẏ"
          },
          "input_ports": [
            "in1",
            "in2"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "cylinder",
          "type": "TransferFunction",
          "parameters": {
            "numerator": [
              1.0
            ],
            "denominator": [
              3.2350000000000003e-11,
              1e-10
            ],
            "name": "Полости ГЦ"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "piston",
          "type": "Subsystem",
          "parameters": {
            "diagram": {
              "blocks": [
                {
                  "id": "in",
                  "type": "SubsystemInput",
                  "parameters": {
                    "port": "in"
                  },
                  "input_ports": [],
                  "output_ports": [
                    "out"
                  ]
                },
                {
                  "id": "force",
                  "type": "Gain",
                  "parameters": {
                    "k": 0.00199,
                    "name": "Сила F·u"
                  },
                  "input_ports": [
                    "in"
                  ],
                  "output_ports": [
                    "out"
                  ]
                },
                {
                  "id": "balance",
                  "type": "Sum",
                  "parameters": {
                    "signs": [
                      "+",
                      "-",
                      "-"
                    ],
                    "name": "Баланс сил"
                  },
                  "input_ports": [
                    "in1",
                    "in2",
                    "in3"
                  ],
                  "output_ports": [
                    "out"
                  ]
                },
                {
                  "id": "per_mass",
                  "type": "Gain",
                  "parameters": {
                    "k": 0.1,
                    "name": "Ускорение 1/m"
                  },
                  "input_ports": [
                    "in"
                  ],
                  "output_ports": [
                    "out"
                  ]
                },
                {
                  "id": "velocity",
                  "type": "Integrator",
                  "parameters": {
                    "k": 1.0,
                    "y0": 0.0,
                    "name": "Скорость ẋ"
                  },
                  "input_ports": [
                    "in"
                  ],
                  "output_ports": [
                    "out"
                  ]
                },
                {
                  "id": "position",
                  "type": "Integrator",
                  "parameters": {
                    "k": 1.0,
                    "y0": 0.0,
                    "name": "Положение x"
                  },
                  "input_ports": [
                    "in"
                  ],
                  "output_ports": [
                    "out"
                  ]
                },
                {
                  "id": "friction",
                  "type": "Gain",
                  "parameters": {
                    "k": 10.0,
                    "name": "Трение h"
                  },
                  "input_ports": [
                    "in"
                  ],
                  "output_ports": [
                    "out"
                  ]
                },
                {
                  "id": "spring",
                  "type": "Gain",
                  "parameters": {
                    "k": 0.0,
                    "name": "Жёсткость c"
                  },
                  "input_ports": [
                    "in"
                  ],
                  "output_ports": [
                    "out"
                  ]
                },
                {
                  "id": "x",
                  "type": "SubsystemOutput",
                  "parameters": {
                    "port": "x"
                  },
                  "input_ports": [
                    "in"
                  ],
                  "output_ports": []
                },
                {
                  "id": "v",
                  "type": "SubsystemOutput",
                  "parameters": {
                    "port": "v"
                  },
                  "input_ports": [
                    "in"
                  ],
                  "output_ports": []
                }
              ],
              "connections": [
                {
                  "from_block": "in",
                  "from_port": "out",
                  "to_block": "force",
                  "to_port": "in"
                },
                {
                  "from_block": "force",
                  "from_port": "out",
                  "to_block": "balance",
                  "to_port": "in1"
                },
                {
                  "from_block": "friction",
                  "from_port": "out",
                  "to_block": "balance",
                  "to_port": "in2"
                },
                {
                  "from_block": "spring",
                  "from_port": "out",
                  "to_block": "balance",
                  "to_port": "in3"
                },
                {
                  "from_block": "balance",
                  "from_port": "out",
                  "to_block": "per_mass",
                  "to_port": "in"
                },
                {
                  "from_block": "per_mass",
                  "from_port": "out",
                  "to_block": "velocity",
                  "to_port": "in"
                },
                {
                  "from_block": "velocity",
                  "from_port": "out",
                  "to_block": "position",
                  "to_port": "in"
                },
                {
                  "from_block": "velocity",
                  "from_port": "out",
                  "to_block": "friction",
                  "to_port": "in"
                },
                {
                  "from_block": "position",
                  "from_port": "out",
                  "to_block": "spring",
                  "to_port": "in"
                },
                {
                  "from_block": "position",
                  "from_port": "out",
                  "to_block": "x",
                  "to_port": "in"
                },
                {
                  "from_block": "velocity",
                  "from_port": "out",
                  "to_block": "v",
                  "to_port": "in"
                }
              ]
            },
            "name": "Поршень с нагрузкой",
            "layout": {
              "positions": {
                "in": {
                  "x": 20,
                  "y": 200
                },
                "force": {
                  "x": 240,
                  "y": 200
                },
                "balance": {
                  "x": 460,
                  "y": 200
                },
                "per_mass": {
                  "x": 680,
                  "y": 200
                },
                "velocity": {
                  "x": 900,
                  "y": 200
                },
                "position": {
                  "x": 1120,
                  "y": 200
                },
                "x": {
                  "x": 1360,
                  "y": 120
                },
                "v": {
                  "x": 1360,
                  "y": 300
                },
                "friction": {
                  "x": 680,
                  "y": 400
                },
                "spring": {
                  "x": 680,
                  "y": 560
                }
              }
            }
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "x",
            "v"
          ]
        },
        {
          "id": "piston_area",
          "type": "Gain",
          "parameters": {
            "k": 0.00199,
            "name": "Площадь F"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "sensor",
          "type": "Gain",
          "parameters": {
            "k": 0.1,
            "name": "Датчик k_ос"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": [
            "out"
          ]
        },
        {
          "id": "Y",
          "type": "Scope",
          "parameters": {
            "label": "Y"
          },
          "input_ports": [
            "in"
          ],
          "output_ports": []
        }
      ],
      "connections": [
        {
          "from_block": "U",
          "from_port": "out",
          "to_block": "err",
          "to_port": "in1"
        },
        {
          "from_block": "err",
          "from_port": "out",
          "to_block": "amp",
          "to_port": "in"
        },
        {
          "from_block": "amp",
          "from_port": "out",
          "to_block": "coil",
          "to_port": "in"
        },
        {
          "from_block": "coil",
          "from_port": "out",
          "to_block": "torque",
          "to_port": "in1"
        },
        {
          "from_block": "torque",
          "from_port": "out",
          "to_block": "armature",
          "to_port": "in"
        },
        {
          "from_block": "armature",
          "from_port": "out",
          "to_block": "flap",
          "to_port": "in"
        },
        {
          "from_block": "flap",
          "from_port": "out",
          "to_block": "flow",
          "to_port": "in1"
        },
        {
          "from_block": "flow",
          "from_port": "out",
          "to_block": "pressure",
          "to_port": "in"
        },
        {
          "from_block": "pressure",
          "from_port": "out",
          "to_block": "spool",
          "to_port": "in"
        },
        {
          "from_block": "spool",
          "from_port": "v",
          "to_block": "spool_area",
          "to_port": "in"
        },
        {
          "from_block": "spool_area",
          "from_port": "out",
          "to_block": "flow",
          "to_port": "in2"
        },
        {
          "from_block": "spool",
          "from_port": "x",
          "to_block": "mech_fb",
          "to_port": "in"
        },
        {
          "from_block": "mech_fb",
          "from_port": "out",
          "to_block": "torque",
          "to_port": "in2"
        },
        {
          "from_block": "spool",
          "from_port": "x",
          "to_block": "valve",
          "to_port": "in"
        },
        {
          "from_block": "valve",
          "from_port": "out",
          "to_block": "cyl_flow",
          "to_port": "in1"
        },
        {
          "from_block": "cyl_flow",
          "from_port": "out",
          "to_block": "cylinder",
          "to_port": "in"
        },
        {
          "from_block": "cylinder",
          "from_port": "out",
          "to_block": "piston",
          "to_port": "in"
        },
        {
          "from_block": "piston",
          "from_port": "v",
          "to_block": "piston_area",
          "to_port": "in"
        },
        {
          "from_block": "piston_area",
          "from_port": "out",
          "to_block": "cyl_flow",
          "to_port": "in2"
        },
        {
          "from_block": "piston",
          "from_port": "x",
          "to_block": "sensor",
          "to_port": "in"
        },
        {
          "from_block": "sensor",
          "from_port": "out",
          "to_block": "err",
          "to_port": "in2"
        },
        {
          "from_block": "piston",
          "from_port": "x",
          "to_block": "Y",
          "to_port": "in"
        }
      ]
    },
    "positions": {
      "U": {
        "x": 20,
        "y": 240
      },
      "err": {
        "x": 240,
        "y": 240
      },
      "amp": {
        "x": 460,
        "y": 240
      },
      "coil": {
        "x": 680,
        "y": 240
      },
      "torque": {
        "x": 900,
        "y": 240
      },
      "armature": {
        "x": 1120,
        "y": 240
      },
      "flap": {
        "x": 1340,
        "y": 240
      },
      "flow": {
        "x": 1560,
        "y": 240
      },
      "pressure": {
        "x": 1780,
        "y": 240
      },
      "spool": {
        "x": 2000,
        "y": 240
      },
      "valve": {
        "x": 2240,
        "y": 240
      },
      "cyl_flow": {
        "x": 2460,
        "y": 240
      },
      "cylinder": {
        "x": 2680,
        "y": 240
      },
      "piston": {
        "x": 2900,
        "y": 240
      },
      "Y": {
        "x": 3160,
        "y": 240
      },
      "spool_area": {
        "x": 1780,
        "y": 40
      },
      "mech_fb": {
        "x": 1340,
        "y": 440
      },
      "piston_area": {
        "x": 2680,
        "y": 40
      },
      "sensor": {
        "x": 1560,
        "y": 600
      }
    }
  }
];
