/**
 * Stereo Goniometer (Lissajous) component.
 * X-Y oscilloscope showing L+R vs L-R with phosphor glow decay.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { audioEngine } from '#/modules/AudioEngine/repositories/audioEngineInstance';
import { resolveToken } from '#/helpers/UI/resolveToken';

type GoniometerProps = {
    size?: number;
    color?: string;
};

export const Goniometer = ({ size = 120, color = resolveToken('--color-accent-lavender', '#a89bc4') }: GoniometerProps): ReactElement => {
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
            const analyser = audioEngine.masterAnalyser;
            const data = new Float32Array(analyser.frequencyBinCount);
            analyser.getFloatTimeDomainData(data);

            // Phosphor decay: fade previous frame
            if (trailRef.current) {
                ctx.putImageData(trailRef.current, 0, 0);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
                ctx.fillRect(0, 0, size, size);
            } else {
                ctx.fillStyle = resolveToken('--color-bg-tray', '#0a0a0a');
                ctx.fillRect(0, 0, size, size);
            }

            const cx = size / 2;
            const cy = size / 2;
            const scale = size * 0.35;

            // Axis lines (rotated 45°)
            ctx.strokeStyle = resolveToken('--color-bg-panelRaised', '#1a1a1a');
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

            // Draw Lissajous pattern
            // Simulate stereo from mono: L = data, R = slightly shifted data
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.6;

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

            // Save frame for phosphor trail
            trailRef.current = ctx.getImageData(0, 0, size, size);

            // Labels
            ctx.fillStyle = resolveToken('--color-text-disabled', '#3a3a3a');
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
        <canvas
            ref={canvasRef}
            width={size}
            height={size}
            className="rounded border border-border/30"
            aria-label="Stereo goniometer"
            role="img"
        />
    );
};
