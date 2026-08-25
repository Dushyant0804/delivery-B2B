// src/utils/bagLayoutMap.js
//
// Physical layout of the sorter's discharge bags, for the visual grid
// in BagsLayout.jsx. TOP sits above the carriage; BOTTOM sits below it,
// split left/right around the lifter's ID1/ID2 output slots.
//
// Column-major numbering: D001–D003 are column 1 (top to bottom),
// D004–D006 are column 2, etc.

function columnMajor(start, cols, rows) {
  const grid = Array.from({ length: rows }, () => []);
  let n = start;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      grid[r][c] = `D${String(n).padStart(3, "0")}`;
      n++;
    }
  }
  return grid;
}

export const BAG_LAYOUT = {
  // 7 columns x 3 rows = D001–D021
  top: columnMajor(1, 7, 3),

  // 2 columns x 3 rows = D022–D027 (left of the lifter)
  bottomLeft: columnMajor(22, 2, 3),

  // 2 columns x 3 rows = D028–D033 (right of the lifter)
  bottomRight: columnMajor(28, 2, 3),
};