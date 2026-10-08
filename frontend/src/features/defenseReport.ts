import type {
  OutputFeedbackResponse,
  SystemAnalysis,
} from "../types/api";

export interface DefenseReportData {
  system: SystemAnalysis;
  result: OutputFeedbackResponse;
  generatedAt?: Date;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatNumber(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "н/д";
  if (Math.abs(value) > 0 && (Math.abs(value) < 1e-3 || Math.abs(value) >= 1e4)) {
    return value.toExponential(2);
  }
  return value.toFixed(digits);
}

function formatMatrix(matrix: number[][]): string {
  if (!matrix.length) return "—";
  return matrix
    .map((row) => `[${row.map((value) => formatNumber(value, 3)).join("  ")}]`)
    .join("\n");
}

function formatPoles(poles: Array<{ real: number; imag: number }>): string {
  if (!poles.length) return "—";
  return poles.map((pole) => {
    if (Math.abs(pole.imag) < 1e-10) return formatNumber(pole.real, 3);
    return `${formatNumber(pole.real, 3)} ${pole.imag >= 0 ? "+" : "−"} ${formatNumber(Math.abs(pole.imag), 3)}i`;
  }).join(", ");
}

function methodName(method: string): string {
  if (method === "full_state_lqr") return "LQR, истинное x";
  if (method === "luenberger_lqr") return "LQR + Люенбергер";
  return "LQG (Калман)";
}

function reportStatus(ok: boolean, positive: string, negative: string): string {
  return `<span class="status ${ok ? "ok" : "bad"}">${escapeHtml(ok ? positive : negative)}</span>`;
}

function polylinePoints(
  time: number[],
  values: number[],
  bounds: { tMin: number; tMax: number; yMin: number; yMax: number },
): string {
  const left = 54;
  const top = 18;
  const plotWidth = 702;
  const plotHeight = 176;
  const timeSpan = Math.max(bounds.tMax - bounds.tMin, Number.EPSILON);
  const valueSpan = Math.max(bounds.yMax - bounds.yMin, Number.EPSILON);
  const stride = Math.max(1, Math.ceil(time.length / 800));
  const points: string[] = [];
  for (let index = 0; index < Math.min(time.length, values.length); index += stride) {
    const x = left + ((time[index] - bounds.tMin) / timeSpan) * plotWidth;
    const y = top + plotHeight - ((values[index] - bounds.yMin) / valueSpan) * plotHeight;
    if (Number.isFinite(x) && Number.isFinite(y)) points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const lastIndex = Math.min(time.length, values.length) - 1;
  if (lastIndex >= 0 && lastIndex % stride !== 0) {
    const x = left + ((time[lastIndex] - bounds.tMin) / timeSpan) * plotWidth;
    const y = top + plotHeight - ((values[lastIndex] - bounds.yMin) / valueSpan) * plotHeight;
    if (Number.isFinite(x) && Number.isFinite(y)) points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(" ");
}

function trackingChart(result: OutputFeedbackResponse): string {
  const time = result.trace.time;
  const reference = Number(result.settings.reference);
  const series = [
    ...result.trace.full_state_output,
    ...result.trace.luenberger_output,
    ...result.trace.kalman_output,
    reference,
  ].filter(Number.isFinite);
  if (time.length < 2 || series.length === 0) return "<p>Траектории не записаны.</p>";

  let yMin = Math.min(...series);
  let yMax = Math.max(...series);
  const padding = Math.max((yMax - yMin) * 0.12, Math.abs(reference) * 0.05, 0.1);
  yMin -= padding;
  yMax += padding;
  const bounds = { tMin: time[0], tMax: time[time.length - 1], yMin, yMax };
  const yFor = (value: number) => 18 + 176 - ((value - yMin) / Math.max(yMax - yMin, Number.EPSILON)) * 176;
  const referenceY = yFor(reference);
  const zeroY = yFor(0);

  return `
    <svg class="tracking-chart" viewBox="0 0 780 230" role="img" aria-label="Сравнение слежения трёх контуров">
      <rect x="54" y="18" width="702" height="176" fill="#fff" stroke="#d3d3d3"/>
      ${zeroY >= 18 && zeroY <= 194 ? `<line x1="54" x2="756" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="#e5e5e5"/>` : ""}
      <line x1="54" x2="756" y1="${referenceY.toFixed(1)}" y2="${referenceY.toFixed(1)}" stroke="#777" stroke-dasharray="5 4"/>
      <polyline points="${polylinePoints(time, result.trace.full_state_output, bounds)}" fill="none" stroke="#777" stroke-width="1.4"/>
      <polyline points="${polylinePoints(time, result.trace.luenberger_output, bounds)}" fill="none" stroke="#aaa" stroke-width="1.5" stroke-dasharray="3 3"/>
      <polyline points="${polylinePoints(time, result.trace.kalman_output, bounds)}" fill="none" stroke="#c84f24" stroke-width="2.2"/>
      <text x="54" y="214">0 с</text><text x="724" y="214">${escapeHtml(formatNumber(bounds.tMax, 1))} с</text>
      <text x="6" y="24">${escapeHtml(formatNumber(yMax, 2))}</text><text x="6" y="194">${escapeHtml(formatNumber(yMin, 2))}</text>
    </svg>
    <div class="legend"><span class="ref">задание r</span><span class="full">LQR</span><span class="luenberger">Люенбергер</span><span class="lqg">LQG</span></div>`;
}

export function buildDefenseReportHtml({ system, result, generatedAt = new Date() }: DefenseReportData): string {
  const lqgDesign = result.designs.find((item) => item.method === "lqg");
  const lqgMetric = result.metrics.find((item) => item.method === "lqg");
  const separationOk = Boolean(lqgDesign?.separation_matches);
  const trackingTolerance = Math.max(Math.abs(Number(result.settings.reference)) * 0.03, 0.01);
  const trackingOk = Boolean(lqgMetric && Math.abs(lqgMetric.steady_state_error) <= trackingTolerance);
  const saturationOk = Boolean(lqgMetric && lqgMetric.saturation_percent === 0);
  const overallOk = result.model.fully_controllable
    && result.model.fully_observable
    && Boolean(lqgDesign?.asymptotically_stable)
    && separationOk
    && trackingOk;
  const generatedLabel = generatedAt.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const methodRows = result.designs.map((design) => {
    const metric = result.metrics.find((item) => item.method === design.method);
    return `<tr>
      <td>${escapeHtml(methodName(design.method))}</td>
      <td>${formatNumber(design.spectral_radius, 4)}</td>
      <td>${formatNumber(metric?.tracking_rmse, 4)}</td>
      <td>${formatNumber(metric?.steady_state_error, 4)}</td>
      <td>${metric?.estimation_rmse === null || metric?.estimation_rmse === undefined ? "—" : formatNumber(metric.estimation_rmse, 4)}</td>
      <td>${formatNumber(metric?.saturation_percent, 2)}%</td>
    </tr>`;
  }).join("");

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Протокол демонстрации САУ</title>
<style>
  :root{font-family:Arial,sans-serif;color:#181818;background:#fff;font-size:12px}*{box-sizing:border-box}body{margin:0}main{width:210mm;min-height:297mm;margin:0 auto;padding:13mm 15mm}header{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #222;padding-bottom:8px;margin-bottom:12px}h1{font-size:20px;margin:0 0 3px}h2{font-size:13px;margin:13px 0 6px}p{margin:3px 0;line-height:1.38}.meta{color:#666;text-align:right}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.card{border:1px solid #d5d5d5;padding:7px;min-height:52px}.card span{display:block;color:#666;font-size:10px;margin-bottom:4px}.card strong{font-size:14px}.status{display:inline-block;border:1px solid;padding:2px 5px;font-size:10px}.status.ok{color:#245c36;border-color:#8caf97;background:#f2faf4}.status.bad{color:#912f2a;border-color:#ca8f8b;background:#fff5f4}.model{display:grid;grid-template-columns:1fr 1fr;gap:10px}.matrix{white-space:pre;font:10px/1.35 Consolas,monospace;background:#f6f6f6;border:1px solid #ddd;padding:6px;overflow:hidden}table{width:100%;border-collapse:collapse;font-size:10.5px}th,td{border:1px solid #d5d5d5;padding:5px 6px;text-align:left}th{background:#f1f1f1}.tracking-chart{display:block;width:100%;height:175px}.tracking-chart text{font:10px Arial,sans-serif;fill:#666}.legend{display:flex;justify-content:center;gap:18px;font-size:10px}.legend span:before{content:"";display:inline-block;width:18px;height:2px;margin:0 5px 3px 0;background:#777}.legend .ref:before{height:1px;background:#777}.legend .luenberger:before{background:#aaa}.legend .lqg:before{background:#c84f24}.conclusion{border-left:3px solid #c84f24;padding:7px 10px;background:#f7f7f7}.limitations{color:#555;font-size:10px}.toolbar{position:fixed;right:16px;top:16px}.toolbar button{padding:8px 12px;border:1px solid #333;background:#fff;cursor:pointer}@page{size:A4;margin:0}@media print{main{margin:0}.toolbar{display:none}}@media(max-width:820px){main{width:100%;padding:18px}.grid{grid-template-columns:1fr 1fr}}
</style></head><body>
<div class="toolbar"><button onclick="window.print()">Печать / PDF</button></div>
<main>
  <header><div><h1>Протокол демонстрационного эксперимента</h1><p>Веб-ориентированная система визуального моделирования динамических систем</p></div><div class="meta">Сформировано<br>${escapeHtml(generatedLabel)}</div></header>
  <section class="grid">
    <div class="card"><span>Порядок модели</span><strong>n = ${result.model.state_dimension}</strong></div>
    <div class="card"><span>Управляемость</span><strong>${result.model.controllability_rank}/${result.model.state_dimension}</strong><br>${reportStatus(result.model.fully_controllable, "полная", "неполная")}</div>
    <div class="card"><span>Наблюдаемость</span><strong>${result.model.observability_rank}/${result.model.state_dimension}</strong><br>${reportStatus(result.model.fully_observable, "полная", "неполная")}</div>
    <div class="card"><span>Итог проверки</span><strong>${overallOk ? "Пройден" : "Требует внимания"}</strong><br>${reportStatus(overallOk, "условия выполнены", "есть замечания")}</div>
  </section>
  <h2>1. Модель объекта</h2>
  <div class="model"><div><p><b>Канал управления:</b> ${escapeHtml(result.model.input_block_id)}</p><p><b>Измеряемый выход:</b> ${escapeHtml(result.model.output_label)}</p><p><b>Непрерывные полюса:</b> ${escapeHtml(formatPoles(system.poles))}</p><p><b>Устойчивость объекта:</b> ${escapeHtml(system.stability)}</p></div><div><p><b>Шаг ZOH:</b> ${formatNumber(result.settings.sample_time, 3)} с</p><p><b>Горизонт:</b> ${formatNumber(result.settings.horizon, 1)} с</p><p><b>Задание:</b> r = ${formatNumber(result.settings.reference, 3)}</p><p><b>Ограничение:</b> |u| ≤ ${formatNumber(result.settings.control_limit, 3)}</p></div></div>
  <div class="model"><div><p><b>A</b></p><div class="matrix">${escapeHtml(formatMatrix(system.matrices.A))}</div><p><b>B</b></p><div class="matrix">${escapeHtml(formatMatrix(system.matrices.B))}</div></div><div><p><b>C</b></p><div class="matrix">${escapeHtml(formatMatrix(system.matrices.C))}</div><p><b>D</b></p><div class="matrix">${escapeHtml(formatMatrix(system.matrices.D))}</div></div></div>
  <h2>2. Синтез регулятора и наблюдателя</h2>
  <p><b>Полюса LQR:</b> ${escapeHtml(formatPoles(lqgDesign?.controller_poles ?? []))}</p>
  <p><b>Полюса фильтра Калмана:</b> ${escapeHtml(formatPoles(lqgDesign?.observer_poles ?? []))}</p>
  <p><b>Принцип разделения:</b> ${separationOk ? "полюса объединённой системы совпадают с объединением полюсов регулятора и наблюдателя" : "проверка не пройдена"}.</p>
  <h2>3. Сравнение замкнутых контуров</h2>
  <table><thead><tr><th>Контур</th><th>ρ</th><th>RMSE слежения</th><th>Ошибка r−y</th><th>RMSE оценки</th><th>Насыщение</th></tr></thead><tbody>${methodRows}</tbody></table>
  ${trackingChart(result)}
  <h2>4. Вывод</h2>
  <div class="conclusion"><b>${overallOk ? "Эксперимент подтверждает работоспособность контура." : "Эксперимент требует дополнительной настройки."}</b> ${overallOk ? `Модель полностью управляема и наблюдаема, LQG-контур Шур-устойчив, принцип разделения выполняется, а конечная ошибка слежения ${formatNumber(lqgMetric?.steady_state_error, 4)} находится в принятой трёхпроцентной области.` : "Проверьте ранги, устойчивость полюсов и конечную ошибку в таблице выше."} ${saturationOk ? "Ограничение управления в демонстрации не активировалось." : "В траектории присутствует насыщение, поэтому линейная гарантия носит локальный характер."}</div>
  <p class="limitations"><b>Границы вывода:</b> результат относится к номинальной линейной модели и выбранному шагу дискретизации. При активном насыщении, существенной неопределённости параметров или нелинейности объекта глобальная устойчивость этим экспериментом не доказывается.</p>
</main></body></html>`;
}

export function openDefenseReport(data: DefenseReportData): boolean {
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) return false;
  reportWindow.opener = null;
  reportWindow.document.open();
  reportWindow.document.write(buildDefenseReportHtml(data));
  reportWindow.document.close();
  return true;
}
