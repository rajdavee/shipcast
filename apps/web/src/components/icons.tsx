// Small stroke icons, drawn for Shipcast.
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const Icon = {
  video: () => (
    <svg viewBox="0 0 24 24" {...P}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></svg>
  ),
  motion: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M4 18c3-9 6-12 9-6s5 3 7-6" /><circle cx="4" cy="18" r="1.5" /><circle cx="20" cy="6" r="1.5" /></svg>
  ),
  design: () => (
    <svg viewBox="0 0 24 24" {...P}><rect x="4" y="3" width="12" height="15" rx="1.5" /><path d="M8 21h11a1 1 0 001-1V7" /></svg>
  ),
  copy: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M5 6h14M5 11h14M5 16h9" /></svg>
  ),
  check: () => (
    <svg viewBox="0 0 24 24" width="13" height="13" {...P} strokeWidth={3}><path d="M5 12l5 5 9-10" /></svg>
  ),
  claude: () => (
    <svg viewBox="0 0 24 24" width="22" height="22" {...P}><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" /></svg>
  ),
  github: () => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2a10 10 0 00-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.6 9.6 0 015 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0012 2z" /></svg>
  ),
  tools: () => (
    <svg viewBox="0 0 24 24" width="22" height="22" {...P}><path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" /></svg>
  ),
};

/** Navigation and shell icons: 20px stroke glyphs, sized by CSS. */
export const Nav = {
  create: () => (
    <svg viewBox="0 0 24 24" {...P}><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M12 8v8M8 12h8" /></svg>
  ),
  calendar: () => (
    <svg viewBox="0 0 24 24" {...P}><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="M8 14h2M14 14h2M8 17h2" /></svg>
  ),
  library: () => (
    <svg viewBox="0 0 24 24" {...P}><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></svg>
  ),
  ideas: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 00-3.5 10.9c.6.4 1 1.1 1 1.9V16h5v-.2c0-.8.4-1.5 1-1.9A6 6 0 0012 3z" /></svg>
  ),
  brand: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M4 12v0M8 8v8M12 5v14M16 9v6M20 11v2" /></svg>
  ),
  insights: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M4 20V4M4 20h16" /><path d="M8 15l4-4 3 3 5-6" /></svg>
  ),
  settings: () => (
    <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></svg>
  ),
  search: () => (
    <svg viewBox="0 0 24 24" {...P}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
  ),
  sun: () => (
    <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></svg>
  ),
  moon: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" /></svg>
  ),
  system: () => (
    <svg viewBox="0 0 24 24" {...P}><rect x="3" y="4" width="18" height="12.5" rx="2.5" /><path d="M8.5 20.5h7M12 16.5v4" /></svg>
  ),
  panel: () => (
    <svg viewBox="0 0 24 24" {...P}><rect x="3.5" y="4" width="17" height="16" rx="3" /><path d="M9.5 4v16" /></svg>
  ),
  menu: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
  ),
  close: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M6 6l12 12M18 6L6 18" /></svg>
  ),
  project: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M3.5 7.5a2 2 0 012-2h4l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2h-13a2 2 0 01-2-2z" /></svg>
  ),
  bolt: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" /></svg>
  ),
  enter: () => (
    <svg viewBox="0 0 24 24" {...P}><path d="M19 5v6a3 3 0 01-3 3H6M10 10l-4 4 4 4" /></svg>
  ),
};

export function Mark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--brand)" />
      <path d="M9 21.5c2.2 1.6 4.5 2.4 7 2.4 3.4 0 5.6-1.6 5.6-4 0-2.2-1.6-3.2-5-4l-1.6-.4c-2-.5-2.8-1-2.8-2 0-1.1 1.1-1.8 2.9-1.8 1.8 0 3.4.6 4.9 1.7l1.6-2.5c-1.8-1.4-4-2.1-6.5-2.1-3.4 0-5.7 1.7-5.7 4.3 0 2.3 1.5 3.4 5 4.2l1.6.4c2 .5 2.7 1 2.7 2 0 1.2-1.2 1.9-3 1.9-2.1 0-4-.8-5.6-2.1z" fill="#fff" />
      <circle cx="25" cy="7" r="3" fill="var(--live)" />
    </svg>
  );
}
