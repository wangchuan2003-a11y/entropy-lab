import "./style.css";
import {
  DEFAULT,
  MAX_STEPS,
  Experiment,
  validate,
  decode,
  encode,
  toCSV,
  type Settings,
} from "./model";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let experiment = new Experiment(decode(location.hash) ?? DEFAULT);
let running = false;
let timer: number | undefined;
const fmt = (n: number) =>
  n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
function report(message: string) {
  $("status").textContent = message;
}
function pause() {
  running = false;
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
}
function buildParticles() {
  const n = experiment.settings.n;
  const rows = Math.ceil(n / 15);
  $("particles").innerHTML = Array.from(
    { length: n },
    (_, id) =>
      `<i id="particle-${id}" class="particle" style="--slot:${id % 15};--row:${Math.floor(id / 15)};--rows:${rows}"></i>`,
  ).join("");
}
function axes(maxX: number, maxY: number) {
  return `<path class="axis" d="M42 12V204H548"/><text x="37" y="207" text-anchor="end">0</text><text x="37" y="18" text-anchor="end">${fmt(maxY)}</text><text x="42" y="224">0</text><text x="548" y="224" text-anchor="end">${maxX}</text>`;
}
function render() {
  const { n } = experiment.settings;
  const state = experiment.state;
  const event = experiment.event;
  $("left").textContent = String(experiment.left);
  $("right").textContent = String(n - experiment.left);
  $("entropy").textContent = fmt(experiment.entropy);
  $("step-count").textContent = `${experiment.step} / ${MAX_STEPS} 步`;
  state.particles.forEach((left, id) => {
    const dot = $("particle-" + id);
    dot.classList.toggle("right-side", !left);
    dot.classList.toggle("chosen", event?.particle === id);
  });
  $("event").textContent = event
    ? `选中粒子 #${event.particle + 1} · ${event.flip ? "换箱" : "保持原箱"}`
    : "初始状态：还没有随机事件";
  $("play").textContent = running
    ? "暂停"
    : experiment.canForward
      ? "开始观察"
      : "已到 2000 步";
  $<HTMLButtonElement>("play").disabled = !experiment.canForward;
  $<HTMLButtonElement>("forward").disabled = !experiment.canForward;
  $<HTMLButtonElement>("back").disabled = !experiment.canBack;
  $<HTMLButtonElement>("replay").disabled = experiment.recorded === 0;
  const slider = $<HTMLInputElement>("timeline");
  slider.max = String(experiment.recorded);
  slider.value = String(experiment.step);
  slider.disabled = experiment.recorded === 0;
  $("timeline-label").textContent =
    `${experiment.step} / ${experiment.recorded}`;
  const points = experiment.points();
  const maxEntropy = Math.max(...experiment.entropies);
  const maxStep = Math.max(experiment.step, 20);
  const path = points
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${42 + (p.step / maxStep) * 506},${204 - (p.entropy / maxEntropy) * 192}`,
    )
    .join(" ");
  const current = points[points.length - 1];
  $("entropy-plot").innerHTML =
    axes(maxStep, maxEntropy) +
    `<path class="entropy-line" d="${path}"/><circle class="tip" r="3" cx="${42 + (current.step / maxStep) * 506}" cy="${204 - (current.entropy / maxEntropy) * 192}"/>`;
  const difference =
    points.length > 1 ? current.entropy - points[points.length - 2].entropy : 0;
  $("delta").textContent =
    `当前变化 ${difference >= 0 ? "+" : ""}${fmt(difference)} bits`;
  const histogram = experiment.histogram();
  const probabilities = histogram.map((x) => x / points.length);
  const maxP = Math.max(...probabilities, ...experiment.theory, 0.01);
  const width = 506 / (n + 1);
  const bars = probabilities
    .map((p, k) =>
      p
        ? `<rect class="hist-bar" x="${42 + k * width}" y="${204 - (p / maxP) * 192}" width="${Math.max(0.6, width - 0.3)}" height="${(p / maxP) * 192}"/>`
        : "",
    )
    .join("");
  const theory = experiment.theory
    .map(
      (p, k) =>
        `${k ? "L" : "M"}${42 + (k + 0.5) * width},${204 - (p / maxP) * 192}`,
    )
    .join(" ");
  $("histogram").innerHTML =
    axes(n, maxP) + bars + `<path class="theory-line" d="${theory}"/>`;
  $("samples").textContent = `${points.length} 个状态样本`;
}
function start() {
  if (!experiment.canForward) return;
  pause();
  running = true;
  timer = window.setInterval(
    () => {
      if (document.hidden) return;
      const speed = Number($<HTMLSelectElement>("speed").value);
      for (let i = 0; i < Math.max(1, speed / 10); i++) {
        if (!experiment.forward()) break;
      }
      if (!experiment.canForward) {
        pause();
        report("已达到 2,000 步上限。可以倒退或重放，重新设置会清空轨迹。");
      }
      render();
    },
    Number($<HTMLSelectElement>("speed").value) < 10 ? 500 : 100,
  );
  render();
}
function reset(settings: Settings, message: string) {
  pause();
  experiment = new Experiment(settings);
  $<HTMLInputElement>("n").value = String(settings.n);
  $<HTMLInputElement>("seed").value = String(settings.seed);
  $<HTMLSelectElement>("initial").value = settings.initial;
  buildParticles();
  render();
  report(message);
}
function readSettings() {
  const settings = {
    n: Number($<HTMLInputElement>("n").value),
    seed: Number($<HTMLInputElement>("seed").value),
    initial: $<HTMLSelectElement>("initial").value,
  };
  if (
    !$<HTMLInputElement>("n").value ||
    !$<HTMLInputElement>("seed").value ||
    !validate(settings)
  ) {
    report("N 需为20–300的整数，种子需为0–4294967295的整数。原实验未改变。");
    return;
  }
  reset(settings, "新实验已建立，旧轨迹已清空。");
}
for (const id of ["n", "seed", "initial"])
  $(id).addEventListener("change", readSettings);
$("restart").onclick = readSettings;
$("play").onclick = () => {
  if (running) {
    pause();
    render();
    report("已暂停。可单步、倒退或导出当前轨迹。");
  } else start();
};
$("forward").onclick = () => {
  pause();
  experiment.forward();
  render();
  report(
    experiment.canForward
      ? "单步完成；熵可能上升、保持或下降。"
      : "已达到 2,000 步上限。",
  );
};
$("back").onclick = () => {
  pause();
  experiment.back();
  render();
  report("使用已保存事件倒退一步。再次前进会原样重放，不重新抽样。");
};
$("replay").onclick = () => {
  pause();
  experiment.seek(0);
  render();
  report("已回到初态。点击播放，将先重放已保存事件。");
};
$("timeline").addEventListener("input", () => {
  pause();
  experiment.seek(Number($<HTMLInputElement>("timeline").value));
  render();
  report("正在查看已保存轨迹；直方图统计当前光标之前的状态。");
});
$("speed").addEventListener("change", () => {
  if (running) start();
});
$("share").onclick = async () => {
  const url = new URL(location.href);
  url.hash = encode(experiment.settings);
  history.replaceState(null, "", url);
  try {
    await navigator.clipboard.writeText(url.href);
    report("初始设置链接已复制；不包含当前播放位置。");
  } catch {
    report("初始设置已写入地址栏，请手动复制浏览器地址。");
  }
};
$("csv").onclick = () => {
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + toCSV(experiment)], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "entropy-lab-trajectory.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  report(
    `已导出从初态到第${experiment.step}步的轨迹，共${experiment.step + 1}行状态。`,
  );
};
window.addEventListener("hashchange", () => {
  if (!location.hash.startsWith("#v")) return;
  const settings = decode(location.hash);
  if (settings) reset(settings, "已恢复链接中的初始设置。");
  else report("初始设置链接无效，原实验未改变。");
});
reset(
  experiment.settings,
  location.hash.startsWith("#v")
    ? decode(location.hash)
      ? "已加载分享初始设置。"
      : "分享链接无效，已载入默认实验。"
    : "每步均匀选一个有标签粒子，再以50%概率换箱、50%概率保持。",
);
