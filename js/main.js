// js/main.js — 红军打鬼子 · WeChat Mini Game Canvas Engine
import { canvas, MENU_BUTTON, SCREEN_WIDTH, SCREEN_HEIGHT } from './render.js';
import {
  Cm,
  Wm,
  Tm,
  ctz,
  popcount,
  hashKey,
  initState,
  legalMoves,
  applyMove,
  checkOver,
  searchBestMove,
} from './game-core.js';
import {
  P,
  CONTENT_X,
  CONTENT_W,
  BX,
  BS,
  CS,
  PR,
  TOP_CLEAR,
  BOTTOM_CLEAR,
  TITLE_Y,
  SUBTITLE_Y,
  HUD_Y,
  HUD_H,
  PLAY_CH,
  CONTROL_GAP,
  CONTROL_W,
  PRIMARY_BTN_H,
  PRIMARY_BTN_Y,
  getPlaceLayout,
  getPlayLayout,
} from './layout.js';
import { C } from './theme.js';

/* ════════════════════════════════════════════════════════
   4.  GAME STATE
════════════════════════════════════════════════════════ */
const PH = {SETUP:'SETUP', PLACE:'PLACE', PLAY:'PLAY', OVER:'OVER'};
let phase = PH.SETUP;
let G = {
  st:null, hist:[], lastM:-1, over:null,
  sel:-1, thinking:false,
  mode:'pve', side:0, level:1,
  hintUsed:false, hint:null,
  placed:[], expl:null,
};

const assets = {
  bg: loadImage('images/bg.jpg'),
};

function loadImage(src) {
  const maker = canvas.createImage || wx.createImage;
  if (!maker) return null;
  try {
    const img = maker.call(canvas);
    img.onload = () => { dirty = true; };
    img.src = src;
    return img;
  } catch (e) {
    return null;
  }
}

/* ════════════════════════════════════════════════════════
   5.  AUDIO
════════════════════════════════════════════════════════ */
let muted = false;
const audioPool = {};
const audioFiles = {
  move: 'audio/bullet.mp3',
  hint: 'audio/bullet.mp3',
  cap: 'audio/boom.mp3',
  win: 'audio/bgm.mp3',
  lose: 'audio/boom.mp3',
};
function initAudio() {}
function beep(type) {
  if (muted || !wx.createInnerAudioContext) return;
  const src = audioFiles[type] || audioFiles.move;
  try {
    if (!audioPool[src]) {
      const a = wx.createInnerAudioContext();
      a.src = src;
      a.volume = type === 'win' ? 0.22 : 0.55;
      audioPool[src] = a;
    }
    audioPool[src].stop();
    audioPool[src].play();
  } catch (e) {
    muted = true;
  }
}

/* ════════════════════════════════════════════════════════
   6.  AI  (main-thread, delayed to avoid WeChat worker noise)
════════════════════════════════════════════════════════ */
let aiId = 0, aiT = 0;

function killWorker() { aiId++; }
function finishAI(id, move, isHint) {
  if (id !== aiId || G.over) return;
  if (move < 0) {
    G.thinking = false;
    if (isHint) G.hintUsed = false;
    dirty = true;
    return;
  }
  if (isHint) {
    G.thinking = false;
    G.hint = {from:Cm(move), to:Wm(move)};
    beep('hint');
    dirty = true;
    return;
  }
  const delay = Math.max(0, 520 - (Date.now() - aiT));
  setTimeout(()=>{ if (id===aiId && !G.over && G.thinking) doMove(move); }, delay);
}
function requestAI(isHint=false) {
  G.thinking = true; aiT = Date.now(); aiId++;
  const id = aiId, st = {s:G.st.s, c:G.st.c.slice(), turn:G.st.turn};
  setTimeout(()=>finishAI(id, searchBestMove(st, isHint ? 3 : G.level), isHint), 35);
  dirty = true;
}
function triggerAI() {
  if (G.over || G.mode!=='pve') return;
  if (G.st.turn === G.side) return;
  requestAI(false);
}
function reqHint() {
  if (G.thinking||G.over||G.hintUsed) return;
  const hu = G.mode==='pvp' || G.st.turn===G.side;
  if (!hu) return;
  G.hintUsed = true;
  requestAI(true);
}

/* ════════════════════════════════════════════════════════
   7.  GAME ACTIONS
════════════════════════════════════════════════════════ */
function reset() {
  killWorker();
  Object.assign(G,{hist:[],lastM:-1,over:null,sel:-1,thinking:false,
                   hintUsed:false,hint:null,placed:[],expl:null});
  if (G.mode==='pvp' || G.side===0) { phase=PH.PLACE; G.st=initState([]); }
  else { phase=PH.PLAY; G.st=initState([0,2,4]); triggerAI(); }
  dirty=true;
}
function confirmPlace() {
  if (G.placed.length!==3) return;
  G.st=initState(G.placed.slice()); phase=PH.PLAY; triggerAI(); dirty=true;
}
function doMove(m) {
  G.hint=null;
  const s0=Cm(m), e=Wm(m), cap=Tm(m);
  G.hist.push({s:G.st.s,c:G.st.c.slice(),turn:G.st.turn,lastM:G.lastM});
  if (cap) { G.expl={pos:e,t:Date.now()}; beep('cap'); } else beep('move');
  G.st=applyMove(G.st,m); G.lastM=m; G.sel=-1; G.thinking=false;
  const ov=checkOver(G.st, G.hist, G.hist.length);
  if (ov) {
    G.over=ov; phase=PH.OVER;
    if (G.mode==='pve') { if (ov.winner===G.side) beep('win'); else beep('lose'); }
    else beep('win');
  } else triggerAI();
  dirty=true;
}
function undo() {
  if (!G.hist.length||G.thinking) return;
  G.hint=null; killWorker();
  let snap=null;
  if (G.mode==='pve') { while(G.hist.length){snap=G.hist.pop();if(snap.turn===G.side)break;} }
  else snap=G.hist.pop();
  if (snap) {
    G.st={s:snap.s,c:snap.c.slice(),turn:snap.turn}; G.lastM=snap.lastM;
    G.sel=-1; G.over=null; G.thinking=false; G.expl=null;
    phase=PH.PLAY; beep('move'); dirty=true;
  }
}
function tapBoard(pos) {
  if (phase===PH.PLACE) {
    const idx=G.placed.indexOf(pos);
    if (idx>=0) G.placed.splice(idx,1);
    else if (pos<5&&G.placed.length<3) { G.placed.push(pos); beep('move'); }
    dirty=true; return;
  }
  if (phase!==PH.PLAY||G.over||G.thinking) return;
  const hu = G.mode==='pvp' || G.st.turn===G.side;
  if (!hu) return;
  G.hint=null;
  // Try executing a move from selected piece
  if (G.sel>=0) {
    const ms=legalMoves(G.st.s,G.st.c,G.st.turn);
    const mv=ms.find(m=>Cm(m)===G.sel&&Wm(m)===pos);
    if (mv!==undefined) { doMove(mv); return; }
  }
  // Select a piece
  const isCannon = G.st.c.includes(pos);
  const isSoldier= ((G.st.s>>>pos)&1)!==0;
  if (G.st.turn===0&&isCannon)  { G.sel=pos; beep('move'); dirty=true; }
  else if (G.st.turn===1&&isSoldier) { G.sel=pos; beep('move'); dirty=true; }
  else if (G.sel>=0) { G.sel=-1; dirty=true; }
}

/* ════════════════════════════════════════════════════════
   8.  CANVAS PRIMITIVES
════════════════════════════════════════════════════════ */
const ctx = canvas.getContext('2d');

function rrect(x,y,w,h,r,fill,stroke,lw) {
  ctx.beginPath();
  if (ctx.roundRect) {
    // WeChat canvas requires radius as an array (sequence), not a bare number
    ctx.roundRect(x,y,w,h,[r]);
  } else {
    const R=Math.min(r,w/2,h/2);
    ctx.moveTo(x+R,y); ctx.arcTo(x+w,y,x+w,y+h,R);
    ctx.arcTo(x+w,y+h,x,y+h,R); ctx.arcTo(x,y+h,x,y,R);
    ctx.arcTo(x,y,x+w,y,R); ctx.closePath();
  }
  if (fill)  { ctx.fillStyle=fill; ctx.fill(); }
  if (stroke&&lw>0) { ctx.strokeStyle=stroke; ctx.lineWidth=lw; ctx.stroke(); }
}

/** Convert logical board position to canvas XY, accounting for flip. */
function nxy(pos, flip, boardY) {
  const ap = flip?24-pos:pos, r=Math.floor(ap/5), c=ap%5;
  return { x: BX + Math.round(c*CS), y: boardY + Math.round(r*CS) };
}

/* Draw a small 5-pointed star centred at (cx,cy) */
function star(cx,cy,outerR,innerR,color) {
  ctx.beginPath();
  for (let i=0;i<10;i++) {
    const r2=i%2===0?outerR:innerR, a=(i*Math.PI/5)-Math.PI/2;
    i===0 ? ctx.moveTo(cx+r2*Math.cos(a),cy+r2*Math.sin(a))
           : ctx.lineTo(cx+r2*Math.cos(a),cy+r2*Math.sin(a));
  }
  ctx.closePath(); ctx.fillStyle=color; ctx.fill();
}

/* Touch hit-zones (rebuilt each frame) */
let hits = [];
function addHit(x,y,w,h,fn) { hits.push({x,y,w,h,fn}); }

/* Draw a rounded button with optional primary / active style */
function btn(x,y,w,h,label,sub,active,disabled,primary) {
  ctx.globalAlpha = disabled ? 0.32 : 1;
  if (primary) {
    rrect(x,y,w,h,10, active?'#9e2218':C.red, 'rgba(255,210,120,0.35)', 1.5);
    ctx.fillStyle = C.tx;
  } else if (active) {
    rrect(x,y,w,h,10, 'rgba(193,147,49,0.94)', 'rgba(255,227,142,0.58)', 1.5);
    ctx.fillStyle = C.ink;
  } else {
    rrect(x,y,w,h,10, 'rgba(20,32,23,0.82)', 'rgba(182,145,49,0.28)', 1);
    ctx.fillStyle = C.tx;
  }
  ctx.textAlign = 'center';
  if (sub) {
    ctx.font = `600 ${Math.round(h*.30)}px sans-serif`;
    ctx.fillText(label, x+w/2, y+h*.46);
    ctx.font = `${Math.round(h*.22)}px sans-serif`;
    ctx.fillStyle = active ? '#4a3a10' : C.txDim;
    ctx.fillText(sub, x+w/2, y+h*.76);
  } else {
    ctx.font = `600 ${Math.round(h*.38)}px sans-serif`;
    ctx.fillText(label, x+w/2, y+h*.64);
  }
  ctx.globalAlpha = 1;
}

/* Small section-label text */
function sectionLabel(text, y) {
  ctx.fillStyle=C.txDim; ctx.textAlign='left';
  ctx.font=`600 ${Math.round(P*.92)}px sans-serif`;
  ctx.fillText(text, CONTENT_X, y);
}

function drawBackdrop() {
  const bgGrad = ctx.createLinearGradient(0, 0, 0, SCREEN_HEIGHT);
  bgGrad.addColorStop(0, '#182417');
  bgGrad.addColorStop(0.4, C.bg2);
  bgGrad.addColorStop(1, C.bg);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0,0,SCREEN_WIDTH,SCREEN_HEIGHT);

  if (assets.bg && assets.bg.width) {
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.drawImage(assets.bg, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    ctx.restore();
  }

  const vignette = ctx.createRadialGradient(SCREEN_WIDTH * 0.5, SCREEN_HEIGHT * 0.12, 20, SCREEN_WIDTH * 0.5, SCREEN_HEIGHT * 0.4, SCREEN_HEIGHT * 0.8);
  vignette.addColorStop(0, 'rgba(255,230,140,0.06)');
  vignette.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0,0,SCREEN_WIDTH,SCREEN_HEIGHT);
}

function drawHeaderPanel() {
  const panelX = CONTENT_X;
  const panelW = SCREEN_WIDTH - CONTENT_X * 2 - (MENU_BUTTON ? Math.max(0, SCREEN_WIDTH - MENU_BUTTON.left + 6) : 0);
  rrect(panelX, HUD_Y, Math.max(160, panelW), HUD_H, 14, 'rgba(9,16,12,0.76)', 'rgba(255,219,123,0.12)', 1);
}

/* ════════════════════════════════════════════════════════
   9.  BOARD & PIECE DRAWING
════════════════════════════════════════════════════════ */
function drawBoard(boardY) {
  // Wood shadow frame
  ctx.shadowColor='rgba(0,0,0,0.4)'; ctx.shadowBlur=20; ctx.shadowOffsetY=8;
  rrect(BX-P*.7, boardY-P*.7, BS+P*1.4, BS+P*1.4, 14, C.wood);
  ctx.shadowBlur=0; ctx.shadowOffsetY=0;
  // Paper surface gradient
  const g=ctx.createRadialGradient(BX+BS*.38,boardY+BS*.24,0, BX+BS/2,boardY+BS/2,BS);
  g.addColorStop(0,C.boardHi); g.addColorStop(1,C.boardLo);
  rrect(BX-P*.45, boardY-P*.45, BS+P*.9, BS+P*.9, 10, g, 'rgba(255,222,145,0.16)', 1);
  ctx.strokeStyle = 'rgba(77,54,26,0.28)';
  ctx.lineWidth = 1;
  ctx.strokeRect(BX + 6, boardY + 6, BS - 12, BS - 12);
  // Grid lines
  ctx.strokeStyle=C.line; ctx.lineWidth=Math.max(1,BS*.004);
  for (let i=0;i<5;i++) {
    const xi=BX+i*CS, yi=boardY+i*CS;
    ctx.beginPath(); ctx.moveTo(BX,yi); ctx.lineTo(BX+BS,yi); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(xi,boardY); ctx.lineTo(xi,boardY+BS); ctx.stroke();
  }
  // Node dots
  for (let p=0;p<25;p++) {
    const {x,y}=nxy(p,false,boardY);
    ctx.beginPath(); ctx.arc(x,y,2,0,Math.PI*2); ctx.fillStyle=C.line; ctx.fill();
  }
}

function drawPieces(flip, boardY) {
  // Which cannons to draw: during PLACING use G.placed, otherwise G.st.c
  const cannons = phase===PH.PLACE ? G.placed : G.st.c;
  const {s} = G.st;

  /* --- Last-move markers --- */
  if (G.lastM>=0) {
    [Cm(G.lastM),Wm(G.lastM)].forEach((p,i)=>{
      const {x,y}=nxy(p,flip,boardY);
      ctx.beginPath(); ctx.arc(x,y,PR*1.55,0,Math.PI*2);
      ctx.fillStyle=i?'rgba(100,65,22,.32)':'rgba(55,40,18,.22)'; ctx.fill();
    });
  }

  /* --- Hint markers --- */
  if (G.hint) {
    [{p:G.hint.from,dash:true},{p:G.hint.to,dash:false}].forEach(({p,dash})=>{
      const {x,y}=nxy(p,flip,boardY);
      ctx.beginPath(); ctx.arc(x,y,PR*(dash?1.45:1.12),0,Math.PI*2);
      ctx.strokeStyle=C.gold; ctx.lineWidth=2.8;
      ctx.setLineDash(dash?[5,3]:[]); ctx.stroke(); ctx.setLineDash([]);
    });
  }

  /* --- Placement zone pulsing circles --- */
  if (phase===PH.PLACE && G.placed.length<3) {
    for (let pp=0;pp<5;pp++) {
      if (!G.placed.includes(pp)) {
        const {x,y}=nxy(pp,flip,boardY);
        const wave=(Math.sin(Date.now()/220+pp*0.8)+1)/2;
        const outerR=PR*(0.9+wave*0.55);
        const innerR=PR*(0.45+wave*0.18);
        ctx.save();
        ctx.shadowColor='rgba(255,214,96,0.9)';
        ctx.shadowBlur=10+wave*10;
        ctx.beginPath(); ctx.arc(x,y,outerR,0,Math.PI*2);
        ctx.fillStyle=`rgba(255,214,96,${0.10+wave*0.16})`;
        ctx.fill();
        ctx.restore();
        ctx.beginPath(); ctx.arc(x,y,outerR,0,Math.PI*2);
        ctx.strokeStyle=`rgba(255,214,96,${0.72+wave*0.24})`;
        ctx.lineWidth=2.6+wave*1.2;
        ctx.stroke();
        ctx.beginPath(); ctx.arc(x,y,innerR,0,Math.PI*2);
        ctx.fillStyle=`rgba(255,214,96,${0.78+wave*0.18})`;
        ctx.fill();
      }
    }
    dirty=true; // keep animating
  }

  /* --- Legal-move target dots for selected piece --- */
  if (G.sel>=0 && !G.thinking && !G.over && phase===PH.PLAY) {
    const pulse=.82+.18*Math.sin(Date.now()/300+G.sel);
    legalMoves(s,G.st.c,G.st.turn).filter(m=>Cm(m)===G.sel).forEach(m=>{
      const {x,y}=nxy(Wm(m),flip,boardY);
      if (G.st.turn===0) {
        ctx.beginPath(); ctx.arc(x,y,PR*(Tm(m)?1.08:0.88)*pulse,0,Math.PI*2);
        ctx.fillStyle=Tm(m)?'rgba(201,53,39,0.24)':'rgba(201,53,39,0.14)';
        ctx.fill();
        ctx.beginPath(); ctx.arc(x,y,PR*(Tm(m)?0.84:0.64)*pulse,0,Math.PI*2);
        ctx.strokeStyle=Tm(m)?'rgba(255,120,104,0.98)':'rgba(255,112,96,0.88)';
        ctx.lineWidth=Tm(m)?3.2:2.4;
        ctx.stroke();
        ctx.beginPath(); ctx.arc(x,y,PR*(Tm(m)?0.24:0.18),0,Math.PI*2);
        ctx.fillStyle='rgba(255,132,118,0.95)';
        ctx.fill();
      } else {
        if (Tm(m)) {
          ctx.beginPath(); ctx.arc(x,y,PR*.88,0,Math.PI*2);
          ctx.strokeStyle=C.red; ctx.lineWidth=2.5; ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(x,y,PR*.5,0,Math.PI*2);
          ctx.fillStyle='rgba(192,57,43,.52)'; ctx.fill();
        }
      }
    });
    if (G.st.turn===0) dirty=true;
  }

  /* --- Japanese soldier pieces (helmets) --- */
  let sm=s;
  while (sm) {
    const p=ctz(sm); sm&=sm-1;
    const {x,y}=nxy(p,flip,boardY);
    // Base circle
    ctx.shadowColor='rgba(0,0,0,0.18)'; ctx.shadowBlur=6; ctx.shadowOffsetY=2;
    ctx.beginPath(); ctx.arc(x,y,PR,0,Math.PI*2);
    ctx.fillStyle=C.olive; ctx.fill();
    ctx.shadowBlur=0; ctx.shadowOffsetY=0;
    ctx.strokeStyle=C.oliveDp; ctx.lineWidth=1.5; ctx.stroke();
    // Helmet dome
    ctx.beginPath(); ctx.arc(x,y-PR*.22,PR*.56,Math.PI,0);
    ctx.fillStyle=C.oliveHi; ctx.fill();
    // Helmet brim
    ctx.beginPath(); ctx.ellipse(x,y+PR*.14,PR*.72,PR*.19,0,0,Math.PI*2);
    ctx.fillStyle=C.oliveDp; ctx.fill();
    // Selection ring
    if (p===G.sel) {
      ctx.beginPath(); ctx.arc(x,y,PR+3,0,Math.PI*2);
      ctx.strokeStyle=C.gold; ctx.lineWidth=2.2; ctx.stroke();
    }
  }

  /* --- Red Army cannon pieces (red circles with gold star) --- */
  cannons.forEach(p=>{
    const {x,y}=nxy(p,flip,boardY);
    // Selection glow
    if (p===G.sel) {
      ctx.beginPath(); ctx.arc(x,y,PR+5,0,Math.PI*2);
      ctx.fillStyle='rgba(231,76,60,.28)'; ctx.fill();
    }
    // Red circle
    ctx.shadowColor='rgba(0,0,0,0.18)'; ctx.shadowBlur=6; ctx.shadowOffsetY=2;
    ctx.beginPath(); ctx.arc(x,y,PR,0,Math.PI*2);
    const rg=ctx.createRadialGradient(x-PR*.3,y-PR*.3,0, x,y,PR);
    rg.addColorStop(0,'#e85b4a'); rg.addColorStop(1,C.redDp);
    ctx.fillStyle=rg; ctx.fill();
    ctx.shadowBlur=0; ctx.shadowOffsetY=0;
    ctx.strokeStyle=C.gold; ctx.lineWidth=1.8; ctx.stroke();
    // 5-pointed gold star
    star(x, y, PR*.44, PR*.19, C.gold);
  });

  /* --- Explosion burst animation --- */
  if (G.expl) {
    const age=(Date.now()-G.expl.t)/480;
    if (age<1) {
      const {x,y}=nxy(G.expl.pos,flip,boardY);
      ctx.globalAlpha=1-age;
      ctx.beginPath(); ctx.arc(x,y,PR*(1+age*2.6),0,Math.PI*2);
      ctx.strokeStyle=C.gold; ctx.lineWidth=2.2; ctx.stroke();
      ctx.beginPath(); ctx.arc(x,y,PR*(1+age*1.5),0,Math.PI*2);
      ctx.fillStyle=`rgba(231,76,60,${.44*(1-age)})`; ctx.fill();
      ctx.globalAlpha=1; dirty=true;
    } else { G.expl=null; }
  }
}

/* ════════════════════════════════════════════════════════
   10.  SCREEN RENDERERS
════════════════════════════════════════════════════════ */

/* ── SETUP ── */
function renderSetup() {
  drawBackdrop();
  drawHeaderPanel();

  const tx=SCREEN_WIDTH/2;
  let y=TITLE_Y;
  ctx.textAlign='center';
  ctx.font=`700 ${Math.round(Math.min(24, SCREEN_WIDTH*.08))}px sans-serif`;
  ctx.fillStyle=C.gold; ctx.fillText('红军打鬼子', tx, y);
  ctx.font=`600 ${Math.round(Math.min(14, SCREEN_WIDTH*.033))}px sans-serif`;
  ctx.fillStyle=C.txDim; ctx.fillText('5x5 战术沙盘 · 以少胜多', tx, SUBTITLE_Y);
  y = TOP_CLEAR + 26;

  const bw=(CONTENT_W-P)/2;
  const bh=Math.round(Math.max(48, SCREEN_HEIGHT*.062));

  /* Mode */
  sectionLabel('对战模式', y - Math.round(P * 0.8)); 
  btn(CONTENT_X,y,bw,bh,'人机对战',null,G.mode==='pve',false);
  btn(CONTENT_X+P+bw,y,bw,bh,'双人对局',null,G.mode==='pvp',false);
  addHit(CONTENT_X,y,bw,bh,()=>{G.mode='pve';dirty=true;});
  addHit(CONTENT_X+P+bw,y,bw,bh,()=>{G.mode='pvp';dirty=true;});
  y += bh + Math.round(P * 2.3);

  if (G.mode==='pve') {
    /* Side */
    sectionLabel('选择阵营', y - Math.round(P * 0.8));
    btn(CONTENT_X,y,bw,bh,'我执红军',null,G.side===0,false);
    btn(CONTENT_X+P+bw,y,bw,bh,'我执鬼子',null,G.side===1,false);
    addHit(CONTENT_X,y,bw,bh,()=>{G.side=0;dirty=true;});
    addHit(CONTENT_X+P+bw,y,bw,bh,()=>{G.side=1;dirty=true;});
    y += bh + Math.round(P * 2.3);

    /* Difficulty */
    sectionLabel('人工智能', y - Math.round(P * 0.8));
    const diffs=[{l:0,n:'新丁',s:'常有昏招'},{l:1,n:'老把式',s:'稳扎稳打'},
                 {l:2,n:'高手',s:'算路颇深'},{l:3,n:'神机',s:'深算十步'}];
    const oneRow = (CONTENT_W-P*3)/4 >= 82;
    const dw = oneRow ? (CONTENT_W-P*3)/4 : (CONTENT_W-P)/2;
    const dh = Math.round(bh * (oneRow ? 1.22 : 1.14));
    diffs.forEach((d,i)=>{
      const col = oneRow ? i : i % 2;
      const row = oneRow ? 0 : Math.floor(i / 2);
      const dx = CONTENT_X + col * (dw + P);
      const dy = y + row * (dh + P);
      btn(dx,dy,dw,dh,d.n,d.s,G.level===d.l,false);
      addHit(dx,dy,dw,dh,()=>{G.level=d.l;dirty=true;});
    });
  }

  /* Start */
  const sw=Math.min(280,CONTENT_W), sh=Math.round(Math.max(50, SCREEN_HEIGHT*.068));
  const sx=(SCREEN_WIDTH-sw)/2, sy=SCREEN_HEIGHT-BOTTOM_CLEAR-sh-22;
  btn(sx,sy,sw,sh,'开始对局',null,false,false,'primary');
  addHit(sx,sy,sw,sh,()=>reset());
}

/* ── PLACING ── */
function renderPlacing() {
  const flip=true; // always show Red Army at bottom during placement
  const layout = getPlaceLayout();
  drawBackdrop();
  drawHeaderPanel();

  const n=G.placed.length;
  ctx.textAlign='center';
  ctx.font=`700 ${Math.round(Math.min(24, SCREEN_WIDTH*.058))}px sans-serif`;
  ctx.fillStyle=C.tx; ctx.fillText(`自定义布阵 ${n}/3`, SCREEN_WIDTH/2, TITLE_Y);
  ctx.font=`700 ${Math.round(Math.min(18, SCREEN_WIDTH*.043))}px sans-serif`;
  ctx.fillStyle=C.gold;
  ctx.fillText(n<3?'点击第一排格点放置红军':'阵地就绪，点击确认开战', SCREEN_WIDTH/2, SUBTITLE_Y);

  /* Camp labels */
  ctx.font=`700 ${Math.round(Math.min(17, SCREEN_WIDTH*.039))}px sans-serif`;
  ctx.fillStyle=C.txDim; ctx.fillText('鬼子部队',     SCREEN_WIDTH/2, layout.topCampY);
  ctx.fillStyle=C.red;   ctx.fillText('红军主力部队', SCREEN_WIDTH/2, layout.bottomCampY);

  drawBoard(layout.boardY);
  drawPieces(flip, layout.boardY);

  /* Board hit zones */
  for (let p=0;p<25;p++) {
    const {x,y}=nxy(p,flip,layout.boardY);
    addHit(x-CS/2,y-CS/2, CS,CS, ()=>tapBoard(p));
  }

  /* Placement progress dots */
  const dotY=layout.dotsY, dotR=9, dotGap=24;
  const dotsX=SCREEN_WIDTH/2 - dotGap;
  [0,1,2].forEach(i=>{
    const dx=dotsX+i*dotGap;
    ctx.beginPath(); ctx.arc(dx,dotY,dotR,0,Math.PI*2);
    ctx.fillStyle=i<n?C.red:'transparent'; ctx.fill();
    ctx.strokeStyle=i<n?C.redHi:C.goldA; ctx.lineWidth=2; ctx.stroke();
  });

  /* Confirm button */
  const cbW=Math.min(260,CONTENT_W);
  const cbX=(SCREEN_WIDTH-cbW)/2;
  btn(cbX,PRIMARY_BTN_Y,cbW,PRIMARY_BTN_H,'确认布阵，开战！',null,false,n<3,'primary');
  if (n===3) addHit(cbX,PRIMARY_BTN_Y,cbW,PRIMARY_BTN_H,()=>confirmPlace());

  /* Back */
  const bkH=Math.round(40);
  btn(CONTENT_X, HUD_Y + 6, 82, bkH,'返回',null,false,false);
  addHit(CONTENT_X, HUD_Y + 6, 82, bkH, ()=>{phase=PH.SETUP;dirty=true;});
}

/* ── PLAYING ── */
function renderPlaying() {
  const flip = G.mode==='pve' && G.side===0;
  const layout = getPlayLayout();
  drawBackdrop();
  drawHeaderPanel();

  /* Status bar */
  const sc=popcount(G.st.s);
  let tLabel, tColor;
  if (G.thinking) {
    tLabel = G.st.turn===0?'红军正在运筹帷幄...':'鬼子正在调兵遣将...';
    tColor = C.gold;
  } else if (G.over) {
    tLabel = G.over.winner===0?'🎉 红军胜利':'💀 鬼子获胜';
    tColor = G.over.winner===0?C.red:C.txDim;
  } else {
    const hu=G.mode==='pvp'||G.st.turn===G.side;
    if (G.st.turn===0) { tLabel=hu?'轮到红军行动':'电脑控制红军'; tColor=C.red; }
    else { tLabel=hu?'轮到鬼子行动':'电脑控制鬼子'; tColor=C.oliveHi; }
  }
  ctx.textAlign='center';
  ctx.font=`700 ${Math.round(Math.min(21, SCREEN_WIDTH*.044))}px sans-serif`;
  ctx.fillStyle=tColor; ctx.fillText(tLabel, SCREEN_WIDTH/2, TITLE_Y);
  ctx.font=`600 ${Math.round(Math.min(14, SCREEN_WIDTH*.031))}px sans-serif`;
  ctx.fillStyle=C.txDim;
  ctx.fillText(`鬼子 ${sc}/15 队 · 第 ${G.hist.length} 步`, SCREEN_WIDTH/2, SUBTITLE_Y);

  /* Camp labels */
  ctx.font=`600 ${Math.round(Math.min(12, SCREEN_WIDTH*.028))}px sans-serif`;
  ctx.fillStyle=flip?C.txDim:C.red;   ctx.fillText(flip?'鬼子部队':'红军主力',     SCREEN_WIDTH/2, layout.topCampY);
  ctx.fillStyle=flip?C.red:C.txDim; ctx.fillText(flip?'红军主力部队':'鬼子部队', SCREEN_WIDTH/2, layout.bottomCampY);

  drawBoard(layout.boardY);
  drawPieces(flip, layout.boardY);

  /* Board hit zones */
  if (!G.over) {
    for (let p=0;p<25;p++) {
      const {x,y}=nxy(p,flip,layout.boardY);
      addHit(x-CS/2,y-CS/2, CS,CS, ()=>tapBoard(p));
    }
  }

  /* Controls row */
  const hDis=G.thinking||!!G.over||!(G.mode==='pvp'||G.st.turn===G.side)||G.hintUsed;
  const uDis=!G.hist.length||G.thinking||!!G.over;
  const cbtns=[
    {l:G.hintUsed?'提示已用':'提示(1)', dis:hDis, fn:reqHint},
    {l:'悔棋', dis:uDis, fn:undo},
    {l:'新局', dis:false, fn:()=>{phase=PH.SETUP;dirty=true;}},
    {l:muted?'开声':'静音', dis:false, fn:()=>{muted=!muted;dirty=true;}},
  ];
  cbtns.forEach((b,i)=>{
    const bx=CONTENT_X+i*(CONTROL_W+CONTROL_GAP);
    btn(bx,layout.controlsY,CONTROL_W,PLAY_CH,b.l,null,false,b.dis);
    if (!b.dis) addHit(bx,layout.controlsY,CONTROL_W,PLAY_CH,b.fn);
  });

  /* Hint banner */
  if (G.hint && !G.over) {
    ctx.textAlign='center'; ctx.fillStyle=C.gold;
    ctx.font=`600 ${Math.round(Math.min(14, SCREEN_WIDTH*.033))}px sans-serif`;
    ctx.fillText('★ 建议走法已标出', SCREEN_WIDTH/2, layout.controlsY+PLAY_CH+Math.round(P*.8));
  }
}

/* ── GAME OVER overlay ── */
function renderOver() {
  renderPlaying(); // draw dimmed game board as background

  /* Dark overlay */
  ctx.fillStyle='rgba(10,8,6,.84)'; ctx.fillRect(0,0,SCREEN_WIDTH,SCREEN_HEIGHT);

  const cw=SCREEN_WIDTH-P*4, ch=Math.round(SCREEN_HEIGHT*.46);
  const cx=(SCREEN_WIDTH-cw)/2, cy=(SCREEN_HEIGHT-ch)/2;
  rrect(cx,cy,cw,ch,16, 'rgba(22,18,14,.98)', C.gold, 1.5);

  const isWin=G.mode==='pve'?G.over.winner===G.side:true;
  ctx.textAlign='center';
  ctx.font=`700 ${Math.round(Math.min(28, SCREEN_WIDTH*.066))}px sans-serif`;
  ctx.fillStyle=isWin?C.gold:C.txDim;
  ctx.fillText(isWin?'战役大捷':'战役失利', SCREEN_WIDTH/2, cy+ch*.21);

  /* Stamp circle */
  const sr=Math.round(SCREEN_WIDTH*.13);
  ctx.beginPath(); ctx.arc(SCREEN_WIDTH/2,cy+ch*.43,sr,0,Math.PI*2);
  ctx.strokeStyle=isWin?C.red:'#555'; ctx.lineWidth=3; ctx.stroke();
  ctx.font=`700 ${Math.round(sr*.88)}px sans-serif`;
  ctx.fillStyle=isWin?C.red:'#555';
  ctx.fillText(isWin?'大捷':'惜败', SCREEN_WIDTH/2, cy+ch*.43+sr*.33);

  /* Reason */
  ctx.font=`600 ${Math.round(Math.min(15, SCREEN_WIDTH*.034))}px sans-serif`;
  ctx.fillStyle=C.tx; ctx.fillText(G.over.reason, SCREEN_WIDTH/2, cy+ch*.66);

  /* Stats */
  const cap=15-popcount(G.st.s);
  ctx.font=`600 ${Math.round(Math.min(14, SCREEN_WIDTH*.031))}px sans-serif`;
  ctx.fillStyle=C.txDim;
  ctx.fillText(`共走 ${G.hist.length} 步 · 消灭鬼子 ${cap}/15 队`, SCREEN_WIDTH/2, cy+ch*.77);

  /* Restart */
  const rbW=Math.min(210,cw-P*2), rbH=Math.round(SCREEN_HEIGHT*.068);
  const rbX=(SCREEN_WIDTH-rbW)/2, rbY=cy+ch*.86;
  btn(rbX,rbY,rbW,rbH,'重整旗鼓，再来一局',null,false,false,'primary');

  // Clear board hits from renderPlaying(), only keep OVER hits
  hits=[];
  addHit(rbX,rbY,rbW,rbH,()=>{phase=PH.SETUP;dirty=true;});
}

/* ════════════════════════════════════════════════════════
   11.  RENDER LOOP
════════════════════════════════════════════════════════ */
let dirty = true;

function render() {
  hits=[];
  ctx.clearRect(0,0,SCREEN_WIDTH,SCREEN_HEIGHT);
  switch(phase) {
    case PH.SETUP: renderSetup();  break;
    case PH.PLACE: renderPlacing();break;
    case PH.PLAY:  renderPlaying();break;
    case PH.OVER:  renderOver();   break;
  }
}

function loop() {
  if (dirty) { render(); dirty=false; }
  requestAnimationFrame(loop);
}

/* ════════════════════════════════════════════════════════
   12.  TOUCH INPUT
════════════════════════════════════════════════════════ */
function onTouch(touches) {
  if (!touches||!touches.length) return;
  initAudio(); // unlock audio context on first touch (iOS requirement)
  // wx mini-game Touch objects expose clientX/clientY; x/y may be undefined
  const t = touches[0];
  const tx = t.clientX !== undefined ? t.clientX : t.x;
  const ty = t.clientY !== undefined ? t.clientY : t.y;
  for (const h of hits) {
    if (tx>=h.x && tx<=h.x+h.w && ty>=h.y && ty<=h.y+h.h) { h.fn(); return; }
  }
}

/* ════════════════════════════════════════════════════════
   13.  EXPORT
════════════════════════════════════════════════════════ */
export default class GameEngine {
  constructor() {
    wx.onTouchStart(e => onTouch(e.touches));
    phase=PH.SETUP; dirty=true;
    requestAnimationFrame(loop);
  }
}
