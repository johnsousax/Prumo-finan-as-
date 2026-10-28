// Gerador de PDF sem dependências (fontes padrão Helvetica/Times, WinAnsi). Roda em Deno (Supabase) e Node.
// Recebe blocos de conteúdo e devolve um PDF A4 com capa, rodapé e marca d'água do comprador.
import { U2W, W } from "./afm.ts";

type Run = [string, number];
type Blk = Record<string, any>;
type RGB = [number, number, number];
type FontKey = "Helvetica" | "Helvetica-Bold" | "Times-Bold";

const C: Record<string, RGB> = {
  ink: hex("0F1B2D"), ink2: hex("3B4757"), muted: hex("6B7480"), sand: hex("F1ECE1"), paper: hex("FBF9F4"),
  green: hex("0E8A63"), green2: hex("4FD1A5"), greenSoft: hex("E3F2EC"), red: hex("D64545"), redSoft: hex("FBE9E9"),
  gold: hex("B8901F"), line: hex("E2DCCF"), white: [1, 1, 1], navy2: hex("27354A"), gray: hex("8A94A3"), sub: hex("C9CFD8"),
};
function hex(h: string): RGB { return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB; }

const FONT_ID: Record<FontKey, string> = { Helvetica: "F1", "Helvetica-Bold": "F2", "Times-Bold": "F3" };
const PW = 595.28, PH = 841.89, ML = 56, MR = 56, MT = 62, MB = 74, CW = PW - ML - MR;

const TROCA: Record<string, string> = { "−": "-", "→": "->", "≈": "~", "✓": "", "≥": ">=", "≤": "<=", " ": " ", " ": " ", " ": " " };

function enc(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const t = TROCA[ch];
    if (t !== undefined) { for (const c of t) out.push(c.charCodeAt(0)); continue; }
    const cp = ch.codePointAt(0)!;
    if (cp >= 32 && cp < 127) out.push(cp);
    else if (cp >= 160 && cp <= 255) out.push(cp);
    else if (U2W[cp] !== undefined) out.push(U2W[cp]);
    else out.push(63);
  }
  return out;
}
const hexStr = (codes: number[]) => "<" + codes.map((c) => c.toString(16).padStart(2, "0")).join("") + ">";
const width = (s: string, f: FontKey, size: number) => enc(s).reduce((a, c) => a + (W[f][c] || 500), 0) * size / 1000;
const n = (v: number) => (Math.round(v * 100) / 100).toString();
const col = (c: RGB, stroke = false) => `${n(c[0])} ${n(c[1])} ${n(c[2])} ${stroke ? "RG" : "rg"}`;

type Seg = { s: string; f: FontKey; w: number };
type Line = { segs: Seg[]; w: number };

// Quebra de linha com várias fontes no mesmo parágrafo.
function wrap(runs: Run[], maxW: number, size: number, reg: FontKey = "Helvetica", bold: FontKey = "Helvetica-Bold"): Line[] {
  const lines: Line[] = [];
  let cur: Line = { segs: [], w: 0 };
  const push = () => {
    while (cur.segs.length && /^\s+$/.test(cur.segs[cur.segs.length - 1].s)) cur.w -= cur.segs.pop()!.w;
    lines.push(cur); cur = { segs: [], w: 0 };
  };
  for (const [txt, b] of runs) {
    const f = b ? bold : reg;
    for (const tok of txt.split(/(\n|\s+)/)) {
      if (!tok) continue;
      if (tok === "\n") { push(); continue; }
      const sp = /^\s+$/.test(tok);
      if (sp && !cur.segs.length) continue;
      const t = sp ? " " : tok;
      let w = width(t, f, size);
      if (!sp && cur.w + w > maxW && cur.segs.length) push();
      if (!sp && w > maxW) { // palavra maior que a linha (links)
        let part = "";
        for (const ch of t) {
          if (width(part + ch, f, size) > maxW) { cur.segs.push({ s: part, f, w: width(part, f, size) }); push(); part = ""; }
          part += ch;
        }
        w = width(part, f, size); cur.segs.push({ s: part, f, w }); cur.w += w; continue;
      }
      cur.segs.push({ s: t, f, w }); cur.w += w;
    }
  }
  if (cur.segs.length) push();
  return lines;
}

class Page { ops: string[] = []; }

class Doc {
  pages: Page[] = [];
  p!: Page;
  y = 0;
  titulo: string;
  marca: string;
  constructor(titulo: string, marca: string) { this.titulo = titulo; this.marca = marca; }
  add(op: string) { this.p.ops.push(op); }
  newPage() { this.p = new Page(); this.pages.push(this.p); this.y = PH - MT; }
  text(s: string, x: number, y: number, f: FontKey, size: number, c: RGB, spacing = 0) {
    this.add(`BT ${col(c)} /${FONT_ID[f]} ${n(size)} Tf ${spacing ? n(spacing) + " Tc " : ""}1 0 0 1 ${n(x)} ${n(y)} Tm ${hexStr(enc(s))} Tj ${spacing ? "0 Tc " : ""}ET`);
  }
  line(l: Line, x: number, y: number, size: number, c: RGB, align: "l" | "r" = "l", w = 0) {
    let cx = align === "r" ? x + w - l.w : x;
    for (const s of l.segs) { if (s.s.trim()) this.text(s.s, cx, y, s.f, size, c); cx += s.w; }
  }
  rect(x: number, y: number, w: number, h: number, c: RGB) { this.add(`${col(c)} ${n(x)} ${n(y)} ${n(w)} ${n(h)} re f`); }
  rrect(x: number, y: number, w: number, h: number, r: number, c: RGB, stroke?: RGB) {
    const k = 0.5523 * r;
    const path = `${n(x + r)} ${n(y)} m ${n(x + w - r)} ${n(y)} l ${n(x + w - r + k)} ${n(y)} ${n(x + w)} ${n(y + r - k)} ${n(x + w)} ${n(y + r)} c ` +
      `${n(x + w)} ${n(y + h - r)} l ${n(x + w)} ${n(y + h - r + k)} ${n(x + w - r + k)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)} c ` +
      `${n(x + r)} ${n(y + h)} l ${n(x + r - k)} ${n(y + h)} ${n(x)} ${n(y + h - r + k)} ${n(x)} ${n(y + h - r)} c ` +
      `${n(x)} ${n(y + r)} l ${n(x)} ${n(y + r - k)} ${n(x + r - k)} ${n(y)} ${n(x + r)} ${n(y)} c h`;
    this.add(stroke ? `${col(c)} ${col(stroke, true)} 0.8 w ${path} B` : `${col(c)} ${path} f`);
  }
  hline(x1: number, x2: number, y: number, c: RGB, w = 0.6, dash = false) {
    this.add(`${col(c, true)} ${n(w)} w ${dash ? "[2 2] 0 d " : ""}${n(x1)} ${n(y)} m ${n(x2)} ${n(y)} l S${dash ? " [] 0 d" : ""}`);
  }
}

// Um "átomo" é um pedaço que não se divide entre páginas.
type Atom = { h: number; before: number; keep?: boolean; draw: (d: Doc, x: number, top: number) => void };

function paraAtoms(runs: Run[], size: number, lead: number, c: RGB, before: number, w = CW, x0 = 0, reg: FontKey = "Helvetica", bold: FontKey = "Helvetica-Bold"): Atom[] {
  const ls = wrap(runs, w, size, reg, bold);
  return ls.map((l, i) => ({
    h: lead, before: i ? 0 : before, keep: ls.length > 1 && i === ls.length - 2, // sem linha órfã
    draw: (d, x, top) => d.line(l, x + x0, top - lead + (lead - size) / 2 + 2, size, c),
  }));
}

// Mede/desenha um grupo de blocos dentro de uma caixa (sem quebra de página).
function innerHeight(atoms: Atom[]) { return atoms.reduce((a, t) => a + t.h + t.before, 0); }
function drawInner(d: Doc, atoms: Atom[], x: number, top: number) { let y = top; for (const a of atoms) { y -= a.before; a.draw(d, x, y); y -= a.h; } }

const IBOV: [string, number][] = [["29/09", 183828], ["30/09", 186340], ["01/10", 187197], ["02/10", 192115], ["05/10", 206912], ["06/10", 205835], ["07/10", 204302], ["08/10", 206220], ["09/10", 209067], ["13/10", 206888], ["14/10", 206506], ["15/10", 204324], ["16/10", 205430], ["19/10", 205079], ["20/10", 208296], ["21/10", 206495], ["22/10", 204120], ["23/10", 205083], ["26/10", 176608], ["27/10", 175710]];

function atomsOf(b: Blk, w = CW): Atom[] {
  switch (b.t) {
    case "kicker": case "week":
      return [{ h: 12, before: b.t === "week" ? 14 : 0, keep: true, draw: (d, x, top) => d.text(String(b.s).toUpperCase(), x, top - 9, "Helvetica-Bold", 8, C.green, 1.2) }];
    case "h1": {
      const ls = wrap([[b.s, 0]], w, 23, "Times-Bold", "Times-Bold");
      return ls.map((l, i) => ({ h: 27, before: i ? 0 : 4, keep: true, draw: (d, x, top) => d.line(l, x, top - 21, 23, C.ink) }));
    }
    case "h2": {
      const ls = wrap([[b.s, 0]], w, 15, "Times-Bold", "Times-Bold");
      return ls.map((l, i) => ({ h: 19, before: i ? 0 : 16, keep: true, draw: (d, x, top) => d.line(l, x, top - 14, 15, C.ink) }));
    }
    case "h3": {
      const ls = wrap([[b.s, 0]], w, 11, "Helvetica-Bold", "Helvetica-Bold");
      return ls.map((l, i) => ({ h: 15, before: i ? 0 : 10, keep: true, draw: (d, x, top) => d.line(l, x, top - 11, 11, C.ink) }));
    }
    case "rule":
      return [{ h: 14, before: 4, draw: (d, x, top) => d.rect(x, top - 3, 40, 2.6, C.green) }];
    case "lead":
      return [...paraAtoms(b.r, 12, 17, C.ink2, 2, w), { h: 8, before: 0, draw: () => {} }];
    case "p":
      return b.small ? paraAtoms(b.r, 8.4, 12, C.muted, 6, w) : paraAtoms(b.r, 10.2, 15, C.ink, 7, w);
    case "quote": {
      const ls = wrap([[b.s, 0]], w - 16, 13, "Times-Bold", "Times-Bold");
      const h = ls.length * 18 + 6;
      return [{ h, before: 12, draw: (d, x, top) => { d.rect(x, top - h, 2.5, h, C.gold); ls.forEach((l, i) => d.line(l, x + 14, top - 16 - i * 18, 13, C.ink)); } }];
    }
    case "ul": {
      const size = b.small ? 8.4 : 10.2, lead = b.small ? 12 : 15, ind = b.kind === "check" ? 22 : 16;
      const out: Atom[] = [];
      (b.items as Run[][]).forEach((it, i) => {
        const ls = wrap(it, w - ind, size);
        ls.forEach((l, j) => out.push({
          h: lead, before: j ? 0 : (i ? (b.kind === "check" ? 5 : 3) : 6), keep: ls.length > 1 && j === ls.length - 2,
          draw: (d, x, top) => {
            const by = top - lead + (lead - size) / 2 + 2;
            if (j === 0) {
              if (b.kind === "num") d.text(`${i + 1}.`, x, by, "Helvetica-Bold", size, C.green);
              else if (b.kind === "check") d.add(`${col(C.ink, true)} 1 w ${n(x + 1)} ${n(by - 1.5)} 10 10 re S`);
              else d.text("•", x + 2, by, "Helvetica-Bold", size, C.green);
            }
            d.line(l, x + ind, by, size, b.small ? C.muted : C.ink);
          },
        }));
        if (b.kind === "check") out.push({ h: 4, before: 0, draw: (d, x, top) => d.hline(x, x + w, top - 2, C.line, 0.6, true) });
      });
      return out;
    }
    case "toc":
      return (b.items as { n: string; s: string }[]).map((it, i) => ({
        h: 24, before: i ? 0 : 10,
        draw: (d, x, top) => { d.text(it.n, x, top - 16, "Times-Bold", 12, C.green); d.text(it.s, x + 30, top - 16, "Helvetica", 10.2, C.ink); d.hline(x, x + w, top - 24, C.line); },
      }));
    case "table": return tableAtoms(b, w);
    case "box": {
      const fill = b.v === "green" ? C.greenSoft : b.v === "red" ? C.redSoft : C.sand;
      const bar = b.v === "green" ? C.green : b.v === "red" ? C.red : null;
      const pad = 12, inner = (b.c as Blk[]).flatMap((x) => atomsOf(x, w - pad * 2 - (bar ? 4 : 0)));
      if (inner.length) inner[0].before = 0;
      const h = innerHeight(inner) + pad * 2 - 2;
      return [{ h, before: 12, draw: (d, x, top) => {
        d.rrect(x, top - h, w, h, 8, fill);
        if (bar) d.rect(x, top - h, 3.2, h, bar);
        drawInner(d, inner, x + pad + (bar ? 4 : 0), top - pad + 2);
      } }];
    }
    case "stats": {
      const gap = 8, cw = (w - gap * 2) / 3;
      const items = (b.items as { b: string; s: string; v: string }[]).map((it) => ({ ...it, ls: wrap([[it.s, 0]], cw - 20, 8) }));
      const h = 34 + Math.max(...items.map((i) => i.ls.length)) * 10.5 + 12;
      return [{ h, before: 12, draw: (d, x, top) => items.forEach((it, i) => {
        const bx = x + i * (cw + gap);
        d.rrect(bx, top - h, cw, h, 8, C.sand);
        d.text(it.b, bx + 10, top - 27, "Times-Bold", 19, it.v === "green" ? C.green : it.v === "red" ? C.red : C.ink);
        it.ls.forEach((l, j) => d.line(l, bx + 10, top - 43 - j * 10.5, 8, C.ink2));
      }) }];
    }
    case "pillar": {
      const ls = wrap(b.r, w - 54, 9.8);
      const tl = wrap([[b.h, 0]], w - 54, 11, "Helvetica-Bold", "Helvetica-Bold");
      const h = Math.max(38, tl.length * 14 + ls.length * 13.5 + 6);
      return [{ h, before: 12, draw: (d, x, top) => {
        d.rrect(x, top - 36, 36, 36, 8, C.ink);
        const lw = width(b.L, "Times-Bold", 18);
        d.text(b.L, x + 18 - lw / 2, top - 24.5, "Times-Bold", 18, C.white);
        tl.forEach((l, i) => d.line(l, x + 50, top - 11 - i * 14, 11, C.ink));
        ls.forEach((l, i) => d.line(l, x + 50, top - 13 - tl.length * 14 - i * 13.5, 9.8, C.ink2));
      } }];
    }
    case "chart": {
      const h = 150;
      return [{ h: h + 8, before: 12, draw: (d, x, top) => {
        d.rrect(x, top - h, w, h, 8, C.paper, C.line);
        const L = x + 46, R = x + w - 14, T = top - 22, B = top - h + 24, lo = 170000, hi = 215000;
        const px = (i: number) => L + (R - L) * i / (IBOV.length - 1), py = (v: number) => B + (T - B) * (v - lo) / (hi - lo);
        for (const g of [180000, 190000, 200000, 210000]) { d.hline(L, R, py(g), C.line, 0.5); d.text(`${g / 1000} mil`, x + 10, py(g) - 3, "Helvetica", 7, C.muted); }
        d.add(`${col(C.ink, true)} 1.6 w 1 j ` + IBOV.map(([, v], i) => `${n(px(i))} ${n(py(v))} ${i ? "l" : "m"}`).join(" ") + " S");
        IBOV.forEach(([lab], i) => { if (["29/09", "05/10", "09/10", "19/10", "26/10"].includes(lab)) d.text(lab, px(i) - 10, B - 14, "Helvetica", 7, C.muted); });
        const dot = (i: number, c: RGB) => { const cx = px(i), cy = py(IBOV[i][1]), r = 3, k = r * 0.5523; d.add(`${col(c)} ${n(cx + r)} ${n(cy)} m ${n(cx + r)} ${n(cy + k)} ${n(cx + k)} ${n(cy + r)} ${n(cx)} ${n(cy + r)} c ${n(cx - k)} ${n(cy + r)} ${n(cx - r)} ${n(cy + k)} ${n(cx - r)} ${n(cy)} c ${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)} c ${n(cx + k)} ${n(cy - r)} ${n(cx + r)} ${n(cy - k)} ${n(cx + r)} ${n(cy)} c f`); };
        dot(8, C.green); dot(18, C.red); dot(19, C.red);
        d.text("Recorde: 209 mil", px(8) - 34, py(209067) + 8, "Helvetica-Bold", 7.5, C.green);
        d.text("26/10: -13,88%", px(18) - 66, py(176608) - 3, "Helvetica-Bold", 7.5, C.red);
      } }];
    }
    default: return [];
  }
}

function tableAtoms(b: Blk, w: number): Atom[] {
  const rows = b.rows as Run[][][], nc = Math.max(...rows.map((r) => r.length)), pad = 6, size = 9;
  const nat = Array(nc).fill(0);
  rows.forEach((r) => r.forEach((c, j) => { nat[j] = Math.max(nat[j], c.reduce((a, [t, bd]) => a + width(t, bd ? "Helvetica-Bold" : "Helvetica", size), 0) + pad * 2); }));
  const min = nat.map((v) => Math.min(v, 70));
  let cw = nat.slice();
  const tot = cw.reduce((a, v) => a + v, 0);
  if (tot > w) { // encolhe proporcionalmente as colunas largas
    const extra = tot - w, flex = cw.map((v, j) => v - min[j]), fsum = flex.reduce((a, v) => a + v, 0) || 1;
    cw = cw.map((v, j) => v - extra * flex[j] / fsum);
  } else cw = cw.map((v) => v + (w - tot) * v / tot);
  const num = new Set<number>(b.num ?? []);
  return rows.map((r, i) => {
    const head = i === 0, isTotal = b.total === i;
    const cells = r.map((c, j) => wrap(head || isTotal ? c.map(([t]) => [t, 1] as Run) : c, cw[j] - pad * 2, size));
    const h = Math.max(1, ...cells.map((ls) => ls.length)) * 12 + (b.fill && !head ? 14 : 9);
    return {
      h, before: head ? 10 : 0, keep: head,
      draw: (d: Doc, x: number, top: number) => {
        if (head) d.rrect(x, top - h, w, h, 5, C.ink);
        else if (isTotal) d.rect(x, top - h, w, h, C.sand);
        let cx = x;
        cells.forEach((ls, j) => {
          ls.forEach((l, k) => d.line(l, cx + pad, top - 12 - k * 12, size, head ? C.white : C.ink, num.has(j) ? "r" : "l", cw[j] - pad * 2));
          cx += cw[j];
        });
        if (!head) d.hline(x, x + w, top - h, C.line);
      },
    };
  });
}

function cover(d: Doc, kicker: string, titulo: string, sub: string, edicao: string) {
  d.newPage();
  d.rect(0, 0, PW, PH, C.ink);
  d.rect(PW - 112, PH - 420, 1.6, 420, C.gold);
  d.add(`${col(C.gold)} ${n(PW - 135)} ${n(PH - 420)} m ${n(PW - 88)} ${n(PH - 420)} l ${n(PW - 111.2)} ${n(PH - 482)} l h f`);
  d.add(`${col(C.gold)} ${n(ML)} ${n(PH - 70)} m ${n(ML + 10)} ${n(PH - 70)} l ${n(ML + 5)} ${n(PH - 82)} l h f`);
  d.text("PRUMO FINANÇAS", ML + 18, PH - 80, "Helvetica-Bold", 9, C.white, 1.6);
  const pts = [[0, 110], [40, 100], [70, 96], [100, 60], [140, 48], [170, 52], [200, 44], [230, 50], [260, 46], [290, 52]];
  const gx = (v: number) => ML + v * 1.2, gy = (v: number) => PH - 170 - v * 1.15;
  d.add(`${col(C.navy2, true)} 2.4 w 1 j ` + pts.map(([a, b], i) => `${n(gx(a))} ${n(gy(b))} ${i ? "l" : "m"}`).join(" ") + " S");
  d.add(`${col(C.red, true)} 3 w ${n(gx(290))} ${n(gy(52))} m ${n(gx(300))} ${n(gy(128))} l ${n(gx(330))} ${n(gy(130))} l S`);
  let y = 330;
  d.text(kicker.toUpperCase(), ML, y + 120, "Helvetica-Bold", 9, C.green2, 1.8);
  const tl = wrap([[titulo, 0]], CW - 40, 48, "Times-Bold", "Times-Bold");
  tl.forEach((l, i) => d.line(l, ML, y + 72 - i * 50, 48, C.white));
  y = y + 72 - (tl.length - 1) * 50 - 34;
  wrap([[sub, 0]], 400, 13).forEach((l, i) => d.line(l, ML, y - i * 18, 13, C.sub));
  d.hline(ML, PW - MR, 92, C.navy2, 0.8);
  d.text(edicao, ML, 72, "Helvetica", 8, C.gray);
  const m = d.marca, mw = width(m, "Helvetica", 8);
  d.text(m, PW - MR - mw, 72, "Helvetica", 8, C.gray);
}

export type Opcoes = { kicker: string; titulo: string; sub: string; edicao: string; comprador: string; email: string; pedido: string };

export async function gerarPDF(blocos: Blk[], o: Opcoes): Promise<Uint8Array> {
  const marca = `Licenciado para ${o.comprador} · ${o.email} · Pedido ${o.pedido}`;
  const d = new Doc(o.titulo, marca);
  cover(d, o.kicker, o.titulo, o.sub, o.edicao);

  // fluxo de átomos com quebra de página
  const groups: Atom[][] = [];
  let cur: Atom[] = [];
  for (const b of blocos) {
    if (b.t === "break") { groups.push(cur); cur = []; continue; }
    cur.push(...atomsOf(b));
  }
  groups.push(cur);
  for (const g of groups) {
    if (!g.length) continue;
    d.newPage();
    let first = true;
    for (let i = 0; i < g.length; i++) {
      const a = g[i];
      let need = a.h + (first ? 0 : a.before);
      if (a.keep) { // título não fica sozinho no fim da página
        let j = i + 1, extra = 0;
        while (j < g.length && g[j - 1].keep) { extra += g[j].h + g[j].before; j++; }
        need += Math.min(extra, 120);
      }
      if (!first && d.y - need < MB) { d.newPage(); first = true; }
      if (!first) d.y -= a.before;
      a.draw(d, ML, d.y);
      d.y -= a.h;
      first = false;
    }
  }

  // rodapés com marca d'água
  const total = d.pages.length;
  d.pages.forEach((pg, i) => {
    if (i === 0) return;
    d.p = pg;
    d.hline(ML, PW - MR, 52, C.line, 0.5);
    d.text(`${o.titulo} · Prumo Finanças`, ML, 38, "Helvetica", 7.5, C.muted);
    const pn = `${i + 1} / ${total}`;
    d.text(pn, PW - MR - width(pn, "Helvetica", 7.5), 38, "Helvetica", 7.5, C.muted);
    const mw = width(marca, "Helvetica", 6.8);
    d.text(marca, (PW - mw) / 2, 24, "Helvetica", 6.8, C.gray);
  });
  return await serializar(d, o, marca);
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const stream = new Blob([data]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function pdfStr(s: string) { return hexStr([0xfe, 0xff, ...[...s].flatMap((ch) => { const c = ch.charCodeAt(0); return [c >> 8, c & 255]; })]); }

async function serializar(d: Doc, o: Opcoes, marca: string): Promise<Uint8Array> {
  const te = new TextEncoder();
  const objs: (Uint8Array | string)[] = [];
  const add = (x: Uint8Array | string) => { objs.push(x); return objs.length; };
  const catalog = add(""), pages = add("");
  const fonts = (["Helvetica", "Helvetica-Bold", "Times-Bold"] as FontKey[]).map((f) => add(`<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`));
  const res = `<< /Font << /F1 ${fonts[0]} 0 R /F2 ${fonts[1]} 0 R /F3 ${fonts[2]} 0 R >> >>`;
  const kids: number[] = [];
  for (const pg of d.pages) {
    const raw = te.encode(pg.ops.join("\n"));
    const z = await deflate(raw);
    const head = te.encode(`<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n`), tail = te.encode("\nendstream");
    const buf = new Uint8Array(head.length + z.length + tail.length);
    buf.set(head); buf.set(z, head.length); buf.set(tail, head.length + z.length);
    const cid = add(buf);
    kids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources ${res} /Contents ${cid} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objs[pages - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;
  const info = add(`<< /Title ${pdfStr(o.titulo + " — Prumo Finanças")} /Author ${pdfStr("Prumo Finanças")} /Subject ${pdfStr(marca)} /Creator ${pdfStr("Prumo Finanças")} >>`);

  const parts: Uint8Array[] = [te.encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
  let off = parts[0].length;
  const xref: number[] = [];
  objs.forEach((ob, i) => {
    xref.push(off);
    const body = typeof ob === "string" ? te.encode(ob) : ob;
    const p = [te.encode(`${i + 1} 0 obj\n`), body, te.encode("\nendobj\n")];
    for (const x of p) { parts.push(x); off += x.length; }
  });
  const xs = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + xref.map((x) => String(x).padStart(10, "0") + " 00000 n \n").join("") +
    `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${off}\n%%EOF\n`;
  parts.push(te.encode(xs));
  const total = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(total);
  let k = 0; for (const p of parts) { out.set(p, k); k += p.length; }
  return out;
}
