/* 数独の生成・求解ロジック（UIから独立） */
(function (root) {
  'use strict';

  // 各セルが属する行・列・ブロックのインデックス表（事前計算）
  var ROW = new Uint8Array(81);
  var COL = new Uint8Array(81);
  var BOX = new Uint8Array(81);
  for (var i = 0; i < 81; i++) {
    ROW[i] = (i / 9) | 0;
    COL[i] = i % 9;
    BOX[i] = (((i / 9) | 0) / 3 | 0) * 3 + ((i % 9) / 3 | 0);
  }

  var BITCOUNT = new Uint8Array(512);
  for (var b = 0; b < 512; b++) {
    var c = 0, x = b;
    while (x) { c += x & 1; x >>= 1; }
    BITCOUNT[b] = c;
  }

  // 行・列・ブロックの27ユニット
  var UNITS = [];
  for (var u = 0; u < 9; u++) {
    var ur = [], uc = [], ub = [];
    for (var k = 0; k < 81; k++) {
      if (ROW[k] === u) ur.push(k);
      if (COL[k] === u) uc.push(k);
      if (BOX[k] === u) ub.push(k);
    }
    UNITS.push(ur, uc, ub);
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0;
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /**
   * 解の個数を数える（limit 個見つかった時点で打ち切る）。
   * MRV（候補が最も少ないマスから埋める）で高速化。
   */
  function countSolutions(grid, limit) {
    limit = limit || 2;
    var rows = new Int32Array(9), cols = new Int32Array(9), boxes = new Int32Array(9);
    var i, bit;
    for (i = 0; i < 81; i++) {
      var v = grid[i];
      if (v) {
        bit = 1 << (v - 1);
        if ((rows[ROW[i]] & bit) || (cols[COL[i]] & bit) || (boxes[BOX[i]] & bit)) return 0; // 矛盾
        rows[ROW[i]] |= bit; cols[COL[i]] |= bit; boxes[BOX[i]] |= bit;
      }
    }
    var work = Int32Array.from(grid);
    var found = 0;

    function rec() {
      var best = -1, bestMask = 0, bestCount = 10;
      for (var k = 0; k < 81; k++) {
        if (work[k]) continue;
        var mask = 511 & ~(rows[ROW[k]] | cols[COL[k]] | boxes[BOX[k]]);
        var n = BITCOUNT[mask];
        if (n === 0) return;            // 行き止まり
        if (n < bestCount) { bestCount = n; best = k; bestMask = mask; if (n === 1) break; }
      }
      if (best === -1) { found++; return; } // 全マス埋まった

      var r = ROW[best], c = COL[best], bx = BOX[best];
      for (var d = 0; d < 9; d++) {
        var bt = 1 << d;
        if (!(bestMask & bt)) continue;
        work[best] = d + 1;
        rows[r] |= bt; cols[c] |= bt; boxes[bx] |= bt;
        rec();
        rows[r] &= ~bt; cols[c] &= ~bt; boxes[bx] &= ~bt;
        work[best] = 0;
        if (found >= limit) return;
      }
    }
    rec();
    return found;
  }

  /** 完成盤（解）をランダムに1つ作る */
  function makeSolution() {
    var grid = new Uint8Array(81);
    var rows = new Int32Array(9), cols = new Int32Array(9), boxes = new Int32Array(9);
    var order = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    function fill(pos) {
      if (pos === 81) return true;
      var mask = 511 & ~(rows[ROW[pos]] | cols[COL[pos]] | boxes[BOX[pos]]);
      if (!mask) return false;
      shuffle(order);
      for (var k = 0; k < 9; k++) {
        var d = order[k], bt = 1 << (d - 1);
        if (!(mask & bt)) continue;
        grid[pos] = d;
        rows[ROW[pos]] |= bt; cols[COL[pos]] |= bt; boxes[BOX[pos]] |= bt;
        if (fill(pos + 1)) return true;
        rows[ROW[pos]] &= ~bt; cols[COL[pos]] &= ~bt; boxes[BOX[pos]] &= ~bt;
        grid[pos] = 0;
      }
      return false;
    }
    fill(0);
    return grid;
  }

  // 難易度ごとの「残すヒント数」と、基本手筋だけで解けるべきか
  //   basics: true  … 「唯一候補」「唯一配置」だけで最後まで解ける（=素直な問題）
  //   basics: false … それだけでは解けない（=少し考える必要がある）
  var LEVELS = {
    easy:   { clues: 45, basics: true },
    normal: { clues: 32, basics: true },
    hard:   { clues: 28, basics: false }
  };

  /**
   * 基本手筋（naked single / hidden single）だけで解けるかを判定する。
   * 人間が「素直に」解けるかの目安。
   */
  function solvableByBasics(grid) {
    var work = Int32Array.from(grid);
    var rows = new Int32Array(9), cols = new Int32Array(9), boxes = new Int32Array(9);
    var i, bit;
    for (i = 0; i < 81; i++) {
      if (work[i]) {
        bit = 1 << (work[i] - 1);
        rows[ROW[i]] |= bit; cols[COL[i]] |= bit; boxes[BOX[i]] |= bit;
      }
    }
    var empty = 0;
    for (i = 0; i < 81; i++) if (!work[i]) empty++;

    function place(idx, d) {
      var bt = 1 << (d - 1);
      work[idx] = d;
      rows[ROW[idx]] |= bt; cols[COL[idx]] |= bt; boxes[BOX[idx]] |= bt;
      empty--;
    }
    function cand(idx) { return 511 & ~(rows[ROW[idx]] | cols[COL[idx]] | boxes[BOX[idx]]); }

    var progress = true;
    while (empty > 0 && progress) {
      progress = false;
      // 唯一候補：そのマスに入る数字が1つしかない
      for (i = 0; i < 81; i++) {
        if (work[i]) continue;
        var m = cand(i);
        if (m === 0) return false;
        if (BITCOUNT[m] === 1) { place(i, 31 - Math.clz32(m) + 1); progress = true; }
      }
      if (progress) continue;
      // 唯一配置：ある数字がその行/列/ブロックで1マスにしか入らない
      var units = UNITS, u, k;
      for (u = 0; u < units.length && !progress; u++) {
        for (var d = 1; d <= 9 && !progress; d++) {
          var bt2 = 1 << (d - 1), spot = -1, n = 0, filled = false;
          for (k = 0; k < 9; k++) {
            var idx = units[u][k];
            if (work[idx] === d) { filled = true; break; }
            if (!work[idx] && (cand(idx) & bt2)) { spot = idx; n++; }
          }
          if (filled || n !== 1) continue;
          place(spot, d); progress = true;
        }
      }
    }
    return empty === 0;
  }

  /**
   * 問題を作る。必ず「解が1つだけ」になることを保証する。
   * @returns {{puzzle:Uint8Array, solution:Uint8Array, clues:number, level:string}}
   */
  function buildPuzzle(level) {
    var conf = LEVELS[level] || LEVELS.normal;
    var solution = makeSolution();
    var puzzle = Uint8Array.from(solution);
    var clues = 81;

    // 点対称に消していく（見た目が数独らしくなる）
    var pairs = [];
    for (var i = 0; i < 41; i++) pairs.push(i);
    shuffle(pairs);

    for (var p = 0; p < pairs.length && clues > conf.clues; p++) {
      var a = pairs[p], bIdx = 80 - a;
      var va = puzzle[a], vb = puzzle[bIdx];
      if (!va && !vb) continue;
      puzzle[a] = 0; puzzle[bIdx] = 0;
      var removed = (va ? 1 : 0) + (bIdx !== a && vb ? 1 : 0);
      if (countSolutions(puzzle, 2) !== 1) {
        puzzle[a] = va; puzzle[bIdx] = vb; // 戻す
      } else {
        clues -= removed;
      }
    }

    // 目標に届かない場合は非対称でさらに削る
    if (clues > conf.clues) {
      var cells = [];
      for (var j = 0; j < 81; j++) if (puzzle[j]) cells.push(j);
      shuffle(cells);
      for (var q = 0; q < cells.length && clues > conf.clues; q++) {
        var idx = cells[q], v = puzzle[idx];
        puzzle[idx] = 0;
        if (countSolutions(puzzle, 2) !== 1) puzzle[idx] = v; else clues--;
      }
    }

    return { puzzle: puzzle, solution: solution, clues: clues, level: level };
  }

  /**
   * 難易度の体感が label と合うまで作り直す（合わなければ最後の1つを返す）。
   */
  function generate(level) {
    var conf = LEVELS[level] || LEVELS.normal;
    var result = null;
    for (var attempt = 0; attempt < 40; attempt++) {
      result = buildPuzzle(level);
      if (conf.basics === null) return result;
      if (solvableByBasics(result.puzzle) === conf.basics) return result;
    }
    return result;
  }

  /** 同じ行・列・ブロックに重複がある値のセル番号を返す */
  function findConflicts(values) {
    var bad = [];
    for (var i = 0; i < 81; i++) {
      var v = values[i];
      if (!v) continue;
      for (var j = 0; j < 81; j++) {
        if (i === j || values[j] !== v) continue;
        if (ROW[i] === ROW[j] || COL[i] === COL[j] || BOX[i] === BOX[j]) { bad.push(i); break; }
      }
    }
    return bad;
  }

  function peers(index) {
    var out = [];
    for (var j = 0; j < 81; j++) {
      if (j === index) continue;
      if (ROW[index] === ROW[j] || COL[index] === COL[j] || BOX[index] === BOX[j]) out.push(j);
    }
    return out;
  }

  root.Sudoku = {
    generate: generate,
    solvableByBasics: solvableByBasics,
    countSolutions: countSolutions,
    makeSolution: makeSolution,
    findConflicts: findConflicts,
    peers: peers,
    ROW: ROW, COL: COL, BOX: BOX,
    LEVELS: LEVELS
  };
})(typeof module !== 'undefined' && module.exports ? module.exports : window);
