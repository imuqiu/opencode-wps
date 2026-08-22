/**
 * WPS 桥接共享工具函数（单一来源）
 *
 * 由 `scripts/sync-wps-bridge.js` 同步到各平台目录的 `handlers/handler-utils.js`，
 * 供 excel/ppt/word 等 handler 使用，避免同一纯工具函数在 mac/linux 各维护一份。
 *
 * ⚠️ 本文件是单一来源，请勿手工修改平台目录下的 handler-utils.js（生成产物）——
 * 改动请修改本文件后重新运行：node scripts/sync-wps-bridge.js
 *
 * 平台差异说明：本文件仅收录两平台**逐字节相同**的纯函数（无平台差异、无行为耦合），
 * 确保抽取后 mac/linux 行为完全等价。
 */


function getExcelSheet(wb, sheet) {
  if (!sheet) return wb.ActiveSheet;
  return wb.Sheets.Item(sheet);
}

function colToLetter(n) {
  n = parseInt(n, 10);
  if (isNaN(n) || n < 1) return null;
  var letters = '';
  while (n > 0) {
    var rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function resolveColumnLetter(col) {
  if (typeof col === 'number') return colToLetter(col);
  if (typeof col === 'string') {
    var t = col.trim().toUpperCase();
    if (/^[A-Z]{1,3}$/.test(t)) return t;
  }
  return null;
}

function colToNumber(col) {
  if (typeof col === 'number') return col >= 1 ? col : null;
  if (typeof col === 'string') {
    var t = col.trim().toUpperCase();
    if (!/^[A-Z]{1,3}$/.test(t)) return null;
    var n = 0;
    for (var i = 0; i < t.length; i++) {
      n = n * 26 + (t.charCodeAt(i) - 64);
    }
    return n;
  }
  return null;
}

function resolveRowCol(row, col) {
  var r = parseInt(row, 10);
  if (isNaN(r) || r < 1) return null;
  var c = parseInt(col, 10);
  if (isNaN(c) || c < 1) return null;
  return { row: r, col: c };
}

function resolveAlignment(value, map) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && map[value.toLowerCase()] !== undefined) {
    return map[value.toLowerCase()];
  }
  return null;
}

function toExcelColor(color) {
  if (typeof color === 'number') return color;
  if (typeof color !== 'string') return null;
  var hex = color.trim();
  if (hex.charAt(0) === '#') hex = hex.substring(1);
  if (hex.length === 3) {
    hex =
      hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  var rgb = parseInt(hex, 16);
  return ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff);
}

function findNotesShape(notesPage) {
  try {
    for (var j = 1; j <= notesPage.Shapes.Count; j++) {
      var s = notesPage.Shapes.Item(j);
      try {
        var pf = s.PlaceholderFormat;
        if (pf && (pf.Type === 2 || pf.Type === 7)) return s;
      } catch (e) {}
    }
    // 兜底：第一个 HasTextFrame 且 HasText 的形状
    for (var j = 1; j <= notesPage.Shapes.Count; j++) {
      var s = notesPage.Shapes.Item(j);
      try {
        if (s.HasTextFrame && s.TextFrame.HasText) return s;
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}

function findShape(slide, nameOrIndex) {
  if (typeof nameOrIndex === 'number') {
    try {
      return slide.Shapes.Item(nameOrIndex);
    } catch (e) {
      return null;
    }
  }
  if (nameOrIndex == null) return slide.Shapes.Count > 0 ? slide.Shapes.Item(1) : null;
  for (var j = 1; j <= slide.Shapes.Count; j++) {
    if (slide.Shapes.Item(j).Name === nameOrIndex) return slide.Shapes.Item(j);
  }
  return null;
}

function getPPT() {
  return Application.ActivePresentation;
}

function resolveSlideIndex(pres, idx) {
  var n = parseInt(idx, 10);
  if (isNaN(n) || n < 1) return null;
  if (n > pres.Slides.Count) return null;
  return n;
}

function toRgb(color) {
  if (typeof color === 'number') return color;
  if (typeof color !== 'string') return null;
  var hex = color.trim();
  if (hex.charAt(0) === '#') hex = hex.substring(1);
  if (hex.length === 3) {
    hex =
      hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return parseInt(hex, 16);
}

function getSelectionRange() {
  try {
    if (!Application.Selection) return null;
    return Application.Selection.Range;
  } catch (e) {
    return null;
  }
}

function toBgr(rgb) {
  return ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff);
}
