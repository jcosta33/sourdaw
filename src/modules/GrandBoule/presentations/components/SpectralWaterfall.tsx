import { type ReactElement, useEffect, useRef } from 'react';

/**
 * Rolling spectrogram waterfall (§8).
 *
 * Pushes each incoming FFT magnitude frame downward and colour-codes by
 * intensity. When WebGPU is available the compute-shader version is
 * wired in a follow-up; until then this canvas2D implementation provides
 * the full visual contract and exercises the SharedArrayBuffer-backed
 * ring buffer supplied by the audio worklet.
 */

const BIN_COUNT = 256;
const HISTORY_FRAMES = 128;

type SpectralWaterfallProps = {
    /** Latest FFT magnitude frame, normalised to [0, 1]. Length == BIN_COUNT. */
    fftFrame: Float32Array | null;
    className?: string;
};

export const SpectralWaterfall = ({
    fftFrame,
    className,
}: SpectralWaterfallProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const historyRef = useRef<Float32Array[]>(
        Array.from({ length: HISTORY_FRAMES }, () => new Float32Array(BIN_COUNT)),
    );
    const headRef = useRef<number>(0);

    useEffect(() => {
        if (fftFrame === null) {
            return;
        }
        const head = headRef.current;
        const slot = historyRef.current[head]!;
        const n = Math.min(BIN_COUNT, fftFrame.length);
        for (let i = 0; i < n; i += 1) {
            slot[i] = fftFrame[i] ?? 0;
        }
        headRef.current = (head + 1) % HISTORY_FRAMES;
    }, [fftFrame]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas === null) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (ctx === null) {
            return;
        }
        const width = canvas.width;
        const height = canvas.height;
        const rowHeight = height / HISTORY_FRAMES;
        const binWidth = width / BIN_COUNT;

        let raf = 0;
        const render = (): void => {
            ctx.clearRect(0, 0, width, height);
            const history = historyRef.current;
            const head = headRef.current;
            for (let row = 0; row < HISTORY_FRAMES; row += 1) {
                const frameIdx = (head - row - 1 + HISTORY_FRAMES) % HISTORY_FRAMES;
                const frame = history[frameIdx]!;
                const y = row * rowHeight;
                for (let bin = 0; bin < BIN_COUNT; bin += 1) {
                    const mag = Math.min(1, Math.max(0, frame[bin] ?? 0));
                    if (mag <= 0.01) {
                        continue;
                    }
                    const hue = 260 - mag * 200;
                    ctx.fillStyle = `hsl(${hue}, 85%, ${20 + mag * 55}%)`;
                    ctx.fillRect(bin * binWidth, y, binWidth, rowHeight);
                }
            }
            raf = requestAnimationFrame(render);
        };
        render();
        return () => cancelAnimationFrame(raf);
    }, []);

    return (
        <canvas
            ref={canvasRef}
            width={640}
            height={256}
            className={className}
            aria-label="Grand Boule spectral waterfall"
        />
    );
};
