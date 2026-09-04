/**
 * CrustWaveformDisplay — real-time scrolling waveform + GR display.
 *
 * Canvas-rendered at requestAnimationFrame. Latest meter values are written
 * into refs every frame (escaping the stale-closure problem) and pushed into
 * ring buffers at the controlled scroll rate.
 *
 * Layers (bottom → top):
 *  1. Input waveform fill      — #4A9ECC 60%
 *  2. Output waveform fill     — #1F6B99 80%
 *  3. GR fill                  — #C44030 20% (between input & output)
 *  4. GR strip (top 12px)      — single-pixel trace, colour-coded by amount
 *  5. LUFS curve               — #7FC8A0 1px
 *  6. Peak GR labels           — amber, mono 9px
 *  7. Target LUFS line         — #4A7C6F dashed
 *
 * Delta mode: bg → #1A0805, GR signal shown in red + banner
 */
import { type ReactElement, useRef, useEffect } from 'react';

import { createCompactFloatBuffer } from '#/utils/createCompactFloatBuffer';

import { grColor } from './crustMeterColors';

const HISTORY = 200;

type Props = {
    grDb: number;
    inputDb: number;
    outputDb: number;
    lufsShortTerm: number;
    lufsTarget: number | null;
    deltaListen: boolean;
    scrollSpeed: 'slow' | 'normal' | 'fast';
};

function dbToNorm(db: number, min = -60, max = 0): number {
    return Math.max(0, Math.min(1, (db - min) / (max - min)));
}

export const CrustWaveformDisplay = ({
    grDb,
    inputDb,
    outputDb,
    lufsShortTerm,
    lufsTarget,
    deltaListen,
    scrollSpeed = 'normal',
}: Props): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Live refs — updated synchronously on every render, no stale closures in rAF loop
    const latestRef = useRef({ grDb, inputDb, outputDb, lufsShortTerm, lufsTarget, deltaListen, scrollSpeed });
    latestRef.current = { grDb, inputDb, outputDb, lufsShortTerm, lufsTarget, deltaListen, scrollSpeed };

    // Ring buffers (pre-allocated, never reallocated)
    const inputBuf = useRef(createCompactFloatBuffer({ length: HISTORY }));
    const outputBuf = useRef(createCompactFloatBuffer({ length: HISTORY }));
    const grBuf = useRef(createCompactFloatBuffer({ length: HISTORY }));
    const lufsBuf = useRef(createCompactFloatBuffer({ length: HISTORY, fill: -100 }));
    const writePos = useRef(0);
    const tickRef = useRef(0);

    // Peak GR label ring (max 4 visible at a time)
    type PeakLabel = { gr: number; x: number; age: number };
    const peakLabels = useRef<PeakLabel[]>([]);

    const rafRef = useRef(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return () => {};
        }
        const ctxOrNull = canvas.getContext('2d');
        if (!ctxOrNull) {
            return () => {};
        }
        // Capture into a local that the nested `draw` closure can use
        // without re-narrowing the union type on every reference.
        const ctx: CanvasRenderingContext2D = ctxOrNull;

        function draw(): void {
            rafRef.current = requestAnimationFrame(draw);
            tickRef.current++;

            const {
                grDb: gr,
                inputDb: inDb,
                outputDb: outDb,
                lufsShortTerm: lufs,
                lufsTarget: target,
                deltaListen: delta,
                scrollSpeed: speed,
            } = latestRef.current;

            // Scroll rate: slow=4 frames/sample, normal=2, fast=1
            const frameSkip = (() => {
                if (speed === 'slow') {
                    return 4;
                }
                if (speed === 'fast') {
                    return 1;
                }
                return 2;
            })();
            if (tickRef.current % frameSkip !== 0) {
                return;
            }

            // Push meter values into ring buffers
            const pos = writePos.current % HISTORY;
            inputBuf.current[pos] = dbToNorm(inDb);
            outputBuf.current[pos] = dbToNorm(outDb);
            grBuf.current[pos] = gr;
            lufsBuf.current[pos] = Math.max(-40, Math.min(0, lufs));
            writePos.current++;

            const W = canvas!.width;
            const H = canvas!.height;
            const mid = H * 0.5;
            const colW = W / HISTORY;

            // ── Background ──
            ctx.fillStyle = delta ? '#1A0805' : '#0E0E10';
            ctx.fillRect(0, 0, W, H);

            if (delta) {
                // Delta mode: show GR signal only as red fill
                ctx.fillStyle = 'rgba(196,64,48,0.65)';
                ctx.beginPath();
                ctx.moveTo(0, mid);
                for (let i = 0; i < HISTORY; i++) {
                    const idx = (writePos.current + i) % HISTORY;
                    const norm = Math.min(1, Math.abs(grBuf.current[idx] ?? 0) / 18);
                    ctx.lineTo(i * colW, mid - norm * mid * 0.9);
                }
                ctx.lineTo(W, mid);
                ctx.closePath();
                ctx.fill();

                // Banner
                ctx.font = '10px "JetBrains Mono", "IBM Plex Mono", monospace';
                ctx.fillStyle = '#C44030';
                ctx.fillText('◉  LISTENING TO GAIN REDUCTION ONLY', 10, 18);
            } else {
                // Layer 1: input waveform
                ctx.fillStyle = 'rgba(74,158,204,0.55)';
                ctx.beginPath();
                ctx.moveTo(0, mid);
                for (let i = 0; i < HISTORY; i++) {
                    const v = inputBuf.current[(writePos.current + i) % HISTORY] ?? 0;
                    ctx.lineTo(i * colW, mid - v * mid * 0.9);
                }
                ctx.lineTo(W, mid);
                ctx.closePath();
                ctx.fill();

                // Layer 2: output waveform (darker, on top)
                ctx.fillStyle = 'rgba(31,107,153,0.75)';
                ctx.beginPath();
                ctx.moveTo(0, mid);
                for (let i = 0; i < HISTORY; i++) {
                    const v = outputBuf.current[(writePos.current + i) % HISTORY] ?? 0;
                    ctx.lineTo(i * colW, mid - v * mid * 0.9);
                }
                ctx.lineTo(W, mid);
                ctx.closePath();
                ctx.fill();

                // Layer 3: GR fill (red gap between input & output when input > output)
                ctx.fillStyle = 'rgba(196,64,48,0.18)';
                for (let i = 0; i < HISTORY - 1; i++) {
                    const inv = inputBuf.current[(writePos.current + i) % HISTORY] ?? 0;
                    const outv = outputBuf.current[(writePos.current + i) % HISTORY] ?? 0;
                    if (inv > outv) {
                        const ampIn = inv * mid * 0.9;
                        const ampOut = outv * mid * 0.9;
                        ctx.fillRect(i * colW, mid - ampIn, colW + 1, ampIn - ampOut);
                    }
                }

                // Layer 4: GR strip (top 12px band)
                const GR_BAND = 12;
                for (let i = 0; i < HISTORY - 1; i++) {
                    const g = grBuf.current[(writePos.current + i) % HISTORY] ?? 0;
                    const normGr = Math.min(1, Math.max(0, Math.abs(g) / 18));
                    ctx.fillStyle = grColor(g);
                    ctx.fillRect(i * colW, normGr * GR_BAND, colW + 1, 1.5);
                }

                // Layer 5: LUFS curve (bottom 40% of canvas)
                ctx.strokeStyle = '#7FC8A0';
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (let i = 0; i < HISTORY; i++) {
                    const ld = lufsBuf.current[(writePos.current + i) % HISTORY] ?? -40;
                    const norm = (ld + 40) / 40; // -40→0 mapped to 0→1
                    const y = H - norm * (H * 0.4);
                    if (i === 0) {
                        ctx.moveTo(i * colW, y);
                    } else {
                        ctx.lineTo(i * colW, y);
                    }
                }
                ctx.stroke();

                // Layer 7: target LUFS dashed line
                if (target !== null) {
                    const norm = (target + 40) / 40;
                    const y = H - norm * (H * 0.4);
                    ctx.strokeStyle = 'rgba(74,124,111,0.55)';
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(W, y);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
            }

            // Layer 6: floating peak GR labels
            if (Math.abs(gr) > 3) {
                const hasNear = peakLabels.current.some((l) => l.x > W - 40 && Math.abs(l.gr - gr) < 1);
                if (!hasNear && peakLabels.current.length < 4) {
                    peakLabels.current.push({ gr, x: W - 10, age: 0 });
                }
            }
            // Advance + cull in place — the previous .map().filter() form
            // allocated two intermediate arrays per frame for a buffer
            // that holds at most four labels.
            const labels = peakLabels.current;
            const labelDelta = colW * frameSkip;
            let liveCount = 0;
            for (let i = 0; i < labels.length; i += 1) {
                const label = labels[i]!;
                label.x -= labelDelta;
                label.age += 1;
                if (label.age < 180 && label.x > 0) {
                    labels[liveCount] = label;
                    liveCount += 1;
                }
            }
            labels.length = liveCount;

            ctx.font = '9px "JetBrains Mono", "IBM Plex Mono", monospace';
            for (const label of peakLabels.current) {
                const alpha = label.age > 120 ? Math.max(0, 1 - (label.age - 120) / 60) : 1;
                ctx.fillStyle = `rgba(212,168,71,${alpha.toFixed(2)})`;
                ctx.fillText(label.gr.toFixed(1), label.x, 28);
            }
        }

        rafRef.current = requestAnimationFrame(draw);
        return () => {
            cancelAnimationFrame(rafRef.current);
        };
    }, []); // ← intentionally empty: all live data read via latestRef, no dependency restarts needed

    return (
        <div className="relative w-full h-full bg-surface-well">
            <canvas
                ref={canvasRef}
                width={420}
                height={160}
                className="w-full h-full block"
                style={{ imageRendering: 'pixelated' }}
                aria-label="Real-time waveform and gain reduction display"
                role="img"
            />
        </div>
    );
};
