import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * Kye Phel (སྐྱེ་འཕེལ་, "growth and flourishing") logo on a white tile, so the green mark stays
 * readable in both light and dark themes. Served from /public, never fetched from the internet.
 */
export function BrandMark({
  className,
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-white p-1',
        className,
      )}
    >
      <Image
        src="/brand/kyephel-logo.png"
        alt="Kye Phel logo"
        width={512}
        height={475}
        priority={priority}
        className="h-full w-auto object-contain"
      />
    </span>
  );
}
