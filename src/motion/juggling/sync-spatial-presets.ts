import type { MotionDefinition } from './sync-motion';

// Coordinates are relative to the throwing hand and low catch plane.
// Whole-cycle regression checks use the bundled avatar's actual skeleton.
export const SYNC_SPATIAL_PROFILES: Record<string, { column: MotionDefinition; short: MotionDefinition[] }> = {
  "crossed": {
    "column": {
      "release": {
        "x": -0.07629999999999999,
        "y": 0.07300000000000001,
        "z": -0.445
      },
      "catch": {
        "x": -0.07629999999999999,
        "y": 0.07300000000000001,
        "z": -0.445
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "outside",
        "amount": 0
      },
      "emptyReturn": {
        "route": "outside",
        "amount": 0
      }
    },
    "short": [
      {
        "release": {
          "x": -0.10919999999999999,
          "y": 0.07300000000000001,
          "z": -0.46799999999999997,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": 0.10919999999999999,
          "y": 0.07300000000000001,
          "z": -0.46799999999999997,
          "relation": "free"
        },
        "carry": {
          "route": "back",
          "amount": 0
        },
        "emptyReturn": {
          "route": "inside",
          "amount": 0
        }
      }
    ]
  },
  "lateral-normal": {
    "column": {
      "release": {
        "x": 0.16745000000000002,
        "y": 0.113,
        "z": -0.295
      },
      "catch": {
        "x": 0.16745000000000002,
        "y": 0.113,
        "z": -0.295
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "back",
        "amount": 0.042,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              -0.0265,
              0
            ]
          }
        ]
      },
      "emptyReturn": {
        "route": "outside",
        "amount": 0.0365,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              -0.0175,
              0
            ]
          }
        ]
      }
    },
    "short": [
      {
        "release": {
          "x": -0.08839999999999999,
          "y": 0.224,
          "z": -0.359,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": 0.08839999999999999,
          "y": 0.224,
          "z": -0.359,
          "relation": "free"
        },
        "carry": {
          "route": "back",
          "amount": 0.0495,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                -0.0205,
                0
              ]
            }
          ]
        },
        "emptyReturn": {
          "route": "front",
          "amount": 0.019,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                -0.0375,
                0
              ]
            }
          ]
        }
      }
    ]
  },
  "underarm": {
    "column": {
      "release": {
        "x": -0.08432,
        "y": 0.046,
        "z": -0.29
      },
      "catch": {
        "x": -0.08432,
        "y": 0.046,
        "z": -0.29
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "direct",
        "amount": 0.085
      },
      "emptyReturn": {
        "route": "front",
        "amount": 0.22
      }
    },
    "short": [
      {
        "release": {
          "x": 0.16592,
          "y": 0.09,
          "z": -0.22999999999999998,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": -0.16592,
          "y": 0.09,
          "z": -0.22999999999999998,
          "relation": "free"
        },
        "carry": {
          "route": "outside",
          "amount": 0.084
        },
        "emptyReturn": {
          "route": "direct",
          "amount": 0
        }
      }
    ]
  },
  "vertical-down": {
    "column": {
      "release": {
        "x": 0.189,
        "y": 0.013,
        "z": -0.357
      },
      "catch": {
        "x": 0.189,
        "y": 0.013,
        "z": -0.357
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "front",
        "amount": 0.047,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              -0.049,
              0
            ]
          }
        ]
      },
      "emptyReturn": {
        "route": "back",
        "amount": 0.09,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              0.011,
              0
            ]
          }
        ]
      }
    },
    "short": [
      {
        "release": {
          "x": 0.044,
          "y": 0.18,
          "z": -0.387,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": 0.044,
          "y": -0.002,
          "z": -0.387,
          "relation": "free"
        },
        "carry": {
          "route": "back",
          "amount": 0.096,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                0.007,
                0
              ]
            }
          ]
        },
        "emptyReturn": {
          "route": "back",
          "amount": 0.031,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                0.049,
                0
              ]
            }
          ]
        }
      }
    ]
  },
  "outside-vertical-down": {
    "column": {
      "release": {
        "x": 0.069,
        "y": -0.032,
        "z": -0.134
      },
      "catch": {
        "x": 0.069,
        "y": -0.032,
        "z": -0.134
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "front",
        "amount": 0.085,
        "via": [
          {
            "at": 0.3,
            "offset": [
              0,
              0.068,
              0
            ]
          },
          {
            "at": 0.7,
            "offset": [
              0,
              -0.106,
              0
            ]
          }
        ]
      },
      "emptyReturn": {
        "route": "front",
        "amount": 0.0475,
        "via": [
          {
            "at": 0.3,
            "offset": [
              0,
              -0.029,
              0
            ]
          },
          {
            "at": 0.7,
            "offset": [
              0,
              0.0145,
              0
            ]
          }
        ]
      }
    },
    "short": [
      {
        "release": {
          "x": 0.208,
          "y": 0.167,
          "z": -0.329,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": 0.208,
          "y": 0.085,
          "z": -0.329,
          "relation": "free"
        },
        "carry": {
          "route": "front",
          "amount": 0.073,
          "via": [
            {
              "at": 0.3,
              "offset": [
                0,
                -0.002,
                0
              ]
            },
            {
              "at": 0.7,
              "offset": [
                0,
                -0.023,
                0
              ]
            }
          ]
        },
        "emptyReturn": {
          "route": "inside",
          "amount": 0.038,
          "via": [
            {
              "at": 0.3,
              "offset": [
                0,
                0.059,
                0
              ]
            },
            {
              "at": 0.7,
              "offset": [
                0,
                0.08,
                0
              ]
            }
          ]
        }
      }
    ]
  },
  "cross-side-vertical-up": {
    "column": {
      "release": {
        "x": 0.14,
        "y": 0.042,
        "z": -0.17
      },
      "catch": {
        "x": 0.14,
        "y": 0.042,
        "z": -0.17
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "outside",
        "amount": 0.05
      },
      "emptyReturn": {
        "route": "front",
        "amount": 0.086
      }
    },
    "short": [
      {
        "release": {
          "x": -0.171,
          "y": 0.05,
          "z": -0.359,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": -0.171,
          "y": 0.243,
          "z": -0.359,
          "relation": "free"
        },
        "carry": {
          "route": "outside",
          "amount": 0.131
        },
        "emptyReturn": {
          "route": "direct",
          "amount": 0.081
        }
      }
    ]
  },
  "cross-side-vertical-down": {
    "column": {
      "release": {
        "x": 0.204,
        "y": 0.026,
        "z": -0.216
      },
      "catch": {
        "x": 0.204,
        "y": 0.026,
        "z": -0.216
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "direct",
        "amount": 0.092,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              -0.039,
              0
            ]
          }
        ]
      },
      "emptyReturn": {
        "route": "back",
        "amount": 0.042,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              -0.069,
              0
            ]
          }
        ]
      }
    },
    "short": [
      {
        "release": {
          "x": -0.103,
          "y": 0.231,
          "z": -0.364,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": -0.103,
          "y": 0.004,
          "z": -0.364,
          "relation": "free"
        },
        "carry": {
          "route": "direct",
          "amount": 0.067,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                0.002,
                0
              ]
            }
          ]
        },
        "emptyReturn": {
          "route": "outside",
          "amount": 0.057,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                -0.061,
                0
              ]
            }
          ]
        }
      }
    ]
  },
  "switched-shuffle": {
    "column": {
      "release": {
        "x": -0.0966,
        "y": 0.044,
        "z": -0.213
      },
      "catch": {
        "x": -0.0966,
        "y": 0.044,
        "z": -0.213
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "direct",
        "amount": 0.051
      },
      "emptyReturn": {
        "route": "direct",
        "amount": 0.071
      }
    },
    "short": [
      {
        "release": {
          "x": 0.18059999999999998,
          "y": 0.426,
          "z": -0.306,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": -0.18059999999999998,
          "y": 0.040999999999999995,
          "z": -0.306,
          "relation": "free"
        },
        "carry": {
          "route": "inside",
          "amount": 0.075
        },
        "emptyReturn": {
          "route": "back",
          "amount": 0.129
        }
      }
    ]
  },
  "switched-inverted": {
    "column": {
      "release": {
        "x": -0.104,
        "y": 0.053,
        "z": -0.247
      },
      "catch": {
        "x": -0.104,
        "y": 0.053,
        "z": -0.247
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "direct",
        "amount": 0.067
      },
      "emptyReturn": {
        "route": "direct",
        "amount": 0.107
      }
    },
    "short": [
      {
        "release": {
          "x": 0.325,
          "y": 0.431,
          "z": -0.36,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": -0.325,
          "y": 0.431,
          "z": -0.36,
          "relation": "free"
        },
        "carry": {
          "route": "direct",
          "amount": 0.106
        },
        "emptyReturn": {
          "route": "direct",
          "amount": 0.133
        }
      }
    ]
  },
  "switched-outside-vertical-up": {
    "column": {
      "release": {
        "x": -0.10569999999999999,
        "y": 0.049,
        "z": -0.201
      },
      "catch": {
        "x": -0.10569999999999999,
        "y": 0.049,
        "z": -0.201
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "back",
        "amount": 0.0595
      },
      "emptyReturn": {
        "route": "front",
        "amount": 0.0375
      }
    },
    "short": [
      {
        "release": {
          "x": 0.1694,
          "y": 0.032,
          "z": -0.362,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": 0.1694,
          "y": 0.31699999999999995,
          "z": -0.362,
          "relation": "free"
        },
        "carry": {
          "route": "direct",
          "amount": 0.0515
        },
        "emptyReturn": {
          "route": "front",
          "amount": 0.0415
        }
      }
    ]
  },
  "switched-outside-vertical-down": {
    "column": {
      "release": {
        "x": -0.05,
        "y": -0.025,
        "z": -0.15000000000000002
      },
      "catch": {
        "x": -0.05,
        "y": -0.025,
        "z": -0.15000000000000002
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "front",
        "amount": 0.117,
        "via": [
          {
            "at": 0.3,
            "offset": [
              0,
              0.083,
              0
            ]
          },
          {
            "at": 0.7,
            "offset": [
              0,
              -0.078,
              0
            ]
          }
        ]
      },
      "emptyReturn": {
        "route": "front",
        "amount": 0.097,
        "via": [
          {
            "at": 0.3,
            "offset": [
              0,
              -0.026000000000000002,
              0
            ]
          },
          {
            "at": 0.7,
            "offset": [
              0,
              -0.007999999999999997,
              0
            ]
          }
        ]
      }
    },
    "short": [
      {
        "release": {
          "x": 0.175,
          "y": 0.138,
          "z": -0.31,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": 0.175,
          "y": 0.05600000000000001,
          "z": -0.31,
          "relation": "free"
        },
        "carry": {
          "route": "front",
          "amount": 0.106,
          "via": [
            {
              "at": 0.3,
              "offset": [
                0,
                -0.018000000000000002,
                0
              ]
            },
            {
              "at": 0.7,
              "offset": [
                0,
                -0.019,
                0
              ]
            }
          ]
        },
        "emptyReturn": {
          "route": "inside",
          "amount": 0.045,
          "via": [
            {
              "at": 0.3,
              "offset": [
                0,
                0.06999999999999999,
                0
              ]
            },
            {
              "at": 0.7,
              "offset": [
                0,
                0.066,
                0
              ]
            }
          ]
        }
      }
    ]
  },
  "switched-center-vertical-up": {
    "column": {
      "release": {
        "x": -0.113,
        "y": 0.113,
        "z": -0.352
      },
      "catch": {
        "x": -0.113,
        "y": 0.113,
        "z": -0.352
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "inside",
        "amount": 0.03,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              -0.071,
              0
            ]
          }
        ]
      },
      "emptyReturn": {
        "route": "outside",
        "amount": 0.09,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              -0.018,
              0
            ]
          }
        ]
      }
    },
    "short": [
      {
        "release": {
          "x": 0.059,
          "y": 0.10200000000000001,
          "z": -0.207,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": 0.059,
          "y": 0.329,
          "z": -0.207,
          "relation": "free"
        },
        "carry": {
          "route": "front",
          "amount": 0.045,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                0.021,
                0
              ]
            }
          ]
        },
        "emptyReturn": {
          "route": "outside",
          "amount": 0.046,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                0.002,
                0
              ]
            }
          ]
        }
      }
    ]
  },
  "switched-center-vertical-down": {
    "column": {
      "release": {
        "x": -0.09029999999999999,
        "y": 0.024,
        "z": -0.262
      },
      "catch": {
        "x": -0.09029999999999999,
        "y": 0.024,
        "z": -0.262
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "outside",
        "amount": 0.086
      },
      "emptyReturn": {
        "route": "front",
        "amount": 0.22
      }
    },
    "short": [
      {
        "release": {
          "x": 0.025199999999999997,
          "y": 0.45299999999999996,
          "z": -0.188,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": 0.025199999999999997,
          "y": 0.143,
          "z": -0.188,
          "relation": "free"
        },
        "carry": {
          "route": "direct",
          "amount": 0.051
        },
        "emptyReturn": {
          "route": "outside",
          "amount": 0.22
        }
      }
    ]
  },
  "switched-cross-side-vertical-up": {
    "column": {
      "release": {
        "x": -0.1764,
        "y": 0.039,
        "z": -0.388
      },
      "catch": {
        "x": -0.1764,
        "y": 0.039,
        "z": -0.388
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "outside",
        "amount": 0.106,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              0.052,
              0
            ]
          }
        ]
      },
      "emptyReturn": {
        "route": "back",
        "amount": 0.133,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              -0.136,
              0
            ]
          }
        ]
      }
    },
    "short": [
      {
        "release": {
          "x": -0.0936,
          "y": 0.159,
          "z": -0.305,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": -0.0936,
          "y": 0.367,
          "z": -0.305,
          "relation": "free"
        },
        "carry": {
          "route": "front",
          "amount": 0.122,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                0.093,
                0
              ]
            }
          ]
        },
        "emptyReturn": {
          "route": "outside",
          "amount": 0.058,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                0.134,
                0
              ]
            }
          ]
        }
      }
    ]
  },
  "lateral-shuffle": {
    "column": {
      "release": {
        "x": 0.126,
        "y": 0.173,
        "z": -0.322
      },
      "catch": {
        "x": 0.126,
        "y": 0.173,
        "z": -0.322
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "back",
        "amount": 0.0325
      },
      "emptyReturn": {
        "route": "front",
        "amount": 0.058
      }
    },
    "short": [
      {
        "release": {
          "x": -0.09072,
          "y": 0.4759999999999999,
          "z": -0.478,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": 0.09072,
          "y": 0.183,
          "z": -0.478,
          "relation": "free"
        },
        "carry": {
          "route": "outside",
          "amount": 0.0395
        },
        "emptyReturn": {
          "route": "front",
          "amount": 0.0265
        }
      }
    ]
  },
  "lateral-reverse": {
    "column": {
      "release": {
        "x": 0.178,
        "y": 0.07,
        "z": -0.41
      },
      "catch": {
        "x": 0.178,
        "y": 0.07,
        "z": -0.41
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "outside",
        "amount": 0.078,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              -0.004,
              0
            ]
          }
        ]
      },
      "emptyReturn": {
        "route": "direct",
        "amount": 0.025,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              -0.007,
              0
            ]
          }
        ]
      }
    },
    "short": [
      {
        "release": {
          "x": -0.107,
          "y": 0.142,
          "z": -0.46699999999999997,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": 0.107,
          "y": 0.44999999999999996,
          "z": -0.46699999999999997,
          "relation": "free"
        },
        "carry": {
          "route": "back",
          "amount": 0.033,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                -0.028,
                0
              ]
            }
          ]
        },
        "emptyReturn": {
          "route": "outside",
          "amount": 0.087,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                0.079,
                0
              ]
            }
          ]
        }
      }
    ]
  },
  "lateral-inverted": {
    "column": {
      "release": {
        "x": 0.10079999999999999,
        "y": 0.109,
        "z": -0.35600000000000004
      },
      "catch": {
        "x": 0.10079999999999999,
        "y": 0.109,
        "z": -0.35600000000000004
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "inside",
        "amount": 0.022,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              0.009,
              0
            ]
          }
        ]
      },
      "emptyReturn": {
        "route": "outside",
        "amount": 0.097,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              -0.028,
              0
            ]
          }
        ]
      }
    },
    "short": [
      {
        "release": {
          "x": -0.105,
          "y": 0.45,
          "z": -0.369,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": 0.105,
          "y": 0.45,
          "z": -0.369,
          "relation": "free"
        },
        "carry": {
          "route": "front",
          "amount": 0.043,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                -0.075,
                0
              ]
            }
          ]
        },
        "emptyReturn": {
          "route": "front",
          "amount": 0.098,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                0.004,
                0
              ]
            }
          ]
        }
      }
    ]
  },
  "crossed-right": {
    "column": {
      "release": {
        "x": -0.07629999999999999,
        "y": 0.07300000000000001,
        "z": -0.445
      },
      "catch": {
        "x": -0.07629999999999999,
        "y": 0.07300000000000001,
        "z": -0.445
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "outside",
        "amount": 0
      },
      "emptyReturn": {
        "route": "outside",
        "amount": 0
      }
    },
    "short": [
      {
        "release": {
          "x": -0.10919999999999999,
          "y": 0.07300000000000001,
          "z": -0.46799999999999997,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": 0.10919999999999999,
          "y": 0.07300000000000001,
          "z": -0.46799999999999997,
          "relation": "free"
        },
        "carry": {
          "route": "back",
          "amount": 0
        },
        "emptyReturn": {
          "route": "inside",
          "amount": 0
        }
      }
    ]
  },
  "crossed-alternate": {
    "column": {
      "release": {
        "x": -0.0936,
        "y": 0.015,
        "z": -0.278
      },
      "catch": {
        "x": -0.0936,
        "y": 0.015,
        "z": -0.278
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "outside",
        "amount": 0.14
      },
      "emptyReturn": {
        "route": "outside",
        "amount": 0.14
      }
    },
    "short": [
      {
        "release": {
          "x": -0.09179999999999999,
          "y": 0.0009999999999999992,
          "z": -0.321,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": 0.09179999999999999,
          "y": 0.0009999999999999992,
          "z": -0.321,
          "relation": "free"
        },
        "carry": {
          "route": "outside",
          "amount": 0.14
        },
        "emptyReturn": {
          "route": "outside",
          "amount": 0.14
        }
      }
    ]
  },
  "inline-inverted": {
    "column": {
      "release": {
        "x": 0,
        "y": 0,
        "z": -0.3
      },
      "catch": {
        "x": 0,
        "y": 0,
        "z": -0.3
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "direct",
        "amount": 0
      },
      "emptyReturn": {
        "route": "outside",
        "amount": 0.24,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              0,
              -0.06
            ]
          }
        ]
      }
    },
    "short": [
      {
        "release": {
          "x": 0,
          "y": 0,
          "z": -0.3
        },
        "catch": {
          "x": 0,
          "y": 0,
          "z": -0.3
        },
        "passage": {
          "at": 0.5
        },
        "carry": {
          "route": "direct",
          "amount": 0
        },
        "emptyReturn": {
          "route": "outside",
          "amount": 0.08,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                0,
                -0.06
              ]
            }
          ]
        }
      }
    ]
  },
  "switched-cross-side-vertical-down": {
    "column": {
      "release": {
        "x": -0.16,
        "y": 0.109,
        "z": -0.305
      },
      "catch": {
        "x": -0.16,
        "y": 0.109,
        "z": -0.305
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "outside",
        "amount": 0.083,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              -0.021,
              0
            ]
          }
        ]
      },
      "emptyReturn": {
        "route": "back",
        "amount": 0.025,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              0.046,
              0
            ]
          }
        ]
      }
    },
    "short": [
      {
        "release": {
          "x": -0.162,
          "y": 0.314,
          "z": -0.19,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": -0.162,
          "y": 0.14,
          "z": -0.19,
          "relation": "free"
        },
        "carry": {
          "route": "front",
          "amount": 0.03,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                0.076,
                0
              ]
            }
          ]
        },
        "emptyReturn": {
          "route": "inside",
          "amount": 0.047,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                0.074,
                0
              ]
            }
          ]
        }
      }
    ]
  },
  "short-under-catch": {
    "column": {
      "release": {
        "x": 0.166,
        "y": 0.102,
        "z": -0.199
      },
      "catch": {
        "x": 0.166,
        "y": 0.102,
        "z": -0.199
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "back",
        "amount": 0.046,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              0.028,
              0
            ]
          }
        ]
      },
      "emptyReturn": {
        "route": "inside",
        "amount": 0.0455,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              0.0125,
              0
            ]
          }
        ]
      }
    },
    "short": [
      {
        "release": {
          "x": 0.21,
          "y": 0.125,
          "z": -0.168,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": -0.21,
          "y": 0.125,
          "z": -0.168,
          "relation": "underarm"
        },
        "carry": {
          "route": "front",
          "amount": 0.014,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                -0.0325,
                0
              ]
            }
          ]
        },
        "emptyReturn": {
          "route": "back",
          "amount": 0.0215,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                0.0175,
                0
              ]
            }
          ]
        }
      }
    ]
  },
  "short-under-release": {
    "column": {
      "release": {
        "x": 0.188,
        "y": 0.039,
        "z": -0.356
      },
      "catch": {
        "x": 0.188,
        "y": 0.039,
        "z": -0.356
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "inside",
        "amount": 0.065,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              0.007,
              0
            ]
          }
        ]
      },
      "emptyReturn": {
        "route": "outside",
        "amount": 0.098,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              -0.042,
              0
            ]
          }
        ]
      }
    },
    "short": [
      {
        "release": {
          "x": 0.221,
          "y": 0.064,
          "z": -0.203,
          "relation": "underarm"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": -0.221,
          "y": 0.064,
          "z": -0.203,
          "relation": "free"
        },
        "carry": {
          "route": "front",
          "amount": 0.02,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                -0.071,
                0
              ]
            }
          ]
        },
        "emptyReturn": {
          "route": "direct",
          "amount": 0.06,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                0.074,
                0
              ]
            }
          ]
        }
      }
    ]
  },
  "vertical-up": {
    "column": {
      "release": {
        "x": 0.205,
        "y": 0.119,
        "z": -0.278
      },
      "catch": {
        "x": 0.205,
        "y": 0.119,
        "z": -0.278
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "inside",
        "amount": 0.118
      },
      "emptyReturn": {
        "route": "direct",
        "amount": 0.098
      }
    },
    "short": [
      {
        "release": {
          "x": 0.026,
          "y": 0.126,
          "z": -0.368,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": 0.026,
          "y": 0.433,
          "z": -0.368,
          "relation": "free"
        },
        "carry": {
          "route": "back",
          "amount": 0.068
        },
        "emptyReturn": {
          "route": "outside",
          "amount": 0.137
        }
      }
    ]
  },
  "outside-vertical-up": {
    "column": {
      "release": {
        "x": 0.101,
        "y": 0.082,
        "z": -0.336
      },
      "catch": {
        "x": 0.101,
        "y": 0.082,
        "z": -0.336
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "outside",
        "amount": 0.051,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              0.039,
              0
            ]
          }
        ]
      },
      "emptyReturn": {
        "route": "outside",
        "amount": 0.05,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              -0.004,
              0
            ]
          }
        ]
      }
    },
    "short": [
      {
        "release": {
          "x": 0.186,
          "y": 0.068,
          "z": -0.313,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": 0.186,
          "y": 0.274,
          "z": -0.313,
          "relation": "free"
        },
        "carry": {
          "route": "front",
          "amount": 0.044,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                -0.022,
                0
              ]
            }
          ]
        },
        "emptyReturn": {
          "route": "direct",
          "amount": 0.09,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                -0.032,
                0
              ]
            }
          ]
        }
      }
    ]
  },
  "switched-reverse": {
    "column": {
      "release": {
        "x": -0.105,
        "y": 0.002,
        "z": -0.267
      },
      "catch": {
        "x": -0.105,
        "y": 0.002,
        "z": -0.267
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "back",
        "amount": 0.053
      },
      "emptyReturn": {
        "route": "direct",
        "amount": 0.05
      }
    },
    "short": [
      {
        "release": {
          "x": 0.254,
          "y": 0.065,
          "z": -0.353,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": -0.254,
          "y": 0.343,
          "z": -0.353,
          "relation": "free"
        },
        "carry": {
          "route": "front",
          "amount": 0.096
        },
        "emptyReturn": {
          "route": "outside",
          "amount": 0.11
        }
      }
    ]
  },
  "switched": {
    "column": {
      "release": {
        "x": -0.138,
        "y": 0.067,
        "z": -0.298
      },
      "catch": {
        "x": -0.138,
        "y": 0.067,
        "z": -0.298
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "back",
        "amount": 0.075,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              -0.05,
              0
            ]
          }
        ]
      },
      "emptyReturn": {
        "route": "outside",
        "amount": 0.07,
        "via": [
          {
            "at": 0.5,
            "offset": [
              0,
              -0.005,
              0
            ]
          }
        ]
      }
    },
    "short": [
      {
        "release": {
          "x": 0.184,
          "y": 0.17099999999999999,
          "z": -0.193,
          "relation": "free"
        },
        "passage": {
          "at": 0.5
        },
        "catch": {
          "x": -0.184,
          "y": 0.17099999999999999,
          "z": -0.193,
          "relation": "free"
        },
        "carry": {
          "route": "inside",
          "amount": 0.026,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                -0.005,
                0
              ]
            }
          ]
        },
        "emptyReturn": {
          "route": "outside",
          "amount": 0.075,
          "via": [
            {
              "at": 0.5,
              "offset": [
                0,
                0.038,
                0
              ]
            }
          ]
        }
      }
    ]
  },
  "inline": {
    "column": {
      "release": {
        "x": 0,
        "y": 0,
        "z": -0.3
      },
      "catch": {
        "x": 0,
        "y": 0,
        "z": -0.3
      },
      "passage": {
        "at": 0.5
      },
      "carry": {
        "route": "direct",
        "amount": 0
      },
      "emptyReturn": {
        "route": "outside",
        "amount": 0.16
      }
    },
    "short": [
      {
        "release": {
          "x": 0,
          "y": 0,
          "z": -0.3
        },
        "catch": {
          "x": 0,
          "y": 0,
          "z": -0.3
        },
        "passage": {
          "at": 0.5
        },
        "carry": {
          "route": "direct",
          "amount": 0
        },
        "emptyReturn": {
          "route": "outside",
          "amount": 0.16
        }
      }
    ]
  }
};
