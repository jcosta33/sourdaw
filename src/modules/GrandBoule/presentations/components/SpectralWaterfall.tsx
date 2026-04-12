import { type ReactElement, useEffect, useRef } from 'react';

/**
 * Rolling spectrogram waterfall (§8).
 *
 * Draws a log-frequency spectrogram mapped to the piano range (A0–C8).
 * Each pixel column corresponds to a piano key, so the display fills
 * the full width regardless of the linear FFT bin spacing.
 */

/** Piano frequency range. */
const PIANO_LOW_HZ = 27.5; // A0
const PIANO_HIGH_HZ = 4186; // C8
const DISPLAY_COLS = 176; // 2 pixels per piano key (88 × 2)
const HISTORY_FRAMES = 128;

type SpectralWaterfallProps = {
    /** Latest FFT magnitude frame, normalised to [0, 1]. */
    fftFrame: Float32Array | null;
    className?: string;
};

/** Map a display column (0..DISPLAY_COLS-1) to a linear FFT bin index via
 *  log-frequency interpolation. Returns a fractional bin for lerp. */
function colToFftBin(col: number, binCount: number, sampleRate: number): number {
    const t = col / (DISPLAY_COLS - 1);
    const logLow = Math.log(PIANO_LOW_HZ);
    const logHigh = Math.log(PIANO_HIGH_HZ);
    const freq = Math.exp(logLow + t * (logHigh - logLow));
    const bin = (freq / (sampleRate / 2)) * binCount;
    return Math.min(bin, binCount - 1);
}

/** Sample an FFT frame at a fractional bin using linear interpolation. */
function sampleBin(frame: Float32Array, bin: number): number {
    const lo = Math.floor(bin);
    const hi = Math.min(lo + 1, frame.length - 1);
    const frac = bin - lo;
    return frame[lo]! * (1 - frac) + frame[hi]! * frac;
}

/** HSL-like colour map: dark purple → amber → bright white. */
function colorMap(mag: number): [number, number, number, number] {
    const m = Math.max(0, Math.min(1, mag));
    let r: number, g: number, b: number;
    if (m < 0.5) {
        const t = m * 2;
        r = 26 + t * (251 - 26);
        g = 10 + t * (191 - 10);
        b = 58 + t * (36 - 58);
    } else {
        const t = (m - 0.5) * 2;
        r = 251 + t * (255 - 251);
        g = 191 + t * (245 - 191);
        b = 36 + t * (224 - 36);
    }
    const a = Math.min(1, m * 2) * 255;
    return [r, g, b, a];
}

export const SpectralWaterfall = ({ fftFrame, className }: SpectralWaterfallProps): ReactElement => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    const frameRef = useRef(fftFrame);
    frameRef.current = fftFrame;

    // Log-frequency history ring: each row has DISPLAY_COLS values.
    const historyRef = useRef<Float32Array[]>(
        Array.from({ length: HISTORY_FRAMES }, () => new Float32Array(DISPLAY_COLS))
    );
    const headRef = useRef(0);
    // Precomputed bin lookup table (rebuilt when sampleRate is known).
    const binLutRef = useRef<Float64Array | null>(null);
    const sampleRateRef = useRef(48000);

    useEffect(() => {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        if (container === null || canvas === null) {return;}

        // Resize canvas to match CSS layout.
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

        const ctx = canvas.getContext('2d');
        if (ctx === null) {return;}

        let raf = 0;
        const render = (): void => {
            const frame = frameRef.current;
            const { width, height } = canvas;

            // Ingest new frame: resample from linear FFT bins to log-frequency columns.
            if (frame !== null && frame.length > 0) {
                const binCount = frame.length;
                // Rebuild LUT if bin count or sample rate changed.
                if (binLutRef.current === null || binLutRef.current.length !== DISPLAY_COLS) {
                    const lut = new Float64Array(DISPLAY_COLS);
                    for (let c = 0; c < DISPLAY_COLS; c++) {
                        lut[c] = colToFftBin(c, binCount, sampleRateRef.current);
                    }
                    binLutRef.current = lut;
                }
                const lut = binLutRef.current;
                const head = headRef.current;
                const slot = historyRef.current[head]!;
                for (let c = 0; c < DISPLAY_COLS; c++) {
                    slot[c] = sampleBin(frame, lut[c]!);
                }
                headRef.current = (head + 1) % HISTORY_FRAMES;
            }

            // Draw the waterfall.
            ctx.clearRect(0, 0, width, height);
            const history = historyRef.current;
            const head = headRef.current;
            const rowH = height / HISTORY_FRAMES;
            const colW = width / DISPLAY_COLS;

            for (let row = 0; row < HISTORY_FRAMES; row++) {
                const frameIdx = (head - row - 1 + HISTORY_FRAMES) % HISTORY_FRAMES;
                const rowData = history[frameIdx]!;
                const y = Math.floor(row * rowH);
                const nextY = Math.floor((row + 1) * rowH);
                const rh = nextY - y;
                if (rh <= 0) {
                    continue;
                }

                for (let c = 0; c < DISPLAY_COLS; c++) {
                    const mag = rowData[c]!;
                    if (mag <= 0.01) {
                        continue;
                    }
                    const [r, g, b, a] = colorMap(mag);
                    ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${(a / 255).toFixed(2)})`;
                    const x = Math.floor(c * colW);
                    const cw = Math.floor((c + 1) * colW) - x;
                    ctx.fillRect(x, y, cw, rh);
                }
            }
            raf = requestAnimationFrame(render);
        };
        raf = requestAnimationFrame(render);
        return () => {
            cancelAnimationFrame(raf);
            observer.disconnect();
        };
    }, []);

    return (
        <div ref={containerRef} className={className}>
            <canvas ref={canvasRef} className="h-full w-full" aria-label="Grand Boule spectral waterfall" />
        </div>
    );
};
