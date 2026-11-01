// 公式スケジュールPDF（演技日程）から、日ごとの演目リストを作る。
//
//   node tools/extract-schedule.mjs data/schedule2026_1014.pdf > /tmp/days.json
//
// 出力: [{ id: "10-31", shows: [{ s: 会場番号, t: "11:00", e: "11:30", a: "17" }] }, ...]
// 会場番号は data.js の stages[].id と同じ（PDFの列番号）。
//
// 前提にしているPDFの構造（2026年版で確認）:
//   - 1ページ = 1日。左から31列が会場、上から下へ10:30〜20:30の15分刻み。
//   - 各セルは原則30分。セルの中に「出演者番号(2桁) + 名前」が縦積みで入る。
//   - 列6（芝生広場）は演目なしのブース、列8（プレミアムステージ）は別ページの情報を使う。
//   - 時刻の目盛りは左端のラベル（10:30 など）から作る。ページごとにズレないことは2026年版で確認済み。
// レイアウトが変わったら COL_BOUNDS と CALIB を直す。

import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// 列の境界（x座標）。31列ぶんの区切り。
const COL_BOUNDS = [51.7, 87.9, 124.1, 160.4, 196.6, 232.8, 269.1, 305.3, 341.6, 377.8, 414.1, 450.3,
  486.6, 522.8, 559.1, 595.3, 629.3, 663.3, 697.2, 731.2, 765.2, 799.2, 833.2, 867.2, 901.1,
  935.1, 969.1, 1003.1, 1037.1, 1071.0, 1105.0, 1139.0];

// 時刻の目盛り: 10:30 の位置と、15分あたりのピクセル数。
const CALIB = { y1030: 679.9, pxPer15: 17.2 };
// セル内の文字ブロックの中心から、セル上端までの距離。行数によらず一定。
const CENTER_TO_TOP = 4.5 + CALIB.pxPer15;
// 同じセルの行とみなす縦の間隔。
const LINE_GAP = 14;
const SKIP_COLUMNS = [6, 8];

const DAY_IDS = ['10-31', '11-01', '11-02', '11-03'];
const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/extract-schedule.mjs <schedule.pdf>');
  process.exit(1);
}

const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true }).promise;
const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const colOf = (x) => {
  for (let i = 0; i < COL_BOUNDS.length - 1; i++) if (x >= COL_BOUNDS[i] && x < COL_BOUNDS[i + 1]) return i + 1;
  return x < COL_BOUNDS[0] ? 1 : 31;
};

const out = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const items = (await page.getTextContent()).items
    .filter((it) => it.str && it.str.trim())
    .map((it) => {
      const [, , , , e, f] = it.transform;
      return { s: it.str, x: e, y: f };
    });
  // ページの時刻ラベルを読んで、目盛りが想定どおりか確かめる
  const labels = [];
  const rows = new Map();
  for (const it of items.filter((i) => i.x < 52 && i.y > 25 && i.y < 700)) {
    const k = Math.round(it.y / 3);
    (rows.get(k) || rows.set(k, []).get(k)).push(it);
  }
  for (const [, g] of rows) {
    g.sort((a, b) => a.x - b.x);
    const m = g.map((i) => i.s).join('').match(/^(\d{1,2}):(\d{2})$/);
    if (m) labels.push([Math.max(...g.map((i) => i.y)), (+m[1]) * 60 + (+m[2])]);
  }
  const at10 = labels.find((l) => l[1] === 630);
  if (!at10) throw new Error(`page ${p}: 10:30 のラベルが見つからない（レイアウトが変わった可能性）`);
  const drift = Math.abs(at10[0] - (CALIB.y1030 - 6));
  if (drift > 4) throw new Error(`page ${p}: 時刻の目盛りが想定と${drift.toFixed(1)}pxずれている。CALIB を直す`);

  const body = items.filter((it) => it.y > 22 && it.y < 700 && it.x > 50);
  const cols = new Map();
  for (const it of body) {
    const c = colOf(it.x);
    if (!cols.has(c)) cols.set(c, []);
    cols.get(c).push(it);
  }
  const shows = [];
  const unknown = new Set();
  for (const [c, list] of cols) {
    if (SKIP_COLUMNS.includes(c)) continue;
    list.sort((a, b) => b.y - a.y || a.x - b.x);
    let cur = null;
    const groups = [];
    for (const it of list) {
      // 出演者番号は2桁（01〜）。"00" は時刻の断片なので拾わない。
      if (/^\d{2}$/.test(it.s) && it.s !== '00') {
        if (cur) groups.push(cur);
        cur = { num: it.s, items: [it] };
      } else if (cur) {
        const last = cur.items[cur.items.length - 1];
        if (last.y - it.y <= LINE_GAP) cur.items.push(it);
      }
    }
    if (cur) groups.push(cur);
    for (const g of groups) {
      const ys = g.items.map((i) => i.y);
      const center = (Math.max(...ys) + Math.min(...ys)) / 2;
      const start = 630 + 15 * Math.round((CALIB.y1030 - (center + CENTER_TO_TOP)) / CALIB.pxPer15);
      if (start < 600 || start > 1230) { unknown.add('時刻が範囲外: ' + g.num); continue; }
      shows.push({ s: c, t: fmt(start), e: fmt(start + 30), a: g.num });
    }
  }
  shows.sort((a, b) => a.s - b.s || (a.t < b.t ? -1 : 1));

  // 検証: 同じ会場で30分未満の間隔は要確認。WS系の列は1セルに2名ぶんの番号が
  // 並ぶことがあり、その場合は人が見て直す必要がある（自動では決められない）。
  const byCol = {};
  for (const s of shows) (byCol[s.s] = byCol[s.s] || []).push(s);
  const toM = (v) => (+v.split(':')[0]) * 60 + (+v.split(':')[1]);
  for (const [c, arr] of Object.entries(byCol)) {
    for (let i = 1; i < arr.length; i++) {
      const gap = toM(arr[i].t) - toM(arr[i - 1].t);
      if (gap < 30) {
        console.error(`  !! page ${p} 列${c}: ${arr[i - 1].t}(${arr[i - 1].a}) と ${arr[i].t}(${arr[i].a}) が${gap}分差。PDFを見て直す`);
      }
    }
  }
  if (unknown.size) console.error(`page ${p}: 読み飛ばした行 → ${[...unknown].join(' / ')}`);
  console.error(`page ${p}: ${shows.length} 演目`);
  out.push({ id: DAY_IDS[p - 1] || String(p), shows });
}
process.stdout.write(JSON.stringify(out, null, 1));
