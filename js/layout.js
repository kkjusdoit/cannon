import { MENU_BUTTON, SCREEN_HEIGHT, SCREEN_WIDTH, WINDOW_INFO } from './render.js';

const safeArea = WINDOW_INFO.safeArea || {
  top: WINDOW_INFO.statusBarHeight || 0,
  bottom: SCREEN_HEIGHT,
  left: 0,
  right: SCREEN_WIDTH,
};

const SAFE_TOP = Math.max(0, safeArea.top || 0);
const SAFE_BOTTOM_GAP = Math.max(10, SCREEN_HEIGHT - (safeArea.bottom || SCREEN_HEIGHT));
const MENU_BOTTOM = MENU_BUTTON ? MENU_BUTTON.bottom : SAFE_TOP + 42;
const P = Math.round(Math.max(14, Math.min(22, SCREEN_WIDTH * 0.046)));
const CONTENT_X = P;
const CONTENT_W = SCREEN_WIDTH - P * 2;
const TOP_CLEAR = Math.round(Math.max(MENU_BOTTOM + 20, SAFE_TOP + 58));
const BOTTOM_CLEAR = SAFE_BOTTOM_GAP + 18;
const BOARD_LIMIT_W = CONTENT_W - 44;
const BOARD_LIMIT_H = SCREEN_HEIGHT - TOP_CLEAR - BOTTOM_CLEAR - 156;
const BS = Math.round(Math.max(252, Math.min(BOARD_LIMIT_W, BOARD_LIMIT_H, 392)));
const BX = Math.round((SCREEN_WIDTH - BS) / 2);
const CS = BS / 4;
const PR = Math.round(Math.max(15, Math.min(24, CS * 0.17)));
const TITLE_Y = SAFE_TOP + 34;
const SUBTITLE_Y = TITLE_Y + 28;
const HUD_Y = Math.round(SAFE_TOP + 10);
const HUD_H = Math.round(Math.max(52, MENU_BOTTOM - SAFE_TOP + 18));
const PLAY_CH = Math.round(Math.max(44, Math.min(50, SCREEN_HEIGHT * 0.055)));
const CONTROL_GAP = 10;
const CONTROL_W = Math.floor((CONTENT_W - CONTROL_GAP * 3) / 4);
const PRIMARY_BTN_H = Math.round(Math.max(50, SCREEN_HEIGHT * 0.068));
const PRIMARY_BTN_Y = SCREEN_HEIGHT - BOTTOM_CLEAR - PRIMARY_BTN_H - 22;
const PLAY_CTRL_Y = SCREEN_HEIGHT - BOTTOM_CLEAR - PLAY_CH - 28;
const BOARD_TOP_GAP = Math.round(Math.max(52, SCREEN_HEIGHT * 0.075));
const BOARD_BOTTOM_GAP = Math.round(Math.max(34, SCREEN_HEIGHT * 0.048));

function centeredBoardY(topBound, bottomBound) {
  const room = Math.max(0, bottomBound - topBound - BS);
  return Math.round(topBound + room / 2);
}

function getPlaceLayout() {
  const dotsGap = Math.round(SCREEN_HEIGHT * 0.068);
  const dotsY = PRIMARY_BTN_Y - 48;
  const boardBottomLimit = dotsY - dotsGap;
  const boardY = centeredBoardY(SUBTITLE_Y + BOARD_TOP_GAP, boardBottomLimit - BOARD_BOTTOM_GAP);
  return {
    boardY,
    topCampY: boardY - 16,
    bottomCampY: boardY + BS + 34,
    dotsY,
  };
}

function getPlayLayout() {
  const boardY = centeredBoardY(SUBTITLE_Y + BOARD_TOP_GAP, PLAY_CTRL_Y - BOARD_BOTTOM_GAP);
  return {
    boardY,
    controlsY: PLAY_CTRL_Y,
    topCampY: boardY - 14,
    bottomCampY: boardY + BS + 22,
  };
}

export {
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
};
