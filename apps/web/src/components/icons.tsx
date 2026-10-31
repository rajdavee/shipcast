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

export function Mark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M9 21.5c2.2 1.6 4.5 2.4 7 2.4 3.4 0 5.6-1.6 5.6-4 0-2.2-1.6-3.2-5-4l-1.6-.4c-2-.5-2.8-1-2.8-2 0-1.1 1.1-1.8 2.9-1.8 1.8 0 3.4.6 4.9 1.7l1.6-2.5c-1.8-1.4-4-2.1-6.5-2.1-3.4 0-5.7 1.7-5.7 4.3 0 2.3 1.5 3.4 5 4.2l1.6.4c2 .5 2.7 1 2.7 2 0 1.2-1.2 1.9-3 1.9-2.1 0-4-.8-5.6-2.1z" fill="#fff" />
      <circle cx="25" cy="7" r="3" fill="var(--live)" />
    </svg>
  );
}
