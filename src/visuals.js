// Local vector artwork keeps the dog and food consistent on mobile and offline.
export const DOG_SVG = `<svg class="dog-art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true">
<ellipse cx="49" cy="89" rx="32" ry="5" fill="#617a5126"/>
<path class="dog-tail" d="M25 64Q4 48 17 30" fill="none" stroke="#a56836" stroke-width="10" stroke-linecap="round"/>
<ellipse cx="47" cy="65" rx="29" ry="20" fill="#db9c50" stroke="#854d2b" stroke-width="2.5"/>
<path d="M51 49Q70 49 72 70Q68 84 54 81Q43 72 51 49" fill="#fff2d5"/>
<path class="dog-leg-back" d="M28 70V84Q30 90 39 86V73" fill="#d79443" stroke="#854d2b" stroke-width="2.5" stroke-linejoin="round"/>
<path class="dog-leg-front" d="M59 69V85Q63 91 71 86V68" fill="#fff2d5" stroke="#854d2b" stroke-width="2.5" stroke-linejoin="round"/>
<path d="M42 52Q59 64 77 53" fill="none" stroke="#187569" stroke-width="7" stroke-linecap="round"/>
<circle cx="63" cy="61" r="5" fill="#f4d46b" stroke="#a57b31" stroke-width="1.5"/>
<path d="M39 26Q26 2 22 18Q18 34 34 43M71 23Q84 3 89 20Q93 35 79 42" fill="#a56836" stroke="#854d2b" stroke-width="2.5" stroke-linejoin="round"/>
<path d="M36 28Q33 10 27 19L30 32M78 27Q83 13 85 21L83 32" fill="#e8b382"/>
<path d="M33 27Q38 12 59 14Q81 16 82 36Q86 56 65 60Q41 62 32 48Q27 36 33 27" fill="#e0a35a" stroke="#854d2b" stroke-width="2.5"/>
<path d="M54 15Q49 30 55 39L65 40Q68 29 61 15" fill="#fff2d5"/>
<ellipse cx="60" cy="47" rx="18" ry="12" fill="#fff2d5"/>
<ellipse class="dog-eye" cx="45" cy="35" rx="3.5" ry="4.5" fill="#382e27"/><ellipse class="dog-eye" cx="72" cy="35" rx="3.5" ry="4.5" fill="#382e27"/>
<circle cx="46" cy="34" r="1" fill="white"/><circle cx="73" cy="34" r="1" fill="white"/>
<path d="M54 42Q60 38 66 42Q65 48 60 49Q55 47 54 42" fill="#382e27"/>
<path d="M52 51Q60 59 69 51" fill="none" stroke="#854d2b" stroke-width="2.5" stroke-linecap="round"/>
<path d="M58 55Q60 68 65 57" fill="#e58a88" stroke="#b56563" stroke-width="1.5"/>
</svg>`;
export const MEAT_SVG = `<svg class="meat-art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true">
<ellipse cx="51" cy="83" rx="34" ry="5" fill="#8c65341c"/>
<g transform="rotate(-35 50 50)"><path d="M68 43H84Q87 32 93 37Q101 42 94 49Q101 57 93 62Q86 67 83 56H68" fill="#fff9e8" stroke="#ac906b" stroke-width="3" stroke-linejoin="round"/>
<path d="M66 27Q83 39 71 65Q59 85 32 76Q9 68 13 45Q18 19 43 21Q56 19 66 27" fill="#b9683e" stroke="#874524" stroke-width="3"/>
<path d="M60 29Q73 35 70 50Q65 69 48 71Q25 72 22 55Q19 37 36 29Q47 24 60 29" fill="#db955b"/>
<path d="M29 38Q38 26 48 30M26 48L35 39M49 58L61 45" fill="none" stroke="#f2bf80" stroke-width="6" stroke-linecap="round"/>
</g></svg>`;

// Rectangles share the same viewport coordinate system, including zoom/scroll.
export function centerFromRects(cell, surface) {
  return { x: cell.left - surface.left + cell.width / 2, y: cell.top - surface.top + cell.height / 2, size: Math.min(cell.width, cell.height) * .84 };
}
export function interpolatePoint(a, b, fraction) {
  const t = Math.max(0, Math.min(1, fraction));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
