#!/usr/bin/env node
/**
 * pi-agent-swarm roster badge 颜色稿（供审核，不改动任何源码）。
 *
 * 数据源：github/linguist `lib/linguist/languages.yml`（2025 年抓取）。
 * 设计约束：
 *  - ROLE 徽章永远是黄色，只调饱和度。
 *  - NAME 徽章 8 个槽位按色相一一映射到 GitHub 语言颜色，整体降饱和。
 *  - 每个槽位给 A（首选，低饱和）/ B（备选）两个候选，与现状并列对比。
 *
 * 运行：node packages/pi-agent-swarm/scripts/color-draft.mjs
 */

// ---------- 色彩工具（与 src/color.ts 同算法，脚本内独立实现避免依赖构建产物） ----------

function hsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** WCAG 相对亮度选黑/白字，与 src/color.ts 的 contrastTextColor 一致。 */
function contrastText(hex) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) ? "#000000" : "#ffffff";
}

const fg = (hex) =>
  `\x1b[38;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m`;
const bg = (hex) =>
  `\x1b[48;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m`;
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

function badge(text, bgHex) {
  return `${bg(bgHex)}${fg(contrastText(bgHex))} ${text} ${RESET}`;
}

/** 复刻 buildRosterBadge 的 FULL 形态： ● NAME + 白底 id + 黄底 ROLE。 */
function rosterLine(name, nameColor, role, roleYellow) {
  return `${badge(`● ${name}`, nameColor)}${bg("#ffffff")}${fg("#000000")} f47ac10b ${RESET}${badge(role, roleYellow)}`;
}

// ---------- 数据 ----------

/** 现状：Tailwind 500 高饱和调色板 + 现行 ROLE 黄。 */
const CURRENT = {
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  cyan: "#06b6d4",
  blue: "#3b82f6",
  magenta: "#d946ef",
  purple: "#8b5cf6",
};
const CURRENT_ROLE_YELLOW = "#ffc85a";

/**
 * NAME 候选。A = 首选（低饱和、色相贴近槽位），B = 备选（更亮或更经典）。
 * lang 字段是 GitHub Linguist 里的语言名，颜色即 GitHub 仓库语言条所用色。
 */
const NAME_SLOTS = [
  { slot: "red", a: { hex: "#c22d40", lang: "Scala" }, b: { hex: "#db5855", lang: "Clojure" } },
  { slot: "orange", a: { hex: "#b07219", lang: "Java" }, b: { hex: "#dea584", lang: "Rust" } },
  // 定案：黄色 NAME 与 ROLE 徽章同色 #ffc85a（不用灰色替代）。
  {
    slot: "yellow",
    a: { hex: "#ffc85a", lang: null, note: "定案：与 ROLE 徽章同色" },
    b: { hex: "#f1e05a", lang: "JavaScript" },
  },
  { slot: "green", a: { hex: "#41b883", lang: "Vue" }, b: { hex: "#89e051", lang: "Shell" } },
  { slot: "cyan", a: { hex: "#4298b8", lang: "Groovy" }, b: { hex: "#00ADD8", lang: "Go" } },
  { slot: "blue", a: { hex: "#3178c6", lang: "TypeScript" }, b: { hex: "#3572A5", lang: "Python" } },
  { slot: "magenta", a: { hex: "#B83998", lang: "Erlang" }, b: { hex: "#f34b7d", lang: "C++" } },
  { slot: "purple", a: { hex: "#8847B9", lang: "Elixir" }, b: { hex: "#A97BFF", lang: "Kotlin" } },
];

/** ROLE 黄候选：色相保持黄，只调饱和度。定案：保留现状 #ffc85a。 */
const ROLE_YELLOWS = [
  { hex: "#ffc85a", label: "定案", lang: null },
  { hex: "#f1e05a", label: "落选 A", lang: "JavaScript" },
  { hex: "#e7c055", label: "落选 B", lang: null, note: "自定义柔黄 hsl(44,75%,62%)" },
];

// ---------- 渲染 ----------

function chip(hex, label, lang, note) {
  const { h, s, l } = hsl(hex);
  const src = lang ? `${DIM}${lang}${RESET}` : `${DIM}custom${RESET}`;
  const extra = note ? ` ${DIM}${note}${RESET}` : "";
  return `${badge(label, hex)} ${hex}  hsl(${h},${s}%,${l}%)  ${src}${extra}`;
}

console.log(
  `\n${BOLD}pi-agent-swarm roster badge 颜色稿${RESET}  ${DIM}数据源: github/linguist languages.yml${RESET}\n`,
);

console.log(`${BOLD}① ROLE 黄（永远是黄色，只调饱和度）${RESET}`);
for (const y of ROLE_YELLOWS) {
  console.log(`   ${chip(y.hex, ` ${y.label} ROLE `, y.lang, y.note)}`);
}

console.log(`\n${BOLD}② NAME 八槽位：现状 vs GitHub 语言色${RESET}`);
for (const { slot, a, b } of NAME_SLOTS) {
  console.log(`\n   ${BOLD}${slot}${RESET}`);
  console.log(`     现状  ${chip(CURRENT[slot], ` ${slot} `, null)}`);
  console.log(`     A     ${chip(a.hex, ` ${slot} `, a.lang, a.note)}`);
  console.log(`     B     ${chip(b.hex, ` ${slot} `, b.lang, b.note)}`);
}

console.log(`\n${BOLD}③ 整体效果预览（FULL 形态 footer 徽章）${RESET}`);
const preview = (title, colors, roleYellow) => {
  console.log(`\n   ${BOLD}${title}${RESET}`);
  for (const slot of Object.keys(CURRENT)) {
    console.log(
      `     ${rosterLine(`MANAGER-${slot}`, colors[slot], slot === "red" ? "LEADER" : "WORKER", roleYellow)}`,
    );
  }
};
preview("现状", CURRENT, CURRENT_ROLE_YELLOW);
preview(
  "方案 A（默认，低饱和）",
  Object.fromEntries(NAME_SLOTS.map(({ slot, a }) => [slot, a.hex])),
  CURRENT_ROLE_YELLOW,
);
preview(
  "方案 B（亮色备选，colorPalette: bright）",
  Object.fromEntries(NAME_SLOTS.map(({ slot, b }) => [slot, b.hex])),
  CURRENT_ROLE_YELLOW,
);

// ---------- 饱和度统计 ----------

const avgSat = (colors) => Math.round(Object.values(colors).reduce((sum, hex) => sum + hsl(hex).s, 0) / 8);
const setA = Object.fromEntries(NAME_SLOTS.map(({ slot, a }) => [slot, a.hex]));
const setB = Object.fromEntries(NAME_SLOTS.map(({ slot, b }) => [slot, b.hex]));
console.log(`\n${BOLD}④ 平均饱和度${RESET}`);
console.log(`   现状 ${avgSat(CURRENT)}%  →  方案 A ${avgSat(setA)}%  →  方案 B ${avgSat(setB)}%`);
console.log(`   ROLE 黄 定案保留 #ffc85a（${hsl(CURRENT_ROLE_YELLOW).s}% 饱和）\n`);
