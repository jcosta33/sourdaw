/**
 * ModulationLFO — Canvas2D animated LFO waveform preview.
 *
 * Draws the modulation waveform for time-based effects
 * (Chorus, Flanger, Phaser, Tremolo, Auto-Pan).
 * Supports sine, triangle, and square shapes.
 * Animates at the actual LFO rate for a "living" feel.
 */
import { type ReactElement, useRef, useEffect } from 'react';

import { resolveToken } from '#/utils/UI/resolveToken';

type ModulationLFOProps = {
    rate: number; // Hz
    depth: number; // 0–1 (normalized)
    shape?: 'sine' | 'triangle' | 'square';
    width?: number;
    height?: number;
};

const lfoValue = (phase: number, shape: string): number => {
    const param = ((phase % 1) + 1) % 1; // normalize to 0–1
    switch (shape) {
        case 'square':
            return param < 0.5 ? 1 : -1;
        case 'triangle':
            return param < 0.5 ? param * 4 - 1 : 3 - param * 4;
        default: // sine
            return Math.sin(param * Math.PI * 2);
    }
};

export const ModulationLFO = ({
    rate,
    depth,
    shape = 'sine',
    width = 200,
    height = 60,
}: ModulationLFOProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animRef = useRef<number>(0);
    // Phase carried across effect re-runs. The effect restarts on every
    // rate/depth/shape change, and a clock restarted at each re-run snapped the
    // waveform back to phase zero mid-knob-turn; advancing the accumulated
    // phase at the current rate instead bends the curve through the change.
    const phaseRef = useRef(0);
    const lastFrameRef = useRef<number | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return () => {};
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return () => {};
        }

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        // Resolve theme tokens once, outside the animation loop
        const bg = resolveToken('--color-bg-tray', '#0a0a0a');
        const accentMint = resolveToken('--color-accent-mint', '#68d391');
        const textDisabled = resolveToken('--color-text-disabled', '#3a3a3a');

        const draw = (now: number): void => {
            const lastFrame = lastFrameRef.current;
            if (lastFrame === null) {
                // First frame anchors the clock; phase starts where the previous
                // effect run left it, so a parameter change never snaps the wave.
                lastFrameRef.current = now;
            } else {
                // rAF timestamps are monotonic in a live page; the clamp keeps a
                // mocked or reset clock from rewinding the phase with it.
                phaseRef.current += (Math.max(0, now - lastFrame) / 1000) * rate;
                lastFrameRef.current = now;
            }
            const phaseOffset = phaseRef.current; // animated phase
            ctx.clearRect(0, 0, width, height);

            // Background
            ctx.fillStyle = bg;
            ctx.beginPath();
            ctx.roundRect(0, 0, width, height, 4);
            ctx.fill();

            const centerY = height / 2;
            const amplitude = (height / 2 - 4) * Math.min(depth, 1);

            // Center line
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(0, centerY);
            ctx.lineTo(width, centerY);
            ctx.stroke();

            // Draw 2 full cycles of the waveform
            const cyclesVisible = 2;

            ctx.beginPath();
            for (let index = 0; index <= width; index++) {
                const normalizedX = index / width;
                const phase = normalizedX * cyclesVisible + phaseOffset;
                const val = lfoValue(phase, shape);
                const y = centerY - val * amplitude;
                if (index === 0) {
                    ctx.moveTo(index, y);
                } else {
                    ctx.lineTo(index, y);
                }
            }
            ctx.strokeStyle = accentMint;
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Fill under curve (subtle)
            ctx.beginPath();
            ctx.moveTo(0, centerY);
            for (let index = 0; index <= width; index++) {
                const normalizedX = index / width;
                const phase = normalizedX * cyclesVisible + phaseOffset;
                const val = lfoValue(phase, shape);
                const y = centerY - val * amplitude;
                ctx.lineTo(index, y);
            }
            ctx.lineTo(width, centerY);
            ctx.closePath();
            ctx.fillStyle = `${accentMint}10`;
            ctx.fill();

            // Current position marker (vertical line)
            const currentPhase = phaseOffset % cyclesVisible;
            const markerX = (currentPhase / cyclesVisible) * width;
            if (markerX >= 0 && markerX <= width) {
                const markerVal = lfoValue(phaseOffset, shape);
                const markerY = centerY - markerVal * amplitude;
                ctx.beginPath();
                ctx.arc(markerX, markerY, 2.5, 0, Math.PI * 2);
                ctx.fillStyle = accentMint;
                ctx.fill();
            }

            // Rate label
            ctx.fillStyle = textDisabled;
            ctx.font = '7px monospace';
            ctx.textAlign = 'right';
            ctx.fillText(`${rate.toFixed(1)} Hz`, width - 4, height - 3);

            animRef.current = requestAnimationFrame(draw);
        };

        animRef.current = requestAnimationFrame(draw);

        return () => {
            cancelAnimationFrame(animRef.current);
        };
    }, [rate, depth, shape, width, height]);

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height }}
            className="rounded border border-border/30"
            aria-label={`LFO modulation: ${shape} at ${rate.toFixed(1)} Hz`}
            role="img"
        />
    );
};
