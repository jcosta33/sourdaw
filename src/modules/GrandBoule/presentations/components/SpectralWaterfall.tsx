import { type ReactElement, useEffect, useRef } from 'react';

/**
 * Rolling spectrogram waterfall.
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
    analyser: AnalyserNode | null;
    /** Engine context sample rate (Hz). Drives the log-frequency bin LUT. */
    sampleRate?: number;
    className?: string;
};

/** Fallback rate used until a real engine sample rate is provided. */
const DEFAULT_SAMPLE_RATE = 48000;

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

export const SpectralWaterfall = ({ analyser, sampleRate, className }: SpectralWaterfallProps): ReactElement => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    const analyserRef = useRef(analyser);

    useEffect(() => {
        analyserRef.current = analyser;
    }, [analyser]);

    // Log-frequency history ring: each row has DISPLAY_COLS values.
    const historyRef = useRef<Float32Array[]>(
        Array.from({ length: HISTORY_FRAMES }, () => new Float32Array(DISPLAY_COLS))
    );
    const headRef = useRef(0);
    // Precomputed bin lookup table (rebuilt when the sample rate changes).
    const binLutRef = useRef<Float64Array | null>(null);
    // The bin LUT is frequency-to-column for the *engine* sample rate; a 44.1 kHz
    // context maps FFT bins differently than 48 kHz, so the rate must feed the
    // LUT (mirrored to a ref so the rAF loop reads the live value) and the LUT
    // must be rebuilt when it changes.
    const effectiveSampleRate = sampleRate ?? DEFAULT_SAMPLE_RATE;
    const sampleRateRef = useRef(effectiveSampleRate);
    const lutSampleRateRef = useRef<number | null>(null);
    sampleRateRef.current = effectiveSampleRate;

    useEffect(() => {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        if (container === null || canvas === null) {
            return undefined;
        }

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
        if (ctx === null) {
            return undefined;
        }

        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = DISPLAY_COLS;
        offscreenCanvas.height = HISTORY_FRAMES;
        const offscreenCtx = offscreenCanvas.getContext('2d');
        if (offscreenCtx === null) {
            return undefined;
        }
        // Single-row scratch ImageData. Only the newest row is written each
        // frame; the rest of the waterfall is scrolled down by one pixel via a
        // canvas self-blit, so the per-frame cost is O(DISPLAY_COLS) instead of
        // O(HISTORY_FRAMES × DISPLAY_COLS).
        const rowImg = offscreenCtx.createImageData(DISPLAY_COLS, 1);

        let raf = 0;
        let dbBuffer: Float32Array<ArrayBuffer> | null = null;
        let normBuffer: Float32Array<ArrayBuffer> | null = null;
        let lastAnalyser: AnalyserNode | null = null;

        const render = (): void => {
            const currentAnalyser = analyserRef.current;
            const { width, height } = canvas;

            // Initialize or re-initialize buffers if analyser changes
            if (currentAnalyser && currentAnalyser !== lastAnalyser) {
                currentAnalyser.fftSize = 512;
                const binCount = currentAnalyser.frequencyBinCount;
                dbBuffer = new Float32Array(new ArrayBuffer(binCount * Float32Array.BYTES_PER_ELEMENT));
                normBuffer = new Float32Array(new ArrayBuffer(binCount * Float32Array.BYTES_PER_ELEMENT));
                lastAnalyser = currentAnalyser;
            }

            // Ingest new frame: resample from linear FFT bins to log-frequency columns.
            let ingestedRow: Float32Array | null = null;
            if (currentAnalyser && dbBuffer && normBuffer) {
                currentAnalyser.getFloatFrequencyData(dbBuffer);
                const binCount = dbBuffer.length;

                for (let i = 0; i < binCount; i += 1) {
                    normBuffer[i] = Math.max(0, Math.min(1, (dbBuffer[i]! + 100) / 100));
                }

                // Rebuild the LUT when it is missing or the sample rate changed
                // (the column-to-bin mapping is rate-dependent).
                const rate = sampleRateRef.current;
                if (
                    binLutRef.current === null ||
                    binLutRef.current.length !== DISPLAY_COLS ||
                    lutSampleRateRef.current !== rate
                ) {
                    const lut = new Float64Array(DISPLAY_COLS);
                    for (let c = 0; c < DISPLAY_COLS; c++) {
                        lut[c] = colToFftBin(c, binCount, rate);
                    }
                    binLutRef.current = lut;
                    lutSampleRateRef.current = rate;
                }
                const lut = binLutRef.current;
                const head = headRef.current;
                const slot = historyRef.current[head]!;
                for (let c = 0; c < DISPLAY_COLS; c++) {
                    slot[c] = sampleBin(normBuffer, lut[c]!);
                }
                headRef.current = (head + 1) % HISTORY_FRAMES;
                ingestedRow = slot;
            }

            // Scroll the waterfall by one row and paint only the newest row.
            // Older rows are preserved by blitting the offscreen canvas onto
            // itself shifted down one pixel; the bottom row falls off. We only
            // scroll when a new frame was ingested so idle frames don't drain
            // the history off-screen.
            if (ingestedRow !== null) {
                offscreenCtx.drawImage(offscreenCanvas, 0, 1);

                const data = rowImg.data;
                for (let c = 0; c < DISPLAY_COLS; c++) {
                    const mag = ingestedRow[c]!;
                    const idx = c * 4;
                    if (mag <= 0.01) {
                        data[idx] = 0;
                        data[idx + 1] = 0;
                        data[idx + 2] = 0;
                        data[idx + 3] = 0;
                        continue;
                    }
                    const [r, g, b, a] = colorMap(mag);
                    data[idx] = r;
                    data[idx + 1] = g;
                    data[idx + 2] = b;
                    data[idx + 3] = a;
                }
                offscreenCtx.putImageData(rowImg, 0, 0);
            }

            ctx.clearRect(0, 0, width, height);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(offscreenCanvas, 0, 0, width, height);

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
