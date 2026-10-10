import { useEffect, useMemo, useState } from "react";
import Plot from "../Plot";
import { axis, MARKER_COLOR, plotLayout, SINGLE_SERIES_COLOR, STATIC_PLOT_CONFIG, UNSTABLE_COLOR } from "../plotTheme";
import { analyzeLoop, ApiError, errorText, type LoopCut, type LoopResponse } from "../../api/client";
import type { Diagram } from "../../types/diagram";

/** Fired with the chosen cut so the canvas can mark the broken connection. */
export const LOOP_CUT_EVENT = "cl-loop-cut";

const cutKey = (cut: LoopCut) => `${cut.from_block}.${cut.from_port}→${cut.to_block}.${cut.to_port}`;

function format(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Number(value.toPrecision(digits)).toString();
}

interface LoopMarginsViewProps {
  diagram: Diagram | null;
}

/**
 * Stability margins of a closed loop: the user picks the connection at which the
 * loop is broken, the server returns L(jω), the margins and the Nyquist criterion.
 */
export function LoopMarginsView({ diagram }: LoopMarginsViewProps) {
  const [candidates, setCandidates] = useState<LoopCut[]>([]);
  const [chosen, setChosen] = useState("");
  const [loop, setLoop] = useState<LoopResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!diagram) return;
    const controller = new AbortController();
    analyzeLoop(diagram, null, controller.signal)
      .then((response) => {
        setCandidates(response.candidates);
        setError("");
      })
      .catch((loopError: unknown) => {
        if (loopError instanceof ApiError && loopError.code === "aborted") return;
        setError(errorText(loopError, "Не удалось найти контуры схемы."));
      });
    return () => controller.abort();
  }, [diagram]);

  // Prefer cutting the feedback path: the connection that enters a summing junction.
  const preferred = candidates.find((cut) => diagram?.blocks.find((block) => block.id === cut.to_block)?.type === "Sum"
    && cut.to_port !== "in1") ?? candidates[0];
  const active = candidates.find((cut) => cutKey(cut) === chosen) ?? preferred;

  useEffect(() => {
    if (!diagram || !active) {
      setLoop(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      analyzeLoop(diagram, active, controller.signal)
        .then((response) => {
          setLoop(response);
          setError("");
        })
        .catch((loopError: unknown) => {
          if (loopError instanceof ApiError && loopError.code === "aborted") return;
          setLoop(null);
          setError(errorText(loopError, "Не удалось рассчитать запасы устойчивости."));
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [diagram, active ? cutKey(active) : ""]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(LOOP_CUT_EVENT, { detail: active ?? null }));
    return () => {
      window.dispatchEvent(new CustomEvent(LOOP_CUT_EVENT, { detail: null }));
    };
  }, [active ? cutKey(active) : ""]); // eslint-disable-line react-hooks/exhaustive-deps

  const nyquist = useMemo(() => {
    if (!loop) return null;
    // Keep the plot readable near integrators: clip the branch that runs off to infinity.
    const limit = 4 * Math.max(2, ...loop.nyquist_real.filter((_, i) => Math.hypot(loop.nyquist_real[i], loop.nyquist_imag[i]) < 50)
      .map(Math.abs));
    const x: Array<number | null> = [];
    const y: Array<number | null> = [];
    loop.nyquist_real.forEach((re, index) => {
      const im = loop.nyquist_imag[index];
      const inside = Math.abs(re) <= limit && Math.abs(im) <= limit;
      x.push(inside ? re : null);
      y.push(inside ? im : null);
    });
    return { x, y, limit };
  }, [loop]);

  if (!diagram) return null;
  if (candidates.length === 0) {
    return (
      <section className="loop-margins" data-testid="loop-margins">
        <h3>Запасы устойчивости</h3>
        <p className="hud-note">{error || "В схеме нет замкнутого контура: запасы устойчивости определяются только для контура с обратной связью."}</p>
      </section>
    );
  }

  const stable = loop?.nyquist_stable;
  return (
    <section className="loop-margins" data-testid="loop-margins">
      <header className="loop-margins__header">
        <h3>Запасы устойчивости</h3>
        <label className="frequency-channel-picker">
          <span>Разомкнуть контур в связи</span>
          <select value={active ? cutKey(active) : ""} onChange={(event) => setChosen(event.target.value)} data-testid="loop-cut">
            {candidates.map((cut) => (
              <option key={cutKey(cut)} value={cutKey(cut)}>{cutKey(cut)}</option>
            ))}
          </select>
        </label>
      </header>

      {loop && nyquist && (
        <>
          <dl className="loop-margins__summary" data-testid="loop-summary">
            <div>
              <dt>Запас по амплитуде</dt>
              <dd>{loop.gain_margin === null ? "∞" : `×${format(loop.gain_margin)} · ${format(loop.gain_margin_db)} дБ`}</dd>
              <span>ω_π = {format(loop.phase_crossover)} рад/с</span>
            </div>
            <div>
              <dt>Запас по фазе</dt>
              <dd>{loop.phase_margin === null ? "—" : `${format(loop.phase_margin)}°`}</dd>
              <span>ω_с = {format(loop.gain_crossover)} рад/с</span>
            </div>
            <div>
              <dt>Критерий Найквиста</dt>
              <dd className={stable ? "is-stable" : "is-unstable"}>{stable ? "Устойчива" : "Неустойчива"}</dd>
              <span>P = {loop.open_loop_unstable_poles} · N = {loop.encirclements} · Z = N + P = {(loop.encirclements ?? 0) + (loop.open_loop_unstable_poles ?? 0)}</span>
            </div>
            <div>
              <dt>Проверка</dt>
              <dd>{loop.poles_agree && loop.hurwitz_stable === stable ? "Совпадает" : "Расхождение"}</dd>
              <span>по полюсам и критерию Гурвица</span>
            </div>
          </dl>

          <div className="frequency-plot-grid">
            <article className="frequency-plot-card frequency-plot-card--nyquist">
              <h3>Годограф Найквиста L(jω)</h3>
              <Plot
                data={[
                  { x: nyquist.x, y: nyquist.y, type: "scatter", mode: "lines", connectgaps: false, name: "ω > 0", line: { color: SINGLE_SERIES_COLOR, width: 1.5 } },
                  { x: nyquist.x, y: nyquist.y.map((v) => (v === null ? null : -v)), type: "scatter", mode: "lines", connectgaps: false, name: "ω < 0", line: { color: SINGLE_SERIES_COLOR, width: 1, dash: "dot" } },
                  { x: [-1], y: [0], type: "scatter", mode: "markers", name: "−1", marker: { size: 9, color: stable ? MARKER_COLOR : UNSTABLE_COLOR, symbol: "x" } },
                ]}
                layout={{
                  ...plotLayout({ hovermode: "closest", margin: { l: 56, r: 16, b: 44, t: 8 }, showlegend: false }),
                  xaxis: axis("Re L(jω)", { scaleanchor: "y", scaleratio: 1, zeroline: true }),
                  yaxis: axis("Im L(jω)", { zeroline: true }),
                }}
                config={STATIC_PLOT_CONFIG}
                style={{ width: "100%", height: "300px" }}
                useResizeHandler
              />
            </article>
            <article className="frequency-plot-card">
              <h3>ЛАЧХ разомкнутого контура</h3>
              <Plot
                data={[{ x: loop.frequency, y: loop.magnitude_db, type: "scatter", mode: "lines", line: { color: SINGLE_SERIES_COLOR, width: 1.5 } }]}
                layout={{
                  ...plotLayout({ hovermode: "closest", margin: { l: 56, r: 16, b: 44, t: 8 } }),
                  xaxis: axis("ω, рад/с", { type: "log" }),
                  yaxis: axis("L(ω), дБ"),
                  shapes: [
                    { type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: "rgba(200,220,255,.4)", width: 1, dash: "dot" } },
                    ...(loop.gain_crossover ? [{ type: "line", x0: loop.gain_crossover, x1: loop.gain_crossover, yref: "paper", y0: 0, y1: 1, line: { color: MARKER_COLOR, width: 1, dash: "dot" } }] : []),
                  ],
                }}
                config={STATIC_PLOT_CONFIG}
                style={{ width: "100%", height: "250px" }}
                useResizeHandler
              />
            </article>
            <article className="frequency-plot-card">
              <h3>ЛФЧХ разомкнутого контура</h3>
              <Plot
                data={[{ x: loop.frequency, y: loop.phase_deg, type: "scatter", mode: "lines", line: { color: SINGLE_SERIES_COLOR, width: 1.5 } }]}
                layout={{
                  ...plotLayout({ hovermode: "closest", margin: { l: 56, r: 16, b: 44, t: 8 } }),
                  xaxis: axis("ω, рад/с", { type: "log" }),
                  yaxis: axis("φ(ω), °"),
                  shapes: [
                    { type: "line", xref: "paper", x0: 0, x1: 1, y0: -180, y1: -180, line: { color: "rgba(200,220,255,.4)", width: 1, dash: "dot" } },
                    ...(loop.phase_crossover ? [{ type: "line", x0: loop.phase_crossover, x1: loop.phase_crossover, yref: "paper", y0: 0, y1: 1, line: { color: MARKER_COLOR, width: 1, dash: "dot" } }] : []),
                  ],
                }}
                config={STATIC_PLOT_CONFIG}
                style={{ width: "100%", height: "250px" }}
                useResizeHandler
              />
            </article>
          </div>

          <p className="frequency-interpretation">
            Контур разомкнут в связи {cutKey(loop.cut ?? active!)}: L(s) — передача от разреза по кругу обратно к разрезу со знаком минус,
            замкнутая система описывается уравнением 1 + L(s) = 0. Запас по амплитуде — во сколько раз можно увеличить усиление
            контура до границы устойчивости, запас по фазе — сколько градусов запаздывания он выдержит.
            {loop.hurwitz.length > 0 && ` Определители Гурвица: ${loop.hurwitz.map((value) => format(value, 3)).join("; ")}.`}
          </p>
          {loop.notes.map((note) => <p key={note} className="hud-note">{note}</p>)}
        </>
      )}
      {error && <p className="hud-note">{error}</p>}
    </section>
  );
}
