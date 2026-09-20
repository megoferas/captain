import { html } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';

const P = {
  home: '<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3.5v3M16 3.5v3M4 10h16"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17a2 2 0 0 1 2 2v1"/><rect x="4" y="8" width="16" height="11" rx="2.5"/><path d="M16.5 13.5H18"/>',
  file: '<path d="M7.5 3.5H14l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M9 12h6M9 15.5h4"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.5-3.2 2.8-5 5.5-5s5 1.8 5.5 5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16 14.6c2.3.2 4 1.7 4.5 4.4"/>',
  bell: '<path d="M6.5 16V11a5.5 5.5 0 0 1 11 0v5l1.5 2H5z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  pin: '<path d="M12 20.5s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10z"/><circle cx="12" cy="10.5" r="2.2"/>',
  check: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.3 2.5 2.5 4.5-5"/>',
  out: '<path d="M10 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H10M14 8l4 4-4 4M18 12H9.5"/>',
  chev: '<path d="m14.5 6-6 6 6 6"/>',
  back: '<path d="m9.5 6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  shield: '<path d="M12 3.5 5 6v5.5c0 4.2 3 7.4 7 9 4-1.6 7-4.8 7-9V6z"/><path d="m9 12 2.2 2.2L15 10"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  down: '<path d="M12 4.5v10M8 10.5l4 4 4-4M5 19.5h14"/>',
  gift: '<rect x="4" y="9" width="16" height="10.5" rx="2"/><path d="M4 13h16M12 9v10.5M12 9c-2.6 0-4-1-4-2.4S9.4 4 12 9zM12 9c2.6 0 4-1 4-2.4S14.6 4 12 9z"/>',
  sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4"/>',
  xcircle: '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>',
  auto: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5v4h-4"/><path d="M12 8.5V12l2.5 1.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  backspace: '<path d="M9.5 6H19a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9.5L4 12z"/><path d="m12.5 9.5 4 4M16.5 9.5l-4 4"/>',
  more: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
  download: '<path d="M12 4.5v10M8 10.5l4 4 4-4M5 19.5h14"/>',
  chart: '<path d="M5 19.5V11M12 19.5V5M19 19.5v-6"/>',
  edit: '<path d="M5 19l1-4L16.5 4.5a1.8 1.8 0 0 1 2.5 2.5L8.5 17.5z"/>',
  logout: '<path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9"/>',
  send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5v4h-4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  share: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};

const attrs = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

export function Icon({ name, size = 22 }) {
  return html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    dangerouslySetInnerHTML=${{ __html: P[name] || P.check }} />`;
}
export const ICON_NAMES = Object.keys(P);
