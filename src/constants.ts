export const CHROME_PATHS = [
  //   "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  //   "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome-stable",
];

export const BASE_PORT = 9222;

export const URLBlockPatterns = [
  "*.mp4",
  "*.pdf",
  "*.jpg",
  "*.jpeg",
  "*.png",
  "*.gif",
  "*.webp",
  "*.ico",
  "*.woff",
  "*.woff2",
  "*.ttf",
  "*google*",
  "*.bmp",
  "*.tiff",
  "*.svg",
  "*stripe*",
];

export const TARGET_URL_BASE = "https://endicia.com";
export const TARGET_URL_LOGIN = "https://print.endicia.com/SignIn/Default.aspx";
export const TARGET_URL_PRINT =
  "https://print.endicia.com/Webpostage/default2.aspx#";

export const SELECTORS = {
  USERNAME_INPUT: `input[type="text"][placeholder="USERNAME"]`,
  PASSWORD_INPUT: `input[type="password"][placeholder="PASSWORD"]`,
  LOGIN_BUTTON: `a.signin-button`,
  ACCOUNT_BALANCE: `span.postageBalanceAmt`
};

export const SESSION_MINUTES_EXPIRY = 20;
