import type { CSSProperties } from 'react';
import type { Pack } from '../api.ts';
import { Icon } from './icons.tsx';

/** Width/height of a deliverable, read from its options so the tile shows the real output shape. */
export function packAspect(pack: Pack, options: Record<string, string> = {}): number {
  const pick = (k: string) => options[k] ?? pack.options.find((o) => o.key === k)?.default;
  const size = pick('aspect');
  if (size && /^\d+x\d+$/.test(size)) {
    const [w, h] = size.split('x').map(Number);
    return w / h;
  }
  const format = pick('format');
  if (format) return format === 'vertical' ? 9 / 16 : format === 'square' ? 1 : 16 / 9;
  const platform = pick('platform');
  if (platform) return platform === 'square' ? 1 : 4 / 5;
  if (pack.id === 'social-short') return 9 / 16;
  if (pack.category === 'copy') return 3 / 4;
  return 16 / 9;
}

export function PackFrame({ pack, options, height = 112 }: { pack: Pack; options?: Record<string, string>; height?: number }) {
  const ratio = packAspect(pack, options);
  const box = height * 0.72;
  const w = ratio >= 1 ? Math.min(box * ratio, height * 1.5) : box * ratio;
  const h = ratio >= 1 ? w / ratio : box;
  const I = Icon[pack.category];
  return (
    <div className="frame" style={{ '--accent': pack.accent, height } as CSSProperties} aria-hidden="true">
      <div className="frame-shape" style={{ width: w, height: h }}>
        <I />
      </div>
    </div>
  );
}
