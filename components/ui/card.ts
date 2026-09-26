/**
 * cardClass: genie's panel surface, themed from @webjsdev/ui.
 *
 * The helper owns only the SURFACE (radius, hairline border, background), not
 * the padding or the inner layout, because those differ per panel. Compose:
 *
 *   <div class="${cardClass()} p-5 grid gap-4">...</div>
 *
 * The kit's fuller card (header, content, footer subparts with their own
 * padding) was more than these panels use, and half-applied it left text on
 * the border. One surface, padding at the call site, no shadow.
 */
import { cn } from '#lib/utils/cn.ts';

const SURFACE = 'rounded-md border border-border bg-card text-card-foreground';

export function cardClass(extra?: string): string {
  return cn(SURFACE, extra);
}
