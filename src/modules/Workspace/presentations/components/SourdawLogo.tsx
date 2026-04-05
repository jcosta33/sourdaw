import { type ReactElement } from 'react';

/**
 * Animated Sourdaw logo — the real bread icon split into layers.
 *
 * The loaf is the original raster artwork (pixel-perfect).
 * The surrounding bars and dots are individual raster pieces
 * that pop in, float away, and fade out like sound particles.
 *
 * All images are pre-extracted from the 480×480 icon into /public/logo-parts/.
 * The original canvas is 480×480; all positions are in that coordinate space.
 */

type SourdawLogoProps = {
    className?: string;
    /** Show static (no animation) */
    paused?: boolean;
};

type ParticleDef = {
    /** Filename in /logo-parts/ */
    src: string;
    /** Position in 480×480 canvas space */
    x: number;
    y: number;
    w: number;
    h: number;
    /** Float direction: 'up' or 'down' */
    dir: 'up' | 'down';
    /** Stagger delay (seconds) */
    delay: number;
    /** Animation cycle duration (seconds) */
    duration: number;
};

// Loaf position in the 480×480 canvas
const LOAF = { src: '/logo-parts/loaf.png', x: 66, y: 176, w: 345, h: 164 };

// All particles with hand-tuned stagger timing
// Organized ring-by-ring outward from center for natural wave effect
const PARTICLES: ParticleDef[] = [
    // ── Top particles (float upward) ──
    // Center column
    { src: '/logo-parts/p01.png', x: 228, y: 102, w: 21, h: 48, dir: 'up', delay: 0.0, duration: 3.0 },
    { src: '/logo-parts/p05.png', x: 228, y: 56, w: 21, h: 38, dir: 'up', delay: 0.5, duration: 3.4 },
    { src: '/logo-parts/p16.png', x: 229, y: 24, w: 20, h: 20, dir: 'up', delay: 1.0, duration: 3.8 },

    // Inner pair
    { src: '/logo-parts/p07.png', x: 187, y: 93, w: 21, h: 32, dir: 'up', delay: 0.2, duration: 2.8 },
    { src: '/logo-parts/p12.png', x: 188, y: 134, w: 20, h: 20, dir: 'up', delay: 0.7, duration: 2.6 },
    { src: '/logo-parts/p30.png', x: 188, y: 75, w: 20, h: 10, dir: 'up', delay: 1.2, duration: 3.2 },
    { src: '/logo-parts/p08.png', x: 269, y: 93, w: 20, h: 32, dir: 'up', delay: 0.3, duration: 2.8 },
    { src: '/logo-parts/p11.png', x: 269, y: 134, w: 20, h: 21, dir: 'up', delay: 0.8, duration: 2.6 },
    { src: '/logo-parts/p29.png', x: 269, y: 74, w: 20, h: 12, dir: 'up', delay: 1.3, duration: 3.2 },

    // Middle pair
    { src: '/logo-parts/p03.png', x: 152, y: 122, w: 20, h: 41, dir: 'up', delay: 0.4, duration: 3.0 },
    { src: '/logo-parts/p19.png', x: 152, y: 78, w: 20, h: 19, dir: 'up', delay: 0.9, duration: 3.4 },
    { src: '/logo-parts/p31.png', x: 155, y: 105, w: 17, h: 10, dir: 'up', delay: 1.5, duration: 3.6 },
    { src: '/logo-parts/p04.png', x: 305, y: 123, w: 20, h: 40, dir: 'up', delay: 0.4, duration: 3.0 },
    { src: '/logo-parts/p18.png', x: 305, y: 78, w: 20, h: 20, dir: 'up', delay: 1.0, duration: 3.4 },
    { src: '/logo-parts/p32.png', x: 305, y: 105, w: 16, h: 9, dir: 'up', delay: 1.6, duration: 3.6 },

    // Outer pair
    { src: '/logo-parts/p06.png', x: 112, y: 140, w: 20, h: 38, dir: 'up', delay: 0.6, duration: 3.2 },
    { src: '/logo-parts/p15.png', x: 113, y: 113, w: 20, h: 19, dir: 'up', delay: 1.1, duration: 3.6 },
    { src: '/logo-parts/p02.png', x: 344, y: 126, w: 20, h: 52, dir: 'up', delay: 0.7, duration: 3.2 },

    // Extreme dots (flanking the loaf)
    { src: '/logo-parts/p22.png', x: 77, y: 170, w: 20, h: 19, dir: 'up', delay: 1.4, duration: 3.8 },
    { src: '/logo-parts/p21.png', x: 380, y: 170, w: 19, h: 19, dir: 'up', delay: 1.4, duration: 3.8 },

    // ── Bottom particles (float downward) ──
    // Center column
    { src: '/logo-parts/p00.png', x: 228, y: 364, w: 21, h: 87, dir: 'down', delay: 0.1, duration: 3.2 },

    // Inner columns
    { src: '/logo-parts/p28.png', x: 188, y: 364, w: 21, h: 12, dir: 'down', delay: 0.3, duration: 2.6 },
    { src: '/logo-parts/p25.png', x: 188, y: 384, w: 20, h: 16, dir: 'down', delay: 0.6, duration: 2.8 },
    { src: '/logo-parts/p26.png', x: 188, y: 409, w: 20, h: 16, dir: 'down', delay: 0.9, duration: 3.0 },
    { src: '/logo-parts/p27.png', x: 268, y: 364, w: 21, h: 12, dir: 'down', delay: 0.3, duration: 2.6 },
    { src: '/logo-parts/p23.png', x: 269, y: 384, w: 20, h: 16, dir: 'down', delay: 0.7, duration: 2.8 },
    { src: '/logo-parts/p24.png', x: 268, y: 408, w: 21, h: 17, dir: 'down', delay: 1.0, duration: 3.0 },

    // Middle bars + dots
    { src: '/logo-parts/p09.png', x: 152, y: 364, w: 20, h: 28, dir: 'down', delay: 0.5, duration: 2.9 },
    { src: '/logo-parts/p14.png', x: 152, y: 405, w: 20, h: 19, dir: 'down', delay: 1.0, duration: 3.3 },
    { src: '/logo-parts/p10.png', x: 305, y: 364, w: 20, h: 28, dir: 'down', delay: 0.5, duration: 2.9 },
    { src: '/logo-parts/p13.png', x: 305, y: 405, w: 20, h: 20, dir: 'down', delay: 1.0, duration: 3.3 },

    // Outer dots
    { src: '/logo-parts/p17.png', x: 113, y: 365, w: 20, h: 19, dir: 'down', delay: 1.2, duration: 3.5 },
    { src: '/logo-parts/p20.png', x: 344, y: 365, w: 19, h: 19, dir: 'down', delay: 1.2, duration: 3.5 },
];

// Canvas dimensions (original icon space)
const CANVAS_W = 480;
const CANVAS_H = 480;

export const SourdawLogo = ({ className, paused }: SourdawLogoProps): ReactElement => {
    // Generate unique animation names once per render (React Compiler memoizes automatically)
    const styleBlock = paused
        ? ''
        : PARTICLES.map((_, i) => {
              const p = PARTICLES[i]!;
              const dist = p.dir === 'up' ? -20 : 20;
              return `
@keyframes sdl-p${i} {
  0% { opacity: 0; transform: translateY(0) scale(0.4); }
  12% { opacity: 1; transform: translateY(0) scale(1); }
  65% { opacity: 0.8; transform: translateY(${dist * 0.6}px) scale(0.95); }
  100% { opacity: 0; transform: translateY(${dist}px) scale(0.5); }
}`;
          }).join('\n');

    return (
        <div
            className={className}
            style={{ position: 'relative', aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
            role="img"
            aria-label="Sourdaw logo"
        >
            {/* Inject keyframes */}
            {!paused && <style>{styleBlock}</style>}

            {/* Bread loaf — the hero, always static and crisp */}
            <img
                src={LOAF.src}
                alt=""
                draggable={false}
                style={{
                    position: 'absolute',
                    left: `${(LOAF.x / CANVAS_W) * 100}%`,
                    top: `${(LOAF.y / CANVAS_H) * 100}%`,
                    width: `${(LOAF.w / CANVAS_W) * 100}%`,
                    height: `${(LOAF.h / CANVAS_H) * 100}%`,
                    imageRendering: 'auto',
                }}
            />

            {/* Animated particles — each is the real raster piece */}
            {PARTICLES.map((p, i) => (
                <img
                    key={i}
                    src={p.src}
                    alt=""
                    draggable={false}
                    style={{
                        position: 'absolute',
                        left: `${(p.x / CANVAS_W) * 100}%`,
                        top: `${(p.y / CANVAS_H) * 100}%`,
                        width: `${(p.w / CANVAS_W) * 100}%`,
                        height: `${(p.h / CANVAS_H) * 100}%`,
                        imageRendering: 'auto',
                        ...(paused
                            ? { opacity: 1 }
                            : {
                                  opacity: 0,
                                  animation: `sdl-p${i} ${p.duration}s ease-in-out ${p.delay}s infinite`,
                              }),
                    }}
                />
            ))}
        </div>
    );
};
