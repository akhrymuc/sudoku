/* すうどく — 画面まわり */
(function () {
  'use strict';

  var APP_VERSION = 'v21';   // 画面下に出す版。sw.js の CACHE と揃っている必要がある

  var SAVE_KEY = 'sudoku.save.v2';
  var SET_KEY = 'sudoku.settings.v1';
  var STATS_KEY = 'sudoku.stats.v1';
  var LEVELS = ['easy', 'normal', 'hard'];
  var LEVEL_NAME = { easy: 'やさしい', normal: 'ふつう', hard: '難しい' };

  var $ = function (id) { return document.getElementById(id); };

  var state = null;      // { level, given[], solution[], values[], notes[], selected, elapsed, tickStart }
  var undoStack = [];
  var noteMode = false;
  var revealMistakes = false;
  var settings = { instant: false };
  var stats = null;
  var timerId = null;

  var cells = [];        // DOM要素
  var keys = [];

  /* ---------- 時間の書式 ---------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function clockText(sec) {          // ゲーム中の表示 12:05
    sec = Math.max(0, Math.round(sec));
    return Math.floor(sec / 60) + ':' + pad2(sec % 60);
  }

  function durationText(sec) {       // 記録の表示 12分5秒
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    if (h) return h + '時間' + m + '分';
    return m + '分' + (sec % 60) + '秒';
  }

  /* ---------- 記録（クリア回数・日付・タイム） ---------- */
  function blankStats() {
    // prev … 最速を更新したときの「更新前の記録」。縮めた差を出すために残す
    return { counts: {}, best: {}, prev: {}, total: {}, days: {} };
  }

  function loadStats() {
    stats = blankStats();
    try {
      var s = JSON.parse(localStorage.getItem(STATS_KEY) || 'null');
      if (s && typeof s === 'object') {
        stats.counts = s.counts || {};
        stats.best = s.best || {};
        stats.prev = s.prev || {};
        stats.total = s.total || {};
        stats.days = s.days || {};
      }
    } catch (e) { /* 壊れていたら空の記録から始める */ }
  }

  function saveStats() {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) {}
  }

  function dayKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /**
   * クリアを記録する。
   * @returns {{isBest:boolean, prevBest:number, count:number}}
   *   isBest   … これまでで一番速かったか
   *   prevBest … 更新前の記録（初めての記録なら 0）
   */
  function recordClear(level, seconds) {
    // 「記録が無い」と「記録が0」を区別する（0 を falsy として扱わない）
    var hasBest = typeof stats.best[level] === 'number' && isFinite(stats.best[level]);
    var prevBest = hasBest ? stats.best[level] : 0;
    var isBest = !hasBest || seconds < prevBest;

    stats.counts[level] = (stats.counts[level] || 0) + 1;
    stats.total[level] = (stats.total[level] || 0) + seconds;
    if (isBest) {
      stats.prev[level] = prevBest;   // 縮めた差を出すために残す
      stats.best[level] = seconds;
    }

    var k = dayKey(new Date());
    stats.days[k] = (stats.days[k] || 0) + 1;

    // 古い日付は捨てる（2年分だけ残す）
    var ks = Object.keys(stats.days).sort();
    while (ks.length > 730) delete stats.days[ks.shift()];

    saveStats();
    return { isBest: isBest, prevBest: prevBest, count: stats.counts[level] };
  }

  function totalClears() {
    return LEVELS.reduce(function (a, l) { return a + (stats.counts[l] || 0); }, 0);
  }

  /** 今月・今週（月曜始まり）・連続日数 */
  function summary() {
    var now = new Date();
    var monthPrefix = now.getFullYear() + '-' + pad2(now.getMonth() + 1);
    var month = 0, week = 0;

    var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

    for (var k in stats.days) {
      var n = stats.days[k];
      if (k.indexOf(monthPrefix) === 0) month += n;
      if (k >= dayKey(monday)) week += n;
    }

    // 連続日数（今日が未プレイなら昨日から数える）
    var streak = 0;
    var cur = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!stats.days[dayKey(cur)]) cur.setDate(cur.getDate() - 1);
    while (stats.days[dayKey(cur)]) { streak++; cur.setDate(cur.getDate() - 1); }

    return { month: month, week: week, streak: streak };
  }

  /** ホームには合計だけを出す */
  function renderStatsLink() {
    var total = totalClears();
    var btn = $('statsBtn');
    if (!total) { btn.classList.add('hidden'); return; }
    btn.classList.remove('hidden');
    $('statsCount').textContent = 'これまで ' + total + '問クリア';
  }

  /** きろく画面 */
  function renderRecords() {
    var s = summary();
    $('mMonth').textContent = s.month + '問';
    $('mWeek').textContent = s.week + '問';
    $('mStreak').textContent = s.streak + '日';

    var rows = '';
    LEVELS.forEach(function (l) {
      var c = stats.counts[l] || 0;
      var sub = c
        ? '最速 ' + durationText(stats.best[l]) + '　平均 ' + durationText(stats.total[l] / c)
        : 'まだ挑戦していません';
      rows += '<div class="record-row' + (c ? '' : ' empty') + '">' +
        '<div class="record-top">' +
          '<span class="record-name">' + LEVEL_NAME[l] + '</span>' +
          '<span class="record-count">' + c + '問</span>' +
        '</div>' +
        '<div class="record-sub">' + sub + '</div>' +
        '</div>';
    });
    $('statsTable').innerHTML = rows;

    var total = totalClears();
    var days = Object.keys(stats.days).length;
    $('statsTotal').textContent = total
      ? '合計 ' + total + '問（' + days + '日）'
      : '';
  }

  /* ---------- 保存 ---------- */
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(SET_KEY) || '{}');
      settings.instant = !!s.instant;
    } catch (e) { /* 壊れていたら初期値 */ }
  }
  function saveSettings() {
    try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) {}
  }

  /* ---------- 経過時間 ---------- */
  function elapsedSeconds() {
    if (!state) return 0;
    var live = state.tickStart ? (Date.now() - state.tickStart) / 1000 : 0;
    return state.elapsed + live;
  }

  function showTime() {
    $('timeLabel').textContent = state ? clockText(elapsedSeconds()) : '';
  }

  function startTimer() {
    if (!state || state.tickStart) return;
    state.tickStart = Date.now();
    showTime();
    timerId = setInterval(showTime, 1000);
  }

  function stopTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
    if (state && state.tickStart) {
      state.elapsed += (Date.now() - state.tickStart) / 1000;
      state.tickStart = 0;
    }
    showTime();
  }

  function save() {
    if (!state) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        level: state.level,
        given: state.given.join(''),
        solution: state.solution.join(''),
        values: state.values.join(''),
        notes: state.notes,
        elapsed: Math.round(elapsedSeconds()),
        savedAt: Date.now()
      }));
    } catch (e) { /* 容量オーバー等は無視 */ }
  }

  function readSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || !d.given || d.given.length !== 81 || !d.solution || d.solution.length !== 81) return null;
      var values = String(d.values || '').padEnd(81, '0').split('').map(Number);
      var done = values.every(function (v, i) { return v === Number(d.solution[i]); });
      if (done) return null;   // 解き終わったものは「つづきから」に出さない
      return {
        level: d.level || 'normal',
        given: d.given.split('').map(Number),
        solution: d.solution.split('').map(Number),
        values: values,
        notes: Array.isArray(d.notes) && d.notes.length === 81 ? d.notes : new Array(81).fill(0),
        elapsed: Number(d.elapsed) || 0,
        savedAt: d.savedAt || 0
      };
    } catch (e) { return null; }
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  }

  /* ---------- 盤面の組み立て（1回だけ） ---------- */
  function buildBoard() {
    var board = $('board');
    for (var i = 0; i < 81; i++) {
      var d = document.createElement('div');
      d.className = 'cell';
      d.dataset.i = i;
      var r = Math.floor(i / 9), c = i % 9;
      if (r % 3 === 0 && r !== 0) d.classList.add('bt');
      if (c % 3 === 0 && c !== 0) d.classList.add('bl');
      board.appendChild(d);
      cells.push(d);
    }
    board.addEventListener('click', function (ev) {
      var t = ev.target.closest('.cell');
      if (!t) return;
      selectCell(Number(t.dataset.i));
    });

    var pad = $('pad');
    for (var n = 1; n <= 9; n++) {
      var b = document.createElement('button');
      b.className = 'key';
      b.textContent = String(n);
      b.dataset.n = n;
      pad.appendChild(b);
      keys.push(b);
    }
    pad.addEventListener('click', function (ev) {
      if (!ev.target.classList.contains('key')) return;
      inputNumber(Number(ev.target.dataset.n));
    });
  }

  /* ---------- 描画 ---------- */
  function noteList(mask) {
    var html = '';
    for (var n = 1; n <= 9; n++) html += '<span>' + ((mask >> (n - 1)) & 1 ? n : '') + '</span>';
    return '<div class="notes">' + html + '</div>';
  }

  function render() {
    var sel = state.selected;
    var selVal = sel !== null ? state.values[sel] : 0;
    var showWrong = settings.instant || revealMistakes;
    var remain = 0;

    for (var i = 0; i < 81; i++) {
      var el = cells[i];
      var v = state.values[i];
      var given = state.given[i] !== 0;
      if (!v) remain++;

      // 中身
      if (v) {
        if (el._html !== 'v' + v) { el.textContent = String(v); el._html = 'v' + v; }
      } else if (state.notes[i]) {
        var key = 'n' + state.notes[i];
        if (el._html !== key) { el.innerHTML = noteList(state.notes[i]); el._html = key; }
      } else if (el._html !== '') { el.textContent = ''; el._html = ''; }

      // 色づけ
      el.classList.toggle('given', given);
      el.classList.toggle('wrong', showWrong && !given && v !== 0 && v !== state.solution[i]);
      el.classList.toggle('selected', i === sel);
      el.classList.toggle('same', sel !== null && i !== sel && selVal !== 0 && v === selVal);
      el.classList.toggle('peer',
        sel !== null && i !== sel &&
        (Sudoku.ROW[i] === Sudoku.ROW[sel] || Sudoku.COL[i] === Sudoku.COL[sel] || Sudoku.BOX[i] === Sudoku.BOX[sel]));
    }

    // 使い切った数字はテンキーを薄く
    var counts = new Array(10).fill(0);
    for (var k = 0; k < 81; k++) if (state.values[k]) counts[state.values[k]]++;
    for (var n = 1; n <= 9; n++) keys[n - 1].classList.toggle('done', counts[n] >= 9);

    $('remainLabel').textContent = remain === 0 ? '' : '残り ' + remain;
    $('undoBtn').disabled = undoStack.length === 0;
    $('noteBtn').classList.toggle('on', noteMode);
  }

  function setMessage(text, ok) {
    var m = $('message');
    m.textContent = text || '';
    m.classList.toggle('ok', !!ok);
  }

  /* ---------- 操作 ---------- */
  function pushUndo() {
    undoStack.push({ values: state.values.slice(), notes: state.notes.slice() });
    if (undoStack.length > 100) undoStack.shift();
  }

  function selectCell(i) {
    state.selected = i;
    setMessage('');
    render();
  }

  function inputNumber(n) {
    if (!state || state.selected === null) { setMessage('先にマスを選んでください'); return; }
    var i = state.selected;
    if (state.given[i]) { setMessage('最初から入っている数字は変更できません'); return; }

    pushUndo();
    if (noteMode) {
      if (state.values[i]) state.values[i] = 0;
      state.notes[i] ^= (1 << (n - 1));
    } else if (state.values[i] === n) {
      state.values[i] = 0;                       // 同じ数字をもう一度押したら消す
    } else {
      state.values[i] = n;
      state.notes[i] = 0;
      // 同じ行・列・ブロックのメモから、その数字を自動で消す
      var ps = Sudoku.peers(i);
      for (var p = 0; p < ps.length; p++) state.notes[ps[p]] &= ~(1 << (n - 1));
    }
    afterChange();
  }

  function erase() {
    if (!state || state.selected === null) { setMessage('先にマスを選んでください'); return; }
    var i = state.selected;
    if (state.given[i]) { setMessage('最初から入っている数字は消せません'); return; }
    if (!state.values[i] && !state.notes[i]) return;
    pushUndo();
    state.values[i] = 0;
    state.notes[i] = 0;
    afterChange();
  }

  function undo() {
    if (!undoStack.length) return;
    var s = undoStack.pop();
    state.values = s.values;
    state.notes = s.notes;
    revealMistakes = false;
    setMessage('');
    save();
    render();
  }

  function afterChange() {
    revealMistakes = false;
    setMessage('');
    save();
    render();
    checkFinished();
  }

  /** 完成画面を、ふつうのクリアと自己最速で描き分ける */
  function showClear(level, sec, r) {
    var best = $('clearBest'), prev = $('clearPrev');

    $('markFlower').classList.toggle('hidden', r.isBest);
    $('markCrown').classList.toggle('hidden', !r.isBest);
    $('clearTitle').textContent = r.isBest ? '自己最速' : '完成！';

    if (r.isBest) {
      best.classList.remove('hidden');
      best.textContent = r.prevBest
        ? 'これまででいちばん速い記録です'
        : 'はじめての記録です';
      if (r.prevBest) {
        prev.classList.remove('hidden');
        prev.textContent = '前の記録 ' + durationText(r.prevBest) +
          ' → ' + durationText(r.prevBest - sec) + 'ちぢめました';
      } else {
        prev.classList.add('hidden');
      }
    } else {
      best.classList.add('hidden');
      prev.classList.add('hidden');
    }

    $('clearDetail').textContent =
      LEVEL_NAME[level] + ' ' + r.count + '問目　' + durationText(sec);
    $('clearOverlay').classList.add('is-active');
  }

  function checkFinished() {
    for (var i = 0; i < 81; i++) if (!state.values[i]) return;   // まだ空きがある
    var correct = state.values.every(function (v, k) { return v === state.solution[k]; });
    if (correct) {
      stopTimer();
      var sec = Math.round(state.elapsed);
      var r = recordClear(state.level, sec);
      clearSave();
      showClear(state.level, sec, r);
    } else {
      revealMistakes = true;     // 全部埋まったので、赤で場所を知らせる
      setMessage('赤い数字が間違っています');
      render();
    }
  }

  /* ---------- 画面遷移 ---------- */
  function show(id) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('is-active'); });
    $(id).classList.add('is-active');
    window.scrollTo(0, 0);
  }

  function startGame(level) {
    $('loading').classList.add('is-active');
    // 先に「つくっています」を描画させてから生成する
    setTimeout(function () {
      var g = Sudoku.generate(level);
      state = {
        level: level,
        given: Array.from(g.puzzle),
        solution: Array.from(g.solution),
        values: Array.from(g.puzzle),
        notes: new Array(81).fill(0),
        selected: null,
        elapsed: 0,
        tickStart: 0
      };
      undoStack = [];
      noteMode = false;
      revealMistakes = false;
      $('levelLabel').textContent = LEVEL_NAME[level];
      setMessage('');
      save();
      show('game');
      render();
      startTimer();
      $('loading').classList.remove('is-active');
    }, 30);
  }

  function resume(data) {
    state = {
      level: data.level,
      given: data.given,
      solution: data.solution,
      values: data.values,
      notes: data.notes,
      selected: null,
      elapsed: data.elapsed || 0,
      tickStart: 0
    };
    undoStack = [];
    noteMode = false;
    revealMistakes = false;
    $('levelLabel').textContent = LEVEL_NAME[data.level] || '';
    setMessage('');
    show('game');
    render();
    startTimer();
  }

  function refreshHome() {
    var d = readSave();
    var btn = $('continueBtn'), info = $('continueInfo');
    if (d) {
      var blank = d.values.filter(function (v) { return !v; }).length;
      btn.classList.remove('hidden');
      info.classList.remove('hidden');
      info.textContent = (LEVEL_NAME[d.level] || '') + '・残り ' + blank + 'マス';
      btn.onclick = function () { resume(d); };
    } else {
      btn.classList.add('hidden');
      info.classList.add('hidden');
    }
    renderStatsLink();
  }

  /* ---------- 起動 ---------- */
  var inited = false;
  function init() {
    if (inited) return;   // 二重初期化の防止
    inited = true;
    $('version').textContent = 'version ' + APP_VERSION.slice(1);   // 'v11' → 'version 11'
    loadSettings();
    loadStats();
    buildBoard();

    document.querySelectorAll('.btn-level').forEach(function (b) {
      b.addEventListener('click', function () { startGame(b.dataset.level); });
    });
    $('instantCheck').checked = settings.instant;
    $('instantCheck').addEventListener('change', function (e) {
      settings.instant = e.target.checked;
      saveSettings();
      if (state) render();
    });

    $('backBtn').addEventListener('click', function () {
      stopTimer(); save(); refreshHome(); show('home');
    });
    $('statsBtn').addEventListener('click', function () { renderRecords(); show('records'); });
    $('recordsBackBtn').addEventListener('click', function () { show('home'); });
    $('noteBtn').addEventListener('click', function () { noteMode = !noteMode; render(); });
    $('undoBtn').addEventListener('click', undo);
    $('eraseBtn').addEventListener('click', erase);
    $('againBtn').addEventListener('click', function () {
      $('clearOverlay').classList.remove('is-active');
      startGame(state.level);
    });
    $('toHomeBtn').addEventListener('click', function () {
      $('clearOverlay').classList.remove('is-active');
      state = null;
      refreshHome();
      show('home');
    });

    // キーボードでも遊べるように（PCでの確認用）
    document.addEventListener('keydown', function (e) {
      if (!state || !$('game').classList.contains('is-active')) return;
      if (e.key >= '1' && e.key <= '9') inputNumber(Number(e.key));
      else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') erase();
      else if (e.key === 'n') { noteMode = !noteMode; render(); }
      else if (state.selected !== null) {
        var i = state.selected, r = Math.floor(i / 9), c = i % 9;
        if (e.key === 'ArrowUp' && r > 0) selectCell(i - 9);
        else if (e.key === 'ArrowDown' && r < 8) selectCell(i + 9);
        else if (e.key === 'ArrowLeft' && c > 0) selectCell(i - 1);
        else if (e.key === 'ArrowRight' && c < 8) selectCell(i + 1);
      }
    });

    // アプリが背面に回っている間は時間を止め、戻ってきたら再開する
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { stopTimer(); save(); }
      else if (state && $('game').classList.contains('is-active') &&
               !$('clearOverlay').classList.contains('is-active')) startTimer();
    });

    refreshHome();

    // オフライン化。失敗しても（file:// で開いた場合など）ゲーム自体は遊べる
    try {
      if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
        // URLにバージョンを付ける。GitHub Pages は10分間キャッシュを持たせるため、
        // 同じURLのままだとブラウザが新しい sw.js を取りに行かない。
        navigator.serviceWorker.register('sw.js?' + APP_VERSION).catch(function () {});

        // 新しい版が用意できた瞬間に読み込み直す。
        // これをしないと、古いHTMLと新しいJSが混ざった状態のまま遊ぶことになる。
        //
        // ただし初回訪問（まだ制御役がいない状態）では読み込み直さない。
        // 初回は clients.claim() でも controllerchange が起きるため、
        // これを見ないと開いた直後に一度画面がちらつく。
        var hadController = !!navigator.serviceWorker.controller;
        var reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', function () {
          if (!hadController || reloading) return;   // 初回と二重リロードを除く
          reloading = true;
          location.reload();
        });
      }
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
