// Unbewegte Readex-Pro-Konturen (SIL OFL, wght 320, −18 Einheiten Laufweite).
export const WORTMARKE_SICHTFELD = '0 -1000 1602 1250';

const pAussen = 'M71 223V-525H153L154 -390L139 -395Q147 -432 177 -463Q206 -494 248 -514Q290 -533 336 -533Q408 -533 463 -498Q519 -463 551 -402Q583 -341 583 -263Q583 -185 551 -123Q519 -62 464 -26Q408 9 339 9Q291 9 247 -11Q202 -30 171 -63Q141 -95 133 -131L154 -140V223Z';
const pInnen = 'M326 -66Q378 -66 419 -92Q459 -117 482 -162Q505 -206 505 -263Q505 -319 482 -363Q459 -407 419 -432Q379 -458 326 -458Q275 -458 236 -433Q196 -408 173 -363Q150 -319 150 -262Q150 -206 173 -161Q196 -117 236 -92Q275 -66 326 -66Z';

export const WORTMARKE_GRUND = [
  pAussen + pInnen,
  'M694 0V-525H775V0ZM733 -647Q705 -647 690 -662Q675 -676 675 -702Q675 -727 691 -742Q706 -757 733 -757Q761 -757 776 -743Q791 -728 791 -702Q791 -678 776 -662Q761 -647 733 -647Z',
  'M1268 0 1089 -230 1077 -246 860 -525H963L1136 -300L1150 -282L1368 0ZM858 0 1068 -271 1116 -213 955 0ZM1154 -256 1110 -314 1254 -525H1352Z',
  'M1452 0V-525H1533V0ZM1492 -647Q1464 -647 1449 -662Q1434 -676 1434 -702Q1434 -727 1449 -742Q1465 -757 1492 -757Q1519 -757 1535 -743Q1550 -728 1550 -702Q1550 -678 1535 -662Q1519 -647 1492 -647Z',
] as const;

// Die Tinte überlappt nur den Rand der festen Schrift. Im p zieht sie die Öffnung
// zu einer abgerundeten Tasche zusammen, während der Außenrand stehen bleibt.
function pOeffnung(links: number, oben: number, rechts: number, unten: number) {
  const sx = (rechts - links) / (505 - 150);
  const sy = (unten - oben) / (-66 + 458);
  return pInnen.replace(/(-?\d+) (-?\d+)/g, (_, x, y) =>
    `${Math.round(links + (Number(x) - 150) * sx)} ${Math.round(oben + (Number(y) + 458) * sy)}`);
}

const pRand = pOeffnung(136, -474, 516, -50);
const pTinte = (links: number, oben: number, rechts: number, unten: number) =>
  pRand + pOeffnung(136 + links, -474 + oben, 516 - rechts, -50 - unten);

// Zwei tangentiale Kurven je Seite schließen an der Mittelachse des i.
// Die Kuppe wandert entlang des Stamms, der i-Punkt liegt darüber frei.
function iTinte(x: number, oben: number, mitte: number, unten: number, links: number, rechts: number) {
  const haupt = Math.round((mitte - oben) * 0.5);
  const fuss = Math.round((unten - mitte) * 0.5);
  return `M${x} ${oben}C${x} ${oben + haupt} ${x + rechts} ${mitte - haupt} ${x + rechts} ${mitte}`
    + `C${x + rechts} ${mitte + fuss} ${x} ${unten - fuss} ${x} ${unten}`
    + `C${x} ${unten - fuss} ${x - links} ${mitte + fuss} ${x - links} ${mitte}`
    + `C${x - links} ${mitte - haupt} ${x} ${oben + haupt} ${x} ${oben}Z`;
}

// Die festen Diagonalen des x sind die beiden Ufer jeder Rundung. Die
// Bézier-Kurve berührt beide Flanken, wenn sich Tinte im Winkel sammelt.
const X_WINKEL = [
  [[1064, -264], [858, -525], [856, 0], [16, 0]], // links
  [[1117, -323], [962, -525], [1255, -525], [0, 16]], // oben
  [[1161, -266], [1370, 0], [1354, -525], [-16, 0]], // rechts
  [[1109, -206], [1269, 0], [954, 0], [0, -16]], // unten
] as const;

function xTinte(links: number, oben: number, rechts: number, unten: number) {
  return [links, oben, rechts, unten].map((tiefe, i) => {
    const [ecke, a, b, [dx, dy]] = X_WINKEL[i];
    // Die Flächen überlappen unter den Diagonalen, damit auch in der kleinen
    // Wortmarke keine helle Naht zwischen Tinte und Grundschrift entsteht.
    const punkt = ([x, y]: readonly [number, number], t: number) =>
      `${Math.round(ecke[0] + (x - ecke[0]) * t) + dx} ${Math.round(ecke[1] + (y - ecke[1]) * t) + dy}`;
    const flanke = 'M' + punkt(ecke, 0) + 'L' + punkt(a, tiefe);
    const kurve = 'C' + [punkt(a, tiefe * 0.27), punkt(b, tiefe * 0.27), punkt(b, tiefe)].join(' ');
    return flanke + kurve + 'Z';
  }).join('');
}

const pTrocken = pTinte(0, 0, 0, 0);
const iTrocken = (x: number) => iTinte(x, -310, -310, -310, 0, 0);
const xTrocken = xTinte(0, 0, 0, 0);

// Die Kuppen bleiben kräftig genug für die Kopfleiste und lösen sich wieder
// vollständig auf. Ruhende Konturen und die zusätzliche Fläche sind getrennt.
export const WORTMARKE_TINTE = [
  [
    pTrocken,
    pTinte(151, 25, 16, 54),
    pTinte(62, 155, 41, 14),
    pTinte(18, 46, 157, 29),
    pTrocken,
  ],
  [
    iTrocken(734),
    iTinte(734, -514, -374, -118, 117, 16),
    iTinte(734, -488, -245, -69, 78, 82),
    iTinte(734, -408, -168, -14, 14, 119),
    iTrocken(734),
  ],
  [
    xTrocken,
    xTinte(0.84, 0.19, 0, 0.31),
    xTinte(0.32, 0.83, 0.32, 0.18),
    xTinte(0, 0.18, 0.84, 0.53),
    xTrocken,
  ],
  [
    iTrocken(1492),
    iTinte(1492, -511, -358, -125, 124, 17),
    iTinte(1492, -488, -270, -70, 80, 85),
    iTinte(1492, -433, -199, -15, 14, 122),
    iTrocken(1492),
  ],
] as const;
