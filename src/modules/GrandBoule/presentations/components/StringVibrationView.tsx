import { type ReactElement, useEffect, useRef } from 'react';

/** String-vibration visualiser with a WebGPU compute shader and Canvas2D fallback. */

const NUM_STRINGS = 88;
const DECAY = 0.985;
const SYM_RANGE = 3;
const SYM_GAIN = 0.15;

type StringVibrationViewProps = {
    activeNotes: ReadonlyMap<number, number>;
    className?: string;
};

// ── Canvas2D renderer ─────────────────────────────────────────────────

type StringState = { amplitude: number; phase: number; frequency: number };

/** Render a single Canvas2D frame. Called from the component's rAF loop
 *  so activeNotes is always read fresh via ref. The 2D context is taken
 *  from the caller — fetching it inside the rAF body would re-resolve
 *  the same context object on every frame. */
function runCanvas2DFrame(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    activeNotes: ReadonlyMap<number, number>,
    states: StringState[],
    frameRef: { current: number }
): void {
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < NUM_STRINGS; i += 1) {
        states[i]!.amplitude *= DECAY;
    }
    for (const [midi, velocity] of activeNotes) {
        const key = midi - 21;
        if (key >= 0 && key < NUM_STRINGS) {
            states[key]!.amplitude = Math.max(states[key]!.amplitude, velocity);
            states[key]!.frequency = 4 + key * 0.25;
            for (let d = -SYM_RANGE; d <= SYM_RANGE; d += 1) {
                const neighbor = key + d;
                if (d !== 0 && neighbor >= 0 && neighbor < NUM_STRINGS) {
                    const boost = velocity * SYM_GAIN * (1 - Math.abs(d) / (SYM_RANGE + 1));
                    states[neighbor]!.amplitude = Math.max(states[neighbor]!.amplitude, boost);
                    states[neighbor]!.frequency = 4 + neighbor * 0.25;
                }
            }
        }
    }

    const rowH = height / NUM_STRINGS;
    const phaseAdv = frameRef.current * 0.08;
    ctx.lineWidth = 1;
    for (let i = 0; i < NUM_STRINGS; i += 1) {
        const s = states[i]!;
        const y0 = rowH * (NUM_STRINGS - i - 0.5);
        const amp = s.amplitude * rowH * 3;
        if (amp < 0.5) {
            ctx.strokeStyle = 'rgba(200,200,200,0.15)';
            ctx.beginPath();
            ctx.moveTo(0, y0);
            ctx.lineTo(width, y0);
            ctx.stroke();
            continue;
        }
        const intensity = Math.min(1, s.amplitude);
        ctx.strokeStyle = `rgba(220,220,220,${0.3 + intensity * 0.7})`;
        ctx.beginPath();
        for (let x = 0; x <= width; x += 2) {
            const t = x / width;
            const y = y0 + Math.sin(t * s.frequency * Math.PI * 2 + phaseAdv) * amp * (1 - t * 0.4);
            if (x === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
    }
    frameRef.current += 1;
}

// ── Component ─────────────────────────────────────────────────────────

export const StringVibrationView = ({ activeNotes, className }: StringVibrationViewProps): ReactElement => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const statesRef = useRef<StringState[]>(
        Array.from({ length: NUM_STRINGS }, () => ({ amplitude: 0, phase: 0, frequency: 0 }))
    );
    const frameRef = useRef(0);
    const notesRef = useRef(activeNotes);
    notesRef.current = activeNotes;

    // Canvas2D — always use this path. WebGPU adds complexity for minimal
    // gain on a 2D line visualisation, and the GPU init path was silently
    // failing in some browsers, leaving the canvas empty.
    useEffect(() => {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        if (container === null || canvas === null) {
            return undefined;
        }
        const ctx = canvas.getContext('2d');
        if (ctx === null) {
            return undefined;
        }

        // Match canvas internal resolution to its CSS layout size.
        const observer = new ResizeObserver((entries) => {
            const { width, height } = entries[0]!.contentRect;
            const w = Math.round(width * devicePixelRatio);
            const h = Math.round(height * devicePixelRatio);
            if (canvas.width !== w) {
                canvas.width = w;
            }
            if (canvas.height !== h) {
                canvas.height = h;
            }
        });
        observer.observe(container);

        const states = statesRef.current;
        const fRef = frameRef;
        let rafId = 0;

        const render = (): void => {
            runCanvas2DFrame(canvas, ctx, notesRef.current, states, fRef);
            rafId = requestAnimationFrame(render);
        };
        rafId = requestAnimationFrame(render);
        return () => {
            cancelAnimationFrame(rafId);
            observer.disconnect();
        };
    }, []);

    return (
        <div ref={containerRef} className={className}>
            <canvas ref={canvasRef} className="h-full w-full" aria-label="Grand Boule string vibration visualisation" />
        </div>
    );
};
