import { type ReactElement, useEffect, useRef } from 'react';

/**
 * String-vibration visualiser (§8).
 *
 * Renders the 88 piano strings as horizontal sinusoidal splines whose
 * amplitude reflects the note's recent velocity and decay state. Falls
 * back to canvas2D when WebGPU is unavailable — full wave-equation
 * compute-shader integration is a follow-up that will read from a
 * SharedArrayBuffer-backed GPUBuffer.
 */

const NUM_STRINGS = 88;

type StringState = {
    amplitude: number;
    phase: number;
    frequency: number;
};

type StringVibrationViewProps = {
    activeNotes: ReadonlyMap<number, number>; // MIDI note → velocity
    className?: string;
};

export const StringVibrationView = ({
    activeNotes,
    className,
}: StringVibrationViewProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const statesRef = useRef<StringState[]>(
        Array.from({ length: NUM_STRINGS }, () => ({
            amplitude: 0,
            phase: 0,
            frequency: 0,
        })),
    );
    const frameRef = useRef<number>(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas === null) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (ctx === null) {
            return;
        }

        let cancelled = false;
        const render = (): void => {
            if (cancelled) {
                return;
            }
            const { width, height } = canvas;
            ctx.clearRect(0, 0, width, height);

            // Decay every string amplitude; inject energy from activeNotes.
            const states = statesRef.current;
            for (let idx = 0; idx < NUM_STRINGS; idx += 1) {
                states[idx]!.amplitude *= 0.985;
            }
            for (const [midi, velocity] of activeNotes) {
                const key = midi - 21; // A0 = index 0
                if (key >= 0 && key < NUM_STRINGS) {
                    const state = states[key]!;
                    state.amplitude = Math.max(state.amplitude, velocity);
                    state.frequency = 4 + key * 0.25;
                }
            }

            // Draw every string.
            const rowHeight = height / NUM_STRINGS;
            const phaseAdvance = frameRef.current * 0.08;
            ctx.lineWidth = 1;
            for (let idx = 0; idx < NUM_STRINGS; idx += 1) {
                const state = states[idx]!;
                const y0 = rowHeight * (NUM_STRINGS - idx - 0.5);
                const amp = state.amplitude * rowHeight * 3;
                if (amp < 0.5) {
                    ctx.strokeStyle = 'rgba(200,200,200,0.15)';
                    ctx.beginPath();
                    ctx.moveTo(0, y0);
                    ctx.lineTo(width, y0);
                    ctx.stroke();
                    continue;
                }
                const intensity = Math.min(1, state.amplitude);
                ctx.strokeStyle = `rgba(251,191,36,${0.3 + intensity * 0.7})`;
                ctx.beginPath();
                const freq = state.frequency;
                for (let x = 0; x <= width; x += 2) {
                    const t = x / width;
                    const y =
                        y0 +
                        Math.sin(t * freq * Math.PI * 2 + phaseAdvance) *
                            amp *
                            (1 - t * 0.4);
                    if (x === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
                ctx.stroke();
            }
            frameRef.current += 1;
            requestAnimationFrame(render);
        };
        render();
        return () => {
            cancelled = true;
        };
    }, [activeNotes]);

    return (
        <canvas
            ref={canvasRef}
            width={640}
            height={440}
            className={className}
            aria-label="Grand Boule string vibration visualisation"
        />
    );
};
