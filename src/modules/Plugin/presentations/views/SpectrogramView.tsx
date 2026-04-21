import { type ReactElement, useRef, useEffect } from 'react';

export const SpectrogramView = ({ isMocking = false }: { isMocking?: boolean }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // MVP Real-time GPU-style scroll simulation
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return undefined;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return undefined;
        }

        let animationId: number;
        let time = 0;

        const render = () => {
            const width = canvas.width;
            const height = canvas.height;

            // Shift everything left slightly
            ctx.drawImage(canvas, 1, 0, width - 1, height, 0, 0, width - 1, height);

            // Clear rightmost column
            ctx.fillStyle = '#09090b';
            ctx.fillRect(width - 1, 0, 1, height);

            // Draw new frequency spectrum column
            time += 0.05;

            if (isMocking) {
                for (let y = 0; y < height; y++) {
                    const noise = Math.random() * 0.1;
                    const freqScale = y / height;
                    // Mocking an energy blob in the lower-mids (bottom of canvas)
                    const energy = Math.sin(time + freqScale * 10) * Math.cos(time * 0.5) * (1.1 - freqScale);

                    if (energy > 0.6) {
                        const intensity = Math.floor((energy - 0.6) * 200 * (1.0 + noise));
                        // Colors ranging from deep blue/purple for lows up to bright yellow/white for HF peaks
                        ctx.fillStyle = `rgb(${intensity}, ${intensity * 0.4}, ${intensity * 1.5})`;
                        ctx.fillRect(width - 1, y, 1, 1);
                    }
                }
            }

            animationId = requestAnimationFrame(render);
        };

        render();

        return () => {
            cancelAnimationFrame(animationId);
        };
    }, [isMocking]);

    return (
        <div className="relative h-48 w-full overflow-hidden rounded-[18px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(84,196,255,0.16),rgba(6,8,14,0.94)_55%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <canvas ref={canvasRef} className="h-full w-full" width={600} height={200} />
            <div className="pointer-events-none absolute inset-x-3 top-3 flex items-center justify-between text-[8px] uppercase tracking-[0.24em] text-white/44">
                <span>Spectral tail</span>
                <span>{isMocking ? 'Preview' : 'Live'}</span>
            </div>
            <div className="absolute inset-x-0 bottom-0 top-auto h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>
    );
};
