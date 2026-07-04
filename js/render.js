const canvas = wx.createCanvas();
GameGlobal.canvas = canvas;

const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;

canvas.width = windowInfo.screenWidth;
canvas.height = windowInfo.screenHeight;

export { canvas };
export const WINDOW_INFO = windowInfo;
export const MENU_BUTTON = menuButton;
export const SCREEN_WIDTH = windowInfo.screenWidth;
export const SCREEN_HEIGHT = windowInfo.screenHeight;
