// generate_icons.js - run once to generate src/constants/icons.js
const fs = require('fs');
const path = require('path');

const icons = {
  watchlist_gray: '<svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="28" width="10" height="22" rx="3" fill="#55556e"/><rect x="23" y="18" width="10" height="32" rx="3" fill="#55556e"/><rect x="40" y="8" width="10" height="42" rx="3" fill="#55556e"/></svg>',
  watchlist_active: '<svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="28" width="10" height="22" rx="3" fill="#9B8CFF"/><rect x="23" y="18" width="10" height="32" rx="3" fill="#9B8CFF"/><rect x="40" y="8" width="10" height="42" rx="3" fill="#9B8CFF"/></svg>',
  search_gray: '<svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="14" stroke="#55556e" stroke-width="5"/><path d="M34 34L48 48" stroke="#55556e" stroke-width="5" stroke-linecap="round"/></svg>',
  search_active: '<svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="14" stroke="#9B8CFF" stroke-width="5"/><path d="M34 34L48 48" stroke="#9B8CFF" stroke-width="5" stroke-linecap="round"/></svg>',
  profile_gray: '<svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="28" cy="18" r="10" stroke="#55556e" stroke-width="5"/><path d="M8 48c0-10 9-18 20-18s20 8 20 18" stroke="#55556e" stroke-width="5" stroke-linecap="round"/></svg>',
  profile_active: '<svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="28" cy="18" r="10" stroke="#9B8CFF" stroke-width="5"/><path d="M8 48c0-10 9-18 20-18s20 8 20 18" stroke="#9B8CFF" stroke-width="5" stroke-linecap="round"/></svg>'
};

const entries = Object.entries(icons).map(([k, v]) => {
  const b64 = Buffer.from(v).toString('base64');
  return `  ${k}: "data:image/svg+xml;base64,${b64}"`;
});

const outDir = path.join(__dirname, 'src', 'constants');
fs.mkdirSync(outDir, { recursive: true });
const output = `export const TAB_ICONS = {\n${entries.join(',\n')}\n}\n`;
fs.writeFileSync(path.join(outDir, 'icons.js'), output);
console.log('Icons generated successfully!');
