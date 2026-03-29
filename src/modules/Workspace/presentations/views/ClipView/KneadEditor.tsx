import { type ReactElement, useRef, useEffect, useSyncExternalStore } from 'react';
import { kneadStore } from '#/modules/Knead/stores/kneadStore';

export const KneadEditor = ({ trackId, clipId: _clipId }: { trackId: string; clipId: string }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const kneadState = useSyncExternalStore(
        (cb) => kneadStore.subscribe(() => cb()),
        () => kneadStore.value?.tracks[trackId],
        () => kneadStore.value?.tracks[trackId]
    );

    // Render loop for the Canvas-based Blob Editor
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;

        const render = () => {
            const width = canvas.width;
            const height = canvas.height;

            // Clear background
            ctx.fillStyle = 'var(--color-surface-sunken)';
            ctx.fillRect(0, 0, width, height);

            // Draw Piano Roll horizontal grid lanes
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 1;
            const rowHeight = 24;
            for (let y = 0; y < height; y += rowHeight) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
            }

            // Draw Knead Blobs
            if (kneadState && kneadState.blobs.length > 0) {
                for (const blob of kneadState.blobs) {
                    // Map time to X
                    const x = (blob.startTime) * 100; // 100px per second scaling placeholder
                    const w = (blob.endTime - blob.startTime) * 100;
                    
                    // Map cents to Y
                    // Assume center of canvas is A4 (6900 cents)
                    const y = height / 2 - ((blob.pitchCenterCents - 6900) / 100) * rowHeight;
                    
                    // Draw outer blob shape
                    ctx.fillStyle = 'var(--color-accent-orange)';
                    ctx.globalAlpha = blob.voicedConfidence > 0.5 ? 0.8 : 0.3;
                    ctx.beginPath();
                    ctx.roundRect(x, y - rowHeight / 2 + 2, w, rowHeight - 4, 4);
                    ctx.fill();
                    
                    // Draw internal pitch curve
                    if (blob.pitchCurveCents.length > 0) {
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 2;
                        ctx.globalAlpha = 1.0;
                        ctx.beginPath();
                        const step = w / blob.pitchCurveCents.length;
                        for (let i = 0; i < blob.pitchCurveCents.length; i++) {
                            const px = x + i * step;
                            const py = y - (blob.pitchCurveCents[i]! / 100) * rowHeight;
                            if (i === 0) ctx.moveTo(px, py);
                            else ctx.lineTo(px, py);
                        }
                        ctx.stroke();
                    }
                }
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.4)';
                ctx.font = '12px var(--font-sans)';
                ctx.textAlign = 'center';
                ctx.fillText('No pitch data analyzed.', width / 2, height / 2);
            }

            animationFrameId = requestAnimationFrame(render);
        };

        render();

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [kneadState]);

    useEffect(() => {
        const resizeCanvas = () => {
            if (canvasRef.current) {
                const parent = canvasRef.current.parentElement;
                if (parent) {
                    canvasRef.current.width = parent.clientWidth;
                    canvasRef.current.height = parent.clientHeight;
                }
            }
        };
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        return () => window.removeEventListener('resize', resizeCanvas);
    }, []);

    return (
        <div className="flex-1 w-full h-full relative bg-surface-sunken overflow-hidden">
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full cursor-crosshair" />
        </div>
    );
};
