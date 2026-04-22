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
    analyser: AnalyserNode | null;
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

export const SpectralWaterfall = ({ analyser, className }: SpectralWaterfallProps): ReactElement => {
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
    // Precomputed bin lookup table (rebuilt when sampleRate is known).
    const binLutRef = useRef<Float64Array | null>(null);
    const sampleRateRef = useRef(48000);

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
        const imgData = offscreenCtx.createImageData(DISPLAY_COLS, HISTORY_FRAMES);

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
            if (currentAnalyser && dbBuffer && normBuffer) {
                currentAnalyser.getFloatFrequencyData(dbBuffer);
                const binCount = dbBuffer.length;

                for (let i = 0; i < binCount; i += 1) {
                    normBuffer[i] = Math.max(0, Math.min(1, (dbBuffer[i]! + 100) / 100));
                }

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
                    slot[c] = sampleBin(normBuffer, lut[c]!);
                }
                headRef.current = (head + 1) % HISTORY_FRAMES;
            }

            // Draw the waterfall.
            const history = historyRef.current;
            const head = headRef.current;
            const data = imgData.data;
            data.fill(0);

            for (let row = 0; row < HISTORY_FRAMES; row++) {
                const frameIdx = (head - row - 1 + HISTORY_FRAMES) % HISTORY_FRAMES;
                const rowData = history[frameIdx]!;
                const yOffset = row * DISPLAY_COLS * 4;

                for (let c = 0; c < DISPLAY_COLS; c++) {
                    const mag = rowData[c]!;
                    if (mag <= 0.01) {
                        continue;
                    }
                    const [r, g, b, a] = colorMap(mag);
                    const idx = yOffset + c * 4;
                    data[idx] = r;
                    data[idx + 1] = g;
                    data[idx + 2] = b;
                    data[idx + 3] = a;
                }
            }

            offscreenCtx.putImageData(imgData, 0, 0);

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
