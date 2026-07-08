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
const TUTORIAL_KEY = 'cannon_tutorial_seen_v1';
const TUTORIAL_STEPS = [
  {
    title: '第 1 步：先布阵',
    body: '在布阵页点底线的 3 个格点放置红军。点错了再点一次，可以取消该位置。',
  },
  {
    title: '第 2 步：看谁先走',
    body: '进入对局后先看顶部状态条，那里会提示当前轮到谁行动，或者电脑是否正在思考。',
  },
  {
    title: '第 3 步：先点棋子，再点落点',
    body: '先选中自己的棋子，棋盘上会出现闪动的可走位置。再点目标格，就能完成移动或攻击。',
  },
  {
    title: '第 4 步：不会下就用按钮',
    body: '右下角有提示、悔棋和新局。提示会给你下一步建议，适合第一次玩的用户。',
  },
];
let tutorialOpen = false;
let tutorialStep = 0;
let tutorialSeen = false;

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

function loadTutorialSeen() {
  try {
    if (wx.getStorageSync) {
      tutorialSeen = !!wx.getStorageSync(TUTORIAL_KEY);
    }
  } catch (e) {}
}

function markTutorialSeen() {
  tutorialSeen = true;
  try {
    if (wx.setStorageSync) wx.setStorageSync(TUTORIAL_KEY, 1);
  } catch (e) {}
}

function openTutorial(step = 0) {
  tutorialStep = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, step));
  tutorialOpen = true;
  dirty = true;
}

function closeTutorial() {
  tutorialOpen = false;
  markTutorialSeen();
  dirty = true;
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
let suppressHits = false;
function addHit(x,y,w,h,fn) {
  if (suppressHits) return;
  hits.push({x,y,w,h,fn});
}

/* Draw a rounded button with optional primary / active style */
function btn(x,y,w,h,label,sub,active,disabled,primary) {
  ctx.globalAlpha = disabled ? 0.32 : 1;
  if (primary) {
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#e85848');
    grad.addColorStop(1, '#9e2218');
    rrect(x,y,w,h,10, grad, 'rgba(255,210,120,0.45)', 1.8);
    ctx.fillStyle = C.tx;
  } else if (active) {
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#dcb04c');
    grad.addColorStop(1, '#a67b28');
    rrect(x,y,w,h,10, grad, 'rgba(255,227,142,0.68)', 1.5);
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
  ctx.fillStyle = C.gold;
  const barH = Math.round(P * 0.88);
  rrect(CONTENT_X, y - barH + 2, 3, barH, 1.5, C.gold);
  ctx.fillStyle=C.txDim; ctx.textAlign='left';
  ctx.font=`600 ${Math.round(P*.92)}px sans-serif`;
  ctx.fillText(text, CONTENT_X + 10, y);
}

function wrapText(text, x, y, maxWidth, lineHeight) {
  const lines = [];
  let line = '';
  const puncts = '，。、！？）】》；：,.!?)]>';
  
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const test = line + ch;
    
    if (ctx.measureText(test).width > maxWidth && line) {
      // If the character causing wrap is a punctuation, keep it on the current line
      if (puncts.includes(ch)) {
        line = test;
      } else {
        lines.push(line);
        line = ch;
      }
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
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
  const menuLeft = MENU_BUTTON ? MENU_BUTTON.left : SCREEN_WIDTH - 87;
  const maxCenteredW = 2 * (menuLeft - 8 - SCREEN_WIDTH / 2);
  const panelW = Math.max(180, Math.min(maxCenteredW, SCREEN_WIDTH - CONTENT_X * 2));
  const panelX = Math.round((SCREEN_WIDTH - panelW) / 2);
  rrect(panelX, HUD_Y, panelW, HUD_H, 14, 'rgba(9,16,12,0.76)', 'rgba(255,219,123,0.12)', 1);
}

function drawCampBadge(text, x, y, isRed) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  const fontSize = Math.round(Math.min(13.5, SCREEN_WIDTH * 0.032));
  ctx.font = `700 ${fontSize}px sans-serif`;
  
  const tw = ctx.measureText(text).width;
  const paddingX = 12;
  const paddingY = 5.5;
  const w = tw + paddingX * 2;
  const h = fontSize + paddingY * 2;
  const bx = x - w / 2;
  const by = y - h / 2;
  
  if (isRed) {
    rrect(bx, by, w, h, h / 2, 'rgba(126,32,27,0.85)', 'rgba(217,169,29,0.36)', 1.2);
    ctx.fillStyle = '#fcecd2';
  } else {
    rrect(bx, by, w, h, h / 2, 'rgba(38,48,32,0.85)', 'rgba(113,135,90,0.36)', 1.2);
    ctx.fillStyle = '#d5dfcc';
  }
  
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
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

  /* --- Placement zone pulsing circles (expanding ripples to guide user) --- */
  if (phase===PH.PLACE && G.placed.length<3) {
    for (let pp=0;pp<5;pp++) {
      if (!G.placed.includes(pp)) {
        const {x,y}=nxy(pp,flip,boardY);
        
        // Base pulse wave (0 to 1) for the main ring
        const wave = (Math.sin(Date.now() / 200 + pp * 0.8) + 1) / 2;
        
        // 1. Central gold node point
        ctx.beginPath(); ctx.arc(x, y, PR * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = C.gold; ctx.fill();
        
        // 2. Pulsing highlight ring
        const innerR = PR * (0.7 + wave * 0.25);
        ctx.beginPath(); ctx.arc(x, y, innerR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 214, 96, ${0.4 + wave * 0.4})`;
        ctx.lineWidth = 2.4;
        ctx.stroke();

        // 3. Expanding ripple wave (fades out as it grows)
        const t = (Date.now() / 1200 + pp * 0.2) % 1.0;
        const rippleR = PR * (0.8 + t * 1.4);
        const rippleAlpha = 0.85 * (1.0 - t);
        ctx.beginPath(); ctx.arc(x, y, rippleR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 214, 96, ${rippleAlpha})`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
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
        const targetPulse = Tm(m) ? 1.25 : 0.92;
        const ringR = PR * targetPulse * (0.9 + pulse * 0.14);
        const coreR = PR * (Tm(m) ? 0.34 : 0.2);
        const from = nxy(G.sel, flip, boardY);
        ctx.save();
        ctx.shadowColor = Tm(m) ? 'rgba(255,87,66,0.95)' : 'rgba(255,112,96,0.55)';
        ctx.shadowBlur = Tm(m) ? 16 : 10;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(x, y);
        ctx.strokeStyle = Tm(m) ? 'rgba(255,109,91,0.78)' : 'rgba(255,128,120,0.48)';
        ctx.lineWidth = Tm(m) ? 4.2 : 2.2;
        ctx.setLineDash(Tm(m) ? [8, 6] : [5, 7]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        ctx.beginPath(); ctx.arc(x,y,ringR,0,Math.PI*2);
        ctx.fillStyle=Tm(m)?'rgba(217,53,39,0.16)':'rgba(201,53,39,0.10)';
        ctx.fill();
        ctx.beginPath(); ctx.arc(x,y,ringR,0,Math.PI*2);
        ctx.strokeStyle=Tm(m)?'rgba(255,120,104,1)':'rgba(255,112,96,0.92)';
        ctx.lineWidth=Tm(m)?4:2.4;
        ctx.stroke();
        ctx.beginPath(); ctx.arc(x,y,coreR,0,Math.PI*2);
        ctx.fillStyle=Tm(m)?'rgba(255,174,162,1)':'rgba(255,132,118,0.95)';
        ctx.fill();
      } else {
        if (Tm(m)) {
          const from = nxy(G.sel, flip, boardY);
          ctx.save();
          ctx.shadowColor='rgba(255,87,66,0.95)';
          ctx.shadowBlur=16;
          ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(x, y);
          ctx.strokeStyle='rgba(255,109,91,0.78)';
          ctx.lineWidth=4;
          ctx.setLineDash([8, 6]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
          ctx.beginPath(); ctx.arc(x,y,PR*1.2,0,Math.PI*2);
          ctx.fillStyle='rgba(255,84,60,0.18)';
          ctx.fill();
          ctx.beginPath(); ctx.arc(x,y,PR*1.2,0,Math.PI*2);
          ctx.strokeStyle='rgba(255,151,129,0.98)';
          ctx.lineWidth=3.2;
          ctx.stroke();
          ctx.beginPath(); ctx.arc(x,y,PR*.34,0,Math.PI*2);
          ctx.fillStyle='rgba(255,214,145,0.98)';
          ctx.fill();
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
  const centerY = HUD_Y + HUD_H / 2;
  const titleY = Math.round(centerY - 2);
  const subtitleY = Math.round(centerY + 16);
  ctx.textAlign='center';
  ctx.font=`700 ${Math.round(Math.min(24, SCREEN_WIDTH*.08))}px sans-serif`;
  ctx.fillStyle=C.gold; ctx.fillText('童年棋趣', tx, titleY);
  ctx.font=`600 ${Math.round(Math.min(13, SCREEN_WIDTH*.03))}px sans-serif`;
  ctx.fillStyle=C.txDim; ctx.fillText('5x5 经典复古战棋', tx, subtitleY);
  const sw=Math.min(300,CONTENT_W), sh=Math.round(Math.max(50, SCREEN_HEIGHT*.064));
  const sx=(SCREEN_WIDTH-sw)/2, sy=SCREEN_HEIGHT-BOTTOM_CLEAR-sh-16;

  const contentTop = TOP_CLEAR + 48;
  const contentBottom = sy - sh - 28;
  const availableHeight = contentBottom - contentTop;

  const bh=Math.round(Math.max(46, SCREEN_HEIGHT*.057));
  const bw=(CONTENT_W-P)/2;

  let totalHeight = 0;
  const modeHeight = bh + Math.round(P * 2.2);
  if (G.mode==='pve') {
    const oneRow = (CONTENT_W-P*3)/4 >= 82;
    const dh = Math.round(bh * (oneRow ? 1.14 : 1.08));
    const diffHeight = Math.round(P * 0.7) + dh * (oneRow ? 1 : 2) + (oneRow ? 0 : Math.round(P * 0.8));
    totalHeight = modeHeight + modeHeight + diffHeight;
  } else {
    totalHeight = Math.round(P * 0.7) + bh;
  }

  let y = Math.max(contentTop, Math.round(contentTop + (availableHeight - totalHeight) / 2));

  /* Mode */
  sectionLabel('对战模式', y - Math.round(P * 0.7)); 
  btn(CONTENT_X,y,bw,bh,'人机对战',null,G.mode==='pve',false);
  btn(CONTENT_X+P+bw,y,bw,bh,'双人对局',null,G.mode==='pvp',false);
  addHit(CONTENT_X,y,bw,bh,()=>{G.mode='pve';dirty=true;});
  addHit(CONTENT_X+P+bw,y,bw,bh,()=>{G.mode='pvp';dirty=true;});
  y += bh + Math.round(P * 2.2);

  if (G.mode==='pve') {
    /* Side */
    sectionLabel('选择阵营', y - Math.round(P * 0.7));
    btn(CONTENT_X,y,bw,bh,'我执红军',null,G.side===0,false);
    btn(CONTENT_X+P+bw,y,bw,bh,'我执鬼子',null,G.side===1,false);
    addHit(CONTENT_X,y,bw,bh,()=>{G.side=0;dirty=true;});
    addHit(CONTENT_X+P+bw,y,bw,bh,()=>{G.side=1;dirty=true;});
    y += bh + Math.round(P * 2.2);

    /* Difficulty */
    sectionLabel('人工智能', y - Math.round(P * 0.7));
    const diffs=[{l:0,n:'新丁',s:'常有昏招'},{l:1,n:'老把式',s:'稳扎稳打'},
                 {l:2,n:'高手',s:'算路颇深'},{l:3,n:'神机',s:'深算十步'}];
    const oneRow = (CONTENT_W-P*3)/4 >= 82;
    const dw = oneRow ? (CONTENT_W-P*3)/4 : (CONTENT_W-P)/2;
    const dh = Math.round(bh * (oneRow ? 1.14 : 1.08));
    diffs.forEach((d,i)=>{
      const col = oneRow ? i : i % 2;
      const row = oneRow ? 0 : Math.floor(i / 2);
      const dx = CONTENT_X + col * (dw + P);
      const dy = y + row * (dh + Math.round(P * 0.8));
      btn(dx,dy,dw,dh,d.n,d.s,G.level===d.l,false);
      addHit(dx,dy,dw,dh,()=>{G.level=d.l;dirty=true;});
    });
  }

  /* Start */
  btn(sx,sy,sw,sh,'开始对局',null,false,false,'primary');
  addHit(sx,sy,sw,sh,()=>reset());

  const tw = Math.min(176, CONTENT_W * 0.52);
  const tx0 = (SCREEN_WIDTH - tw) / 2;
  btn(tx0, sy - sh - 14, tw, Math.round(sh * 0.88), '新手引导', '半分钟上手', false, false);
  addHit(tx0, sy - sh - 14, tw, Math.round(sh * 0.88), ()=>openTutorial(0));
}

/* ── PLACING ── */
function renderPlacing() {
  const flip=true; // always show Red Army at bottom during placement
  const layout = getPlaceLayout();
  drawBackdrop();
  drawHeaderPanel();

  const n=G.placed.length;
  ctx.textAlign='center';
  const centerY = HUD_Y + HUD_H / 2;
  const titleY = Math.round(centerY - 2);
  const subtitleY = Math.round(centerY + 16);
  ctx.font=`700 ${Math.round(Math.min(19, SCREEN_WIDTH*.05))}px sans-serif`;
  ctx.fillStyle=C.tx; ctx.fillText(`自定义布阵 ${n}/3`, SCREEN_WIDTH/2, titleY);
  ctx.font=`700 ${Math.round(Math.min(13.5, SCREEN_WIDTH*.036))}px sans-serif`;
  ctx.fillStyle=C.gold;
  ctx.fillText(n<3?'点击底线格点放置红军':'阵地就绪，点击确认开战', SCREEN_WIDTH/2, subtitleY);

  /* Camp labels */
  drawCampBadge('鬼子部队', SCREEN_WIDTH/2, layout.topCampY, false);
  drawCampBadge('红军主力部队', SCREEN_WIDTH/2, layout.bottomCampY, true);

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
  const bkH = Math.round(Math.max(40, HUD_H - 22));
  const bkY = HUD_Y + Math.round((HUD_H - bkH) / 2);
  btn(CONTENT_X, bkY, 72, bkH,'返回',null,false,false);
  addHit(CONTENT_X, bkY, 72, bkH, ()=>{phase=PH.SETUP;dirty=true;});
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
    tLabel = G.st.turn===0?'我方正在思考...':'对方正在思考...';
    tColor = C.gold;
  } else if (G.over) {
    const isWin = G.mode === 'pve' ? (G.over.winner === G.side) : true;
    if (G.mode === 'pvp') {
      tLabel = G.over.winner === 0 ? '🎉 红军胜利' : '🎉 鬼子胜利';
      tColor = G.over.winner === 0 ? C.red : C.oliveHi;
    } else {
      tLabel = isWin ? '🎉 我方胜利' : '💀 对方胜利';
      tColor = isWin ? (G.side === 0 ? C.red : C.oliveHi) : (G.side === 0 ? C.oliveHi : C.red);
    }
  } else {
    if (G.st.turn === 0) {
      tColor = C.red;
      if (G.mode === 'pvp') {
        tLabel = '轮到红军行动';
      } else {
        tLabel = (G.side === 0) ? '轮到我方行动' : '电脑控制对方';
      }
    } else {
      tColor = C.oliveHi;
      if (G.mode === 'pvp') {
        tLabel = '轮到鬼子行动';
      } else {
        tLabel = (G.side === 1) ? '轮到我方行动' : '电脑控制对方';
      }
    }
  }
  ctx.textAlign='center';
  const centerY = HUD_Y + HUD_H / 2;
  const titleY = Math.round(centerY - 2);
  const subtitleY = Math.round(centerY + 16);
  ctx.font=`700 ${Math.round(Math.min(19, SCREEN_WIDTH*.042))}px sans-serif`;
  ctx.fillStyle=tColor; ctx.fillText(tLabel, SCREEN_WIDTH/2, titleY);
  ctx.font=`600 ${Math.round(Math.min(12.5, SCREEN_WIDTH*.028))}px sans-serif`;
  ctx.fillStyle=C.txDim;
  ctx.fillText(`鬼子 ${sc}/15 队 · 第 ${G.hist.length} 步`, SCREEN_WIDTH/2, subtitleY);

  /* Camp labels */
  if (G.mode==='pve') {
    drawCampBadge(flip ? '敌方鬼子' : '敌方红军', SCREEN_WIDTH/2, layout.topCampY, !flip);
    drawCampBadge(flip ? '我方红军' : '我方鬼子', SCREEN_WIDTH/2, layout.bottomCampY, flip);
  } else {
    drawCampBadge('红军主力', SCREEN_WIDTH/2, layout.topCampY, true);
    drawCampBadge('鬼子部队', SCREEN_WIDTH/2, layout.bottomCampY, false);
  }

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

  const helpW = Math.min(120, CONTENT_W * 0.28);
  btn(CONTENT_X, layout.controlsY - PLAY_CH - 12, helpW, PLAY_CH, '新手引导', null, false, false);
  addHit(CONTENT_X, layout.controlsY - PLAY_CH - 12, helpW, PLAY_CH, ()=>openTutorial(0));
}

/* ── GAME OVER overlay ── */
function renderOver() {
  renderPlaying(); // draw dimmed game board as background

  /* Dark overlay */
  ctx.fillStyle='rgba(10,8,6,.84)'; ctx.fillRect(0,0,SCREEN_WIDTH,SCREEN_HEIGHT);

  const cw=Math.min(SCREEN_WIDTH - P*3, 420);
  const ch=Math.round(Math.max(380, SCREEN_HEIGHT*.48));
  const cx=(SCREEN_WIDTH-cw)/2, cy=(SCREEN_HEIGHT-ch)/2;
  rrect(cx,cy,cw,ch,16, 'rgba(22,18,14,.98)', C.gold, 1.5);

  const isWin=G.mode==='pve'?G.over.winner===G.side:true;
  ctx.textAlign='center';
  ctx.font=`700 ${Math.round(Math.min(26, SCREEN_WIDTH*.06))}px sans-serif`;
  ctx.fillStyle = isWin ? C.gold : '#e54c3c';
  ctx.fillText(isWin?'战役大捷':'战役失利', SCREEN_WIDTH/2, cy + 46);

  /* Stamp circle (rotated like an authentic ink seal) */
  const sr=Math.round(SCREEN_WIDTH*.125);
  const stampY = 138;
  const stampColor = isWin ? '#d43f33' : '#7f8c8d';
  
  ctx.save();
  ctx.translate(SCREEN_WIDTH/2, cy + stampY);
  ctx.rotate(isWin ? -0.06 : 0.08);
  ctx.beginPath(); ctx.arc(0, 0, sr, 0, Math.PI*2);
  ctx.strokeStyle = stampColor; ctx.lineWidth = 3; ctx.stroke();
  
  ctx.font = `700 ${Math.round(sr*0.84)}px sans-serif`;
  ctx.fillStyle = stampColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(isWin?'大捷':'惜败', 0, 1);
  ctx.restore();

  /* Reason */
  ctx.font=`600 ${Math.round(Math.min(15, SCREEN_WIDTH*.034))}px sans-serif`;
  ctx.fillStyle=C.tx; ctx.fillText(G.over.reason, SCREEN_WIDTH/2, cy + ch - 118);

  /* Stats */
  const cap=15-popcount(G.st.s);
  ctx.font=`600 ${Math.round(Math.min(13.5, SCREEN_WIDTH*.03))}px sans-serif`;
  ctx.fillStyle=C.txDim;
  ctx.fillText(`共走 ${G.hist.length} 步 · 消灭鬼子 ${cap}/15 队`, SCREEN_WIDTH/2, cy + ch - 92);

  /* Restart */
  const rbW=Math.min(230, cw - P*2);
  const rbH=Math.round(Math.max(44, SCREEN_HEIGHT*.058));
  const rbX=(SCREEN_WIDTH-rbW)/2;
  const rbY=cy + ch - 56;
  btn(rbX,rbY,rbW,rbH,'重整旗鼓，再来一局',null,false,false,'primary');

  // Clear board hits from renderPlaying(), only keep OVER hits
  hits=[];
  addHit(rbX,rbY,rbW,rbH,()=>{phase=PH.SETUP;dirty=true;});
}

function renderTutorial() {
  ctx.fillStyle='rgba(8,12,9,.78)';
  ctx.fillRect(0,0,SCREEN_WIDTH,SCREEN_HEIGHT);

  const cw = Math.min(SCREEN_WIDTH - P * 2, 520);
  const ch = Math.min(SCREEN_HEIGHT * 0.68, 520);
  const cx = (SCREEN_WIDTH - cw) / 2;
  const cy = (SCREEN_HEIGHT - ch) / 2;
  rrect(cx, cy, cw, ch, 16, 'rgba(17,24,18,.98)', 'rgba(214,167,46,.32)', 1.2);

  ctx.textAlign='left';
  ctx.fillStyle=C.gold;
  ctx.font=`700 ${Math.round(Math.min(28, SCREEN_WIDTH*.072))}px sans-serif`;
  ctx.fillText('新手引导', cx + P, cy + P * 1.9);

  const step = TUTORIAL_STEPS[tutorialStep];
  ctx.fillStyle=C.tx;
  ctx.font=`700 ${Math.round(Math.min(24, SCREEN_WIDTH*.06))}px sans-serif`;
  ctx.fillText(step.title, cx + P, cy + P * 3.7);
  ctx.font=`600 ${Math.round(Math.min(17.5, SCREEN_WIDTH*.046))}px sans-serif`;
  ctx.fillStyle=C.txDim;
  wrapText(step.body, cx + P, cy + P * 4.9, cw - P * 2, Math.round(P * 1.6));

  const barY = cy + ch - P * 4.8;
  const dotGap = 18;
  const startX = cx + P;
  TUTORIAL_STEPS.forEach((_, i) => {
    ctx.beginPath();
    ctx.arc(startX + i * dotGap, barY, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = i === tutorialStep ? C.red : 'rgba(255,255,255,0.22)';
    ctx.fill();
  });

  const btnY = cy + ch - P * 3.2;
  const bw = Math.floor((cw - P * 3) / 3);
  const bh = Math.round(Math.max(44, SCREEN_HEIGHT * 0.055));
  const prevX = cx + P;
  const nextX = prevX + bw + P;
  const closeX = nextX + bw + P;
  btn(prevX, btnY, bw, bh, '上一页', null, false, tutorialStep === 0);
  btn(nextX, btnY, bw, bh, tutorialStep === TUTORIAL_STEPS.length - 1 ? '开始游戏' : '下一页', null, false, false, 'primary');
  btn(closeX, btnY, bw, bh, '关闭', null, false, false);
  addHit(prevX, btnY, bw, bh, ()=>{
    if (tutorialStep > 0) tutorialStep -= 1;
    dirty = true;
  });
  addHit(nextX, btnY, bw, bh, ()=>{
    if (tutorialStep < TUTORIAL_STEPS.length - 1) {
      tutorialStep += 1;
      dirty = true;
    } else {
      closeTutorial();
    }
  });
  addHit(closeX, btnY, bw, bh, closeTutorial);
  addHit(cx, cy, cw, ch, () => {});
  addHit(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, closeTutorial);
}

/* ════════════════════════════════════════════════════════
   11.  RENDER LOOP
════════════════════════════════════════════════════════ */
let dirty = true;

function render() {
  hits=[];
  ctx.clearRect(0,0,SCREEN_WIDTH,SCREEN_HEIGHT);
  if (tutorialOpen) {
    suppressHits = true;
    drawBackdrop();
    drawHeaderPanel();
    if (G.st) {
      renderPlaying();
    } else {
      renderSetup();
    }
    suppressHits = false;
    renderTutorial();
    return;
  }
  suppressHits = false;
  switch(phase) {
    case PH.SETUP: renderSetup();  break;
    case PH.PLACE: renderPlacing();break;
    case PH.PLAY:  renderPlaying();break;
    case PH.OVER:  renderOver();   break;
  }
}

function loop() {
  if (dirty) {
    dirty = false;
    render();
  }
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
  if (tutorialOpen) {
    for (const h of hits) {
      if (tx>=h.x && tx<=h.x+h.w && ty>=h.y && ty<=h.y+h.h) { h.fn(); return; }
    }
    return;
  }
  for (const h of hits) {
    if (tx>=h.x && tx<=h.x+h.w && ty>=h.y && ty<=h.y+h.h) { h.fn(); return; }
  }
}

/* ════════════════════════════════════════════════════════
   13.  EXPORT
════════════════════════════════════════════════════════ */
export default class GameEngine {
  constructor() {
    loadTutorialSeen();
    wx.onTouchStart(e => onTouch(e.touches));
    phase=PH.SETUP; dirty=true;
    if (!tutorialSeen) {
      openTutorial(0);
    }
    requestAnimationFrame(loop);
  }
}
