import { cn } from '../../utils/cn';
import { LOGO_SRC } from '../../utils/brand';

/**
 * Club logo.
 *
 * The source is a 640x640 opaque JPEG, so the box is always square and the
 * image uses object-contain. `size` sets both dimensions together, which makes
 * accidental distortion impossible at the call site.
 */
export function GymLogo({ size = 40, className, frameClassName, alt = 'Be Smart Fitness Club' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center overflow-hidden rounded-xl shrink-0 bg-white',
        frameClassName
      )}
      style={{ width: size, height: size }}
    >
      <img
        src={LOGO_SRC}
        alt={alt}
        width={size}
        height={size}
        className={cn('w-full h-full object-contain', className)}
        draggable="false"
      />
    </span>
  );
}
