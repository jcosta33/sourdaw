/**
 * Spectrogram (Waterfall) component.
 * Time×frequency heat map using Canvas2D.
 * Scrolls horizontally over time, displaying FFT magnitude as
 * color intensity from dark blue → cyan → yellow → white.
 *
 * The frequency axis is logarithmic, which is what audio analysers use: pitch
 * tracks the ratio of frequencies, not their difference, so a log axis gives
 * every octave the same height. On a linear axis against a 24 kHz Nyquist,
 * everything below 1 kHz is crushed into the bottom 1/24 of the display.
 */
import { type ReactElement, useRef, useEffect } from 'react';

import { DawMeterFrame } from '#/components/daw/DawMeterFrame';
import { getMasterAnalyser, getTrackAnalyser } from '#/modules/AudioEngine/useCases';

type SpectrogramProps = {
    trackId?: string;
    width?: number;
    height?: number;
};

/** Bottom of the displayed range. Below this is subsonic for musical material. */
const MIN_DISPLAY_HZ = 20;

type BinRange = { start: number; end: number };

type BuildLogBinRangesInput = {
    height: number;
    binCount: number;
    sampleRate: number;
};

/**
 * Maps each pixel row (row 0 = top = highest frequency) to the half-open range
 * of FFT bins it covers, spaced logarithmically.
 *
 * Near the bottom of the axis many rows share one bin; near the top one row
 * spans many bins, which is why the range is computed from the row's frequency
 * edges rather than a fixed bins-per-pixel stride.
 */
const buildLogBinRanges = ({ height, binCount, sampleRate }: BuildLogBinRangesInput): BinRange[] => {
    const nyquist = sampleRate / 2;
    const hzPerBin = nyquist / binCount;
    const topHz = Math.max(nyquist, MIN_DISPLAY_HZ * 2);
    const span = topHz / MIN_DISPLAY_HZ;

    const ranges: BinRange[] = [];
    for (let y = 0; y < height; y++) {
        const upperEdge = (height - y) / height;
        const lowerEdge = (height - 1 - y) / height;
        const upperHz = MIN_DISPLAY_HZ * span ** upperEdge;
        const lowerHz = MIN_DISPLAY_HZ * span ** lowerEdge;

        const start = Math.min(Math.max(Math.floor(lowerHz / hzPerBin), 0), binCount - 1);
        const end = Math.min(Math.max(Math.ceil(upperHz / hzPerBin), start + 1), binCount);
        ranges.push({ start, end });
    }
    return ranges;
};

export const Spectrogram = ({ trackId, width = 300, height = 100 }: SpectrogramProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const columnRef = useRef(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return () => {};
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return () => {};
        }

        // Pre-build color LUT (256 entries) — rich blue→cyan→green→yellow→red.
        // Stored as raw RGB bytes so a column can be written straight into an
        // ImageData buffer.
        const colorLUT = new Uint8ClampedArray(256 * 3);
        for (let index = 0; index < 256; index++) {
            const time = index / 255;
            let r: number, g: number, b: number;
            if (time < 0.15) {
                // Deep black → dark blue
                const state = time / 0.15;
                r = 0;
                g = 0;
                b = Math.round(state * 100);
            } else if (time < 0.35) {
                // Dark blue → vivid cyan
                const state = (time - 0.15) / 0.2;
                r = 0;
                g = Math.round(state * 220);
                b = Math.round(100 + state * 155);
            } else if (time < 0.55) {
                // Cyan → green
                const state = (time - 0.35) / 0.2;
                r = 0;
                g = Math.round(220 + state * 35);
                b = Math.round(255 * (1 - state));
            } else if (time < 0.75) {
                // Green → yellow
                const state = (time - 0.55) / 0.2;
                r = Math.round(state * 255);
                g = Math.round(255 - state * 30);
                b = 0;
            } else {
                // Yellow → hot red/white
                const state = (time - 0.75) / 0.25;
                r = 255;
                g = Math.round(225 * (1 - state * 0.7));
                b = Math.round(state * 80);
            }
            colorLUT[index * 3] = r;
            colorLUT[index * 3 + 1] = g;
            colorLUT[index * 3 + 2] = b;
        }

        let rafId = 0;
        columnRef.current = 0;
        // Reused across frames — reallocated only if frequencyBinCount changes.
        let freqData: Float32Array<ArrayBuffer> | null = null;
        let binRanges: BinRange[] = [];
        let rangeBinCount = 0;
        let rangeSampleRate = 0;
        // One column of pixels, reused every frame.
        const column = ctx.createImageData(1, height);

        // Clear — deep black
        ctx.fillStyle = '#050508';
        ctx.fillRect(0, 0, width, height);

        const draw = (): void => {
            const analyser = trackId ? (getTrackAnalyser(trackId) ?? getMasterAnalyser()) : getMasterAnalyser();

            const binCount = analyser.frequencyBinCount;
            const sampleRate = analyser.context.sampleRate;
            if (!freqData || freqData.length !== binCount) {
                freqData = new Float32Array(binCount);
            }
            if (binCount !== rangeBinCount || sampleRate !== rangeSampleRate) {
                binRanges = buildLogBinRanges({ height, binCount, sampleRate });
                rangeBinCount = binCount;
                rangeSampleRate = sampleRate;
            }
            analyser.getFloatFrequencyData(freqData);

            const col = columnRef.current % width;

            // Fill one column of pixels, then blit it in a single canvas call.
            // A per-pixel fillRect here cost one draw call and one fillStyle
            // write per row, i.e. it scaled with the height of the display.
            for (let y = 0; y < height; y++) {
                const range = binRanges[y]!;
                let maxDb = -100;
                for (let bin = range.start; bin < range.end; bin++) {
                    if (freqData[bin]! > maxDb) {
                        maxDb = freqData[bin]!;
                    }
                }

                // Normalize dB to 0-255
                const normalized = Math.max(0, Math.min(255, Math.round(((maxDb + 90) / 90) * 255)));
                column.data[y * 4] = colorLUT[normalized * 3]!;
                column.data[y * 4 + 1] = colorLUT[normalized * 3 + 1]!;
                column.data[y * 4 + 2] = colorLUT[normalized * 3 + 2]!;
                column.data[y * 4 + 3] = 255;
            }
            ctx.putImageData(column, col, 0);

            // Draw cursor line — subtle bright with glow
            const nextCol = (col + 1) % width;
            ctx.shadowColor = 'rgba(255,255,255,0.5)';
            ctx.shadowBlur = 4;
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.fillRect(nextCol, 0, 1, height);
            ctx.shadowBlur = 0;

            columnRef.current++;
            rafId = requestAnimationFrame(draw);
        };

        draw();
        return () => cancelAnimationFrame(rafId);
    }, [trackId, width, height]);

    return (
        <DawMeterFrame>
            <canvas
                ref={canvasRef}
                width={width}
                height={height}
                className="block"
                aria-label="Spectrogram"
                role="img"
            />
        </DawMeterFrame>
    );
};
