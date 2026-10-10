/** Ranges for dragging a numeric block parameter and for sweeping it in the root locus. */

// Physical quantities that must stay positive: their slider never reaches zero.
const POSITIVE_PARAMETERS = new Set(["T", "wn", "cutoff_freq", "filter_n"]);
// Integers and instants are typed, not dragged.
export const UNSLIDABLE_PARAMETERS = new Set(["order", "t0"]);

export interface SliderRange {
  min: number;
  max: number;
  step: number;
}

/** A range around the value the block had when it was selected, so dragging does not move the scale. */
export function sliderRange(key: string, value: number): SliderRange {
  let min: number;
  let max: number;
  if (POSITIVE_PARAMETERS.has(key)) {
    min = value / 20;
    max = value * 3;
  } else if (value > 0) {
    min = 0;
    max = value * 3;
  } else if (value < 0) {
    min = value * 3;
    max = 0;
  } else {
    min = -1;
    max = 1;
  }
  const step = Number(((max - min) / 300).toPrecision(2));
  return { min, max, step };
}
