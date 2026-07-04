const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

const NEIGHBORS = [];
const JUMPS = [];

for (let r = 0; r < 5; r++) {
  for (let c = 0; c < 5; c++) {
    const adj = [];
    const jmp = [];
    for (const [dr, dc] of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < 5 && nc >= 0 && nc < 5) {
        adj.push(nr * 5 + nc);
        const jr = r + 2 * dr;
        const jc = c + 2 * dc;
        if (jr >= 0 && jr < 5 && jc >= 0 && jc < 5) {
          jmp.push([nr * 5 + nc, jr * 5 + jc]);
        }
      }
    }
    NEIGHBORS.push(adj);
    JUMPS.push(jmp);
  }
}

const Cm = m => m & 31;
const Wm = m => (m >> 5) & 31;
const Tm = m => (m & 1024) !== 0;

function popcount(v) {
  v = v - ((v >> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
  return ((v + (v >> 4) & 0xF0F0F0F) * 0x1010101) >> 24;
}

function ctz(v) {
  return 31 - Math.clz32(v & -v);
}

function hashKey(s, c, turn) {
  let k = s;
  for (const x of c.slice().sort((a, b) => a - b)) {
    k = k * 32 + x;
  }
  return k * 2 + turn;
}

function initState(cannons) {
  let s = 0;
  const c = Array.isArray(cannons) ? cannons : [0, 2, 4];
  for (let t = 10; t < 25; t++) {
    s |= 1 << t;
  }
  return { s, c, turn: 0 };
}

function legalMoves(s, c, turn) {
  const mv = [];
  if (turn === 0) {
    for (let r = 0; r < c.length; r++) {
      const ac = c[r];
      const oc = c.filter((_, i) => i !== r);
      for (const [mid, end] of JUMPS[ac]) {
        if (!oc.includes(end) && !oc.includes(mid) && !((s >>> mid) & 1) && ((s >>> end) & 1)) {
          mv.push(ac | (end << 5) | 1024);
        }
      }
      for (const end of NEIGHBORS[ac]) {
        if (!oc.includes(end) && !((s >>> end) & 1)) {
          mv.push(ac | (end << 5));
        }
      }
    }
  } else {
    let sm = s;
    while (sm) {
      const as = ctz(sm);
      sm &= sm - 1;
      for (const end of NEIGHBORS[as]) {
        if (!c.includes(end) && !((s >>> end) & 1)) {
          mv.push(as | (end << 5));
        }
      }
    }
  }
  return mv;
}

function applyMove(st, m) {
  const s0 = Cm(m);
  const e = Wm(m);
  const cap = Tm(m);
  if (st.turn === 0) {
    return {
      s: cap ? st.s & ~(1 << e) : st.s,
      c: st.c.map(x => (x === s0 ? e : x)),
      turn: 1,
    };
  }
  return { s: (st.s & ~(1 << s0)) | (1 << e), c: st.c, turn: 0 };
}

function checkOver(st, hist, moves) {
  const sc = popcount(st.s);
  if (sc === 0) return { winner: 0, reason: '鬼子全军覆没，红军大捷！' };
  if (sc < 3) return { winner: 0, reason: `鬼子仅剩${sc}队，无力合围，溃败！` };
  if (!legalMoves(st.s, st.c, st.turn).length) {
    return st.turn === 0
      ? { winner: 1, reason: '红军被铁壁包围，退路封锁！' }
      : { winner: 0, reason: '鬼子走投无路，全面崩溃！' };
  }
  const h = hashKey(st.s, st.c, st.turn);
  let rep = 1;
  for (const x of hist) {
    if (hashKey(x.s, x.c, x.turn) === h) rep++;
  }
  if (rep >= 3) return { winner: 0, reason: '战局僵持，鬼子围剿失败，红军突围！' };
  if (moves >= 240) return { winner: 0, reason: '鏖战两百余步，红军成功突围！' };
  return null;
}

function evalState(st) {
  let score = (15 - popcount(st.s)) * 130;
  let cMoves = 0;
  let jMoves = 0;
  for (let r = 0; r < st.c.length; r++) {
    const ac = st.c[r];
    const oc = st.c.filter((_, i) => i !== r);
    for (const end of NEIGHBORS[ac]) {
      if (!oc.includes(end) && !((st.s >>> end) & 1)) cMoves++;
    }
    for (const [mid, end] of JUMPS[ac]) {
      if (!oc.includes(end) && !((st.s >>> mid) & 1) && ((st.s >>> end) & 1)) jMoves++;
    }
  }
  score += cMoves * 12 + jMoves * 34;
  if (cMoves === 1) score -= 60;
  else if (cMoves === 0) score -= 500;

  let visited = 0;
  for (const cc of st.c) visited |= 1 << cc;
  const q = st.c.slice();
  let open = 0;
  while (q.length) {
    const p = q.pop();
    for (const nb of NEIGHBORS[p]) {
      if (!((visited >>> nb) & 1)) {
        visited |= 1 << nb;
        if (!((st.s >>> nb) & 1)) {
          open++;
          q.push(nb);
        }
      }
    }
  }
  score += open * 7;

  let sm = st.s;
  while (sm) {
    const p = ctz(sm);
    sm &= sm - 1;
    const pr = (p / 5) | 0;
    const pc = p % 5;
    let minD = 99;
    let adjS = 0;
    for (const cc of st.c) {
      const d = Math.abs(((cc / 5) | 0) - pr) + Math.abs((cc % 5) - pc);
      if (d < minD) minD = d;
    }
    for (const nb of NEIGHBORS[p]) {
      if ((st.s >>> nb) & 1) adjS++;
    }
    score += minD * 3 - Math.min(adjS, 2) * 5;
  }
  return st.turn === 0 ? score : -score;
}

function terminalScore(st, depth) {
  const sc = popcount(st.s);
  if (sc < 3) return st.turn === 0 ? 100000 - depth : depth - 100000;
  const ms = legalMoves(st.s, st.c, st.turn);
  if (!ms.length) return st.turn === 0 ? depth - 100000 : 100000 - depth;
  return null;
}

function negamax(st, depth, alpha, beta) {
  const tv = terminalScore(st, depth);
  if (tv !== null) return tv;
  if (depth <= 0) return evalState(st);
  const moves = legalMoves(st.s, st.c, st.turn).sort((a, b) => (b & 1024) - (a & 1024));
  let best = -Infinity;
  for (const m of moves) {
    const v = -negamax(applyMove(st, m), depth - 1, -beta, -alpha);
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function searchBestMove(st, level) {
  const moves = legalMoves(st.s, st.c, st.turn);
  if (!moves.length) return -1;
  const depths = [1, 2, 3, 4];
  const jitter = [80, 26, 0, 0][level] ?? 26;
  const depth = depths[level] ?? 2;
  const scored = moves.map(m => ({
    m,
    s: -negamax(applyMove(st, m), depth - 1, -100000, 100000) + ((m & 1024) ? 35 : 0),
  })).sort((a, b) => b.s - a.s);
  if (jitter > 0) {
    const best = scored[0].s;
    const cands = scored.filter(x => x.s >= best - jitter);
    return cands[(Math.random() * cands.length) | 0].m;
  }
  return scored[0].m;
}

export {
  NEIGHBORS,
  Cm,
  Wm,
  Tm,
  popcount,
  ctz,
  hashKey,
  initState,
  legalMoves,
  applyMove,
  checkOver,
  searchBestMove,
};
