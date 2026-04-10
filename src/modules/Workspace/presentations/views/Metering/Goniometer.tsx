/**
 * Stereo Goniometer (Lissajous) component.
 * X-Y oscilloscope showing L+R vs L-R with phosphor glow decay.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { DawMeterFrame } from '#/components/daw/DawMeterFrame';
import { getMasterAnalyser } from '#/modules/AudioEngine';
import { resolveToken } from '#/helpers/UI/resolveToken';

type GoniometerProps = {
    size?: number;
    color?: string;
};

export const Goniometer = ({
    size = 120,
    color = resolveToken('--color-accent-lavender', '#a89bc4'),
}: GoniometerProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const trailRef = useRef<ImageData | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
            return;
        }

        let rafId = 0;

        const draw = (): void => {
            const analyser = getMasterAnalyser();
            const data = new Float32Array(analyser.frequencyBinCount);
            analyser.getFloatTimeDomainData(data);

            // Phosphor decay: fade previous frame
            if (trailRef.current) {
                ctx.putImageData(trailRef.current, 0, 0);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.10)';
                ctx.fillRect(0, 0, size, size);
            } else {
                ctx.fillStyle = '#050508';
                ctx.fillRect(0, 0, size, size);
            }

            const cx = size / 2;
            const cy = size / 2;
            const scale = size * 0.35;

            // Circular boundary — dim ring
            ctx.strokeStyle = 'rgba(255,255,255,0.04)';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.arc(cx, cy, scale, 0, Math.PI * 2);
            ctx.stroke();

            // Axis lines (rotated 45°) — subtle dashed grid
            ctx.setLineDash([2, 4]);
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 0.5;

            // L axis (top-left to bottom-right)
            ctx.beginPath();
            ctx.moveTo(cx - scale, cy - scale);
            ctx.lineTo(cx + scale, cy + scale);
            ctx.stroke();

            // R axis (top-right to bottom-left)
            ctx.beginPath();
            ctx.moveTo(cx + scale, cy - scale);
            ctx.lineTo(cx - scale, cy + scale);
            ctx.stroke();

            // Center cross
            ctx.beginPath();
            ctx.moveTo(cx, cy - scale);
            ctx.lineTo(cx, cy + scale);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx - scale, cy);
            ctx.lineTo(cx + scale, cy);
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw Lissajous pattern — bright signal traces with glow
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 6;
            ctx.globalAlpha = 0.7;

            const halfLen = Math.floor(data.length / 2);
            for (let i = 0; i < halfLen; i++) {
                const L = data[i * 2] ?? 0;
                const R = data[i * 2 + 1] ?? 0;

                // Rotate 45°: M = (L+R)/√2, S = (L-R)/√2
                const m = (L + R) * 0.7071;
                const s = (L - R) * 0.7071;

                const px = cx + s * scale;
                const py = cy - m * scale;

                ctx.fillRect(px, py, 1.5, 1.5);
            }

            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;

            // Save frame for phosphor trail
            trailRef.current = ctx.getImageData(0, 0, size, size);

            // Labels — dim and refined
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.font = '8px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('M', cx, 10);
            ctx.fillText('S', size - 8, cy + 3);
            ctx.fillText('L', 8, 10);
            ctx.fillText('R', size - 8, 10);

            rafId = requestAnimationFrame(draw);
        };

        draw();
        return () => cancelAnimationFrame(rafId);
    }, [size, color]);

    return (
        <DawMeterFrame overlay="radial">
            <canvas
                ref={canvasRef}
                width={size}
                height={size}
                className="block"
                aria-label="Stereo goniometer"
                role="img"
            />
        </DawMeterFrame>
    );
};
