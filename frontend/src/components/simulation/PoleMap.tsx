import { useEffect, useMemo, useState } from "react";
import Plot from "../Plot";
import { axis, MARKER_COLOR, plotLayout, STATIC_PLOT_CONFIG, UNSTABLE_COLOR } from "../plotTheme";
import { ApiError, errorText, sweepParameter, type SweepResponse } from "../../api/client";
import { sliderRange, UNSLIDABLE_PARAMETERS } from "../../features/parameterRange";
import type { Diagram } from "../../types/diagram";

const SWEEP_POINTS = 121;
// Parameters that move poles, most telling first. The gain of a dynamic block moves
// poles only inside a loop, so for those blocks the dynamics come first.
const DYNAMIC_PRIORITY = ["zeta", "wn", "T", "cutoff_freq", "filter_n", "k"];

function locusRank(candidate: Candidate): number {
  const order = candidate.blockType === "Gain"
    ? ["k"]
    : candidate.blockType === "PIDController" ? ["kp", "ki", "kd", "filter_n"] : DYNAMIC_PRIORITY;
  const rank = order.indexOf(candidate.parameter);
  return rank < 0 ? Number.POSITIVE_INFINITY : rank;
}

interface Candidate {
  key: string;
  blockType: string;
  blockId: string;
  parameter: string;
  value: number;
}

interface PoleMapProps {
  poles: Array<{ real: number; imag: number }>;
  diagram: Diagram | null;
  /** The block selected on the canvas; its first numeric parameter is offered first. */
  focusBlockId: string | null;
}

function candidatesOf(diagram: Diagram | null): Candidate[] {
  if (!diagram) return [];
  return diagram.blocks.flatMap((block) =>
    Object.entries(block.parameters)
      .filter(([key, value]) => typeof value === "number" && Number.isFinite(value) && !UNSLIDABLE_PARAMETERS.has(key))
      .map(([key, value]) => ({ key: `${block.id}.${key}`, blockType: block.type, blockId: block.id, parameter: key, value: value as number })),
  );
}

/** Poles of the assembled model and their path while one block parameter sweeps its range. */
export function PoleMap({ poles, diagram, focusBlockId }: PoleMapProps) {
  const candidates = useMemo(() => candidatesOf(diagram), [diagram]);
  const [chosen, setChosen] = useState<string>("");
  const [sweep, setSweep] = useState<SweepResponse | null>(null);
  const [error, setError] = useState("");

  // Prefer the selected block, then a loop gain (the classic root locus), then any dynamic parameter.
  const best = (list: Candidate[]) =>
    [...list].filter((candidate) => Number.isFinite(locusRank(candidate))).sort((a, b) => locusRank(a) - locusRank(b))[0];
  const preferred = best(candidates.filter((candidate) => candidate.blockId === focusBlockId))
    ?? best(candidates.filter((candidate) => candidate.blockType === "Gain"))
    ?? best(candidates)
    ?? candidates[0];
  const active = candidates.find((candidate) => candidate.key === chosen) ?? preferred;

  useEffect(() => {
    if (!diagram || !active) {
      setSweep(null);
      return;
    }
    const range = sliderRange(active.parameter, active.value);
    const values = Array.from({ length: SWEEP_POINTS }, (_, index) => range.min + ((range.max - range.min) * index) / (SWEEP_POINTS - 1));
    const controller = new AbortController();
    // Live edits change the diagram quickly; wait for a pause before asking for the locus.
    const timer = window.setTimeout(() => {
      sweepParameter(diagram, active.blockId, active.parameter, values, controller.signal)
        .then((response) => {
          setSweep(response);
          setError("");
        })
        .catch((sweepError: unknown) => {
          if (sweepError instanceof ApiError && sweepError.code === "aborted") return;
          setSweep(null);
          setError(errorText(sweepError, "Не удалось построить годограф."));
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [diagram, active?.key, active?.value]); // eslint-disable-line react-hooks/exhaustive-deps

  const locus = useMemo(() => {
    const x: number[] = [];
    const y: number[] = [];
    const text: string[] = [];
    for (const point of sweep?.points ?? []) {
      for (const pole of point.poles ?? []) {
        x.push(pole.real);
        y.push(pole.imag);
        text.push(`${sweep?.parameter} = ${Number(point.value.toPrecision(4))}`);
      }
    }
    return { x, y, text };
  }, [sweep]);

  const allX = [...locus.x, ...poles.map((pole) => pole.real), 0];
  const allY = [...locus.y, ...poles.map((pole) => pole.imag), 0];
  const xMin = Math.min(...allX);
  const xMax = Math.max(...allX);
  const yAbs = Math.max(1, ...allY.map(Math.abs));
  const pad = Math.max(0.5, (xMax - xMin) * 0.08);
  const xRange = [xMin - pad, Math.max(xMax + pad, pad)];

  if (poles.length === 0 && !active) {
    return <p className="hud-note">Статическая модель: полюсов нет.</p>;
  }

  return (
    <div className="pole-map" data-testid="pole-map">
      {candidates.length > 0 && (
        <label className="pole-map__picker">
          <span className="hud-key">Параметр годографа</span>
          <select value={active?.key ?? ""} onChange={(event) => setChosen(event.target.value)} data-testid="locus-parameter">
            {candidates.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>{candidate.key} = {Number(candidate.value.toPrecision(4))}</option>
            ))}
          </select>
        </label>
      )}
      <Plot
        data={[
          {
            x: locus.x, y: locus.y, text: locus.text, type: "scatter", mode: "markers", name: "годограф",
            marker: { size: 3, color: "rgba(242, 242, 242, 0.55)" },
            hovertemplate: "%{text}<br>%{x:.4g} %{y:+.4g}j<extra></extra>",
          },
          {
            x: poles.map((pole) => pole.real), y: poles.map((pole) => pole.imag), type: "scatter", mode: "markers",
            name: "полюса", marker: { size: 8, color: poles.map((pole) => (pole.real > 1e-9 ? UNSTABLE_COLOR : MARKER_COLOR)), line: { width: 0 } },
            hovertemplate: "полюс %{x:.4g} %{y:+.4g}j<extra></extra>",
          },
        ]}
        layout={{
          ...plotLayout({ hovermode: "closest", margin: { l: 56, r: 16, b: 44, t: 8 } }),
          xaxis: axis("Re λ", { range: xRange, zeroline: true }),
          yaxis: axis("Im λ", { range: [-yAbs * 1.2, yAbs * 1.2], zeroline: true }),
          shapes: [
            {
              type: "rect", xref: "x", yref: "paper", x0: 0, x1: xRange[1], y0: 0, y1: 1,
              fillcolor: "rgba(255, 90, 79, 0.06)", line: { width: 0 }, layer: "below",
            },
          ],
        }}
        config={STATIC_PLOT_CONFIG}
        style={{ width: "100%", height: "280px" }}
        useResizeHandler
      />
      <p className="hud-note">
        {error || (active
          ? `Яркие точки — полюса текущей модели, красные — неустойчивые; мелкие — путь полюсов при ${active.key} от ${Number(sliderRange(active.parameter, active.value).min.toPrecision(3))} до ${Number(sliderRange(active.parameter, active.value).max.toPrecision(3))}. Правая полуплоскость затенена.`
          : "Яркие точки — полюса текущей модели, красные — неустойчивые.")}
      </p>
    </div>
  );
}
