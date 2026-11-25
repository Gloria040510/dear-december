import type { ReactNode } from 'react';
const paths: Record<string, ReactNode> = {
  star: <><path d="M12 1.7c0 6.5 3.8 10.3 10.3 10.3-6.5 0-10.3 3.8-10.3 10.3 0-6.5-3.8-10.3-10.3-10.3C8.2 12 12 8.2 12 1.7Z"/><path d="M19 2v5m-2.5-2.5h5"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  pointer: <path d="m5 3 13 10-6 .7-2.9 5.3L5 3Z"/>,
  camera: <><rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 5-3v10l-5-3"/></>,
  upload: <><path d="M12 16V4m-4 4 4-4 4 4M4 15v5h16v-5"/></>,
  wave: <path d="M3 12h2l2-5 3 10 3-14 3 18 2-9h3"/>,
  play: <path d="m9 5 11 7-11 7z"/>,
  pause: <path d="M9 5v14m6-14v14"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  expand: <path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/>,
  settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="var(--icon-bg, #101612)"/><circle cx="15" cy="17" r="2" fill="var(--icon-bg, #101612)"/></>,
  download: <path d="M12 4v12m-4-4 4 4 4-4M4 17v3h16v-3"/>,
  circle: <circle cx="12" cy="12" r="5"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  palette: <><circle cx="12" cy="12" r="7"/><path d="M12 5a7 7 0 0 1 0 14z" fill="currentColor" stroke="none"/></>,
  chevron: <path d="m6 9 6 6 6-6"/>,
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
