/**
 * Spectrogram frequency axis and per-frame canvas cost.
 *
 * Two claims are under test:
 *  - the vertical axis must be logarithmic in frequency, so a decade occupies
 *    a constant number of pixel rows (assertions are at interior decades, not
 *    at the axis ends, where any clamped mapping agrees);
 *  - a painted column must cost a bounded number of canvas calls, not one
 *    `fillRect` per pixel row.
 *
 * The canvas-call assertion is an OPERATION COUNT, not a timing claim. Timing
 * under jsdom measures the harness, not the browser.
 */
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Spectrogram } from '../Spectrogram';

const SAMPLE_RATE = 48_000;
const BIN_COUNT = 1024;
const NYQUIST = SAMPLE_RATE / 2;
const HZ_PER_BIN = NYQUIST / BIN_COUNT;

type CanvasCallLog = {
    fillRect: number;
    putImageData: number;
    fillStyleWrites: number;
};

let callLog: CanvasCallLog;
/** Brightness painted into each pixel row by the most recent frame. */
let rowBrightness: number[];

const parseRgb = (style: string): number => {
    const match = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(style);
    if (!match) {
        return 0;
    }
    return Number(match[1]) + Number(match[2]) + Number(match[3]);
};

/**
 * Centre of the brightest band in the painted column.
 *
 * A single bin covers several pixel rows at the bottom of a log axis and less
 * than one row at the top, so the brightest value is a plateau of varying
 * width. Taking its centre rather than its first row keeps the comparison
 * between decades unbiased.
 */
const brightestRow = (): number => {
    const peak = Math.max(...rowBrightness);
    const rows = rowBrightness.flatMap((value, row) => (value === peak ? [row] : []));
    return rows.reduce((total, row) => total + row, 0) / rows.length;
};

const binForHz = (hz: number): number => Math.round(hz / HZ_PER_BIN);

/** A spectrum that is silent everywhere except one loud bin. */
const spectrumWithToneAt = (hz: number) => {
    const bin = binForHz(hz);
    return (target: Float32Array): void => {
        target.fill(-100);
        target[bin] = 0;
    };
};

let writeSpectrum: (target: Float32Array) => void = spectrumWithToneAt(1000);

const fakeAnalyser = {
    frequencyBinCount: BIN_COUNT,
    context: { sampleRate: SAMPLE_RATE },
    getFloatFrequencyData: (target: Float32Array) => writeSpectrum(target),
};

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getMasterAnalyser: () => fakeAnalyser,
    getTrackAnalyser: () => undefined,
}));

vi.mock('#/components/daw/DawMeterFrame', () => ({
    DawMeterFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const HEIGHT = 120;
const WIDTH = 60;

/**
 * Records canvas traffic. `fillRect` of a 1px-tall row is treated as painting
 * that row; `putImageData` rows are read out of the pixel buffer.
 */
const createRecordingContext = () => {
    const context = {
        _fillStyle: '',
        get fillStyle(): string {
            return context._fillStyle;
        },
        set fillStyle(value: string) {
            context._fillStyle = value;
            callLog.fillStyleWrites++;
        },
        shadowColor: '',
        shadowBlur: 0,
        fillRect: (_x: number, y: number, width: number, height: number) => {
            callLog.fillRect++;
            // The whole-canvas clear and the cursor line are not row paints.
            if (height === 1 && width === 1) {
                rowBrightness[y] = parseRgb(context._fillStyle);
            }
        },
        createImageData: (width: number, height: number) => ({
            width,
            height,
            data: new Uint8ClampedArray(width * height * 4),
        }),
        putImageData: (image: { width: number; height: number; data: Uint8ClampedArray }) => {
            callLog.putImageData++;
            for (let row = 0; row < image.height; row++) {
                const base = row * image.width * 4;
                rowBrightness[row] = image.data[base]! + image.data[base + 1]! + image.data[base + 2]!;
            }
        },
    };
    return context;
};

describe('Spectrogram frequency axis', () => {
    let frameCallbacks: FrameRequestCallback[];
    let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

    beforeEach(() => {
        callLog = { fillRect: 0, putImageData: 0, fillStyleWrites: 0 };
        rowBrightness = Array.from({ length: HEIGHT }, () => 0);
        frameCallbacks = [];
        writeSpectrum = spectrumWithToneAt(1000);
        originalGetContext = HTMLCanvasElement.prototype.getContext;
        // jsdom has no canvas backend, so the 2D context is a recording double.
        HTMLCanvasElement.prototype.getContext = (() =>
            createRecordingContext()) as unknown as typeof HTMLCanvasElement.prototype.getContext;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            frameCallbacks.push(callback);
            return frameCallbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', () => {});
    });

    afterEach(() => {
        HTMLCanvasElement.prototype.getContext = originalGetContext;
        vi.unstubAllGlobals();
    });

    /** Renders exactly one frame at the given height. */
    const paintOneFrame = (hz: number, height = HEIGHT): void => {
        writeSpectrum = spectrumWithToneAt(hz);
        callLog = { fillRect: 0, putImageData: 0, fillStyleWrites: 0 };
        rowBrightness = Array.from({ length: height }, () => 0);
        const { unmount } = render(<Spectrogram width={WIDTH} height={height} />);
        unmount();
    };

    /** Renders one frame and returns the row index carrying the tone's energy. */
    const paintOneFrameFor = (hz: number): number => {
        paintOneFrame(hz);
        // A silent column would leave every row equally dark and make the
        // peak meaningless.
        expect(Math.max(...rowBrightness)).toBeGreaterThan(0);
        return brightestRow();
    };

    it('should place equal-width decades on the vertical axis', () => {
        // On a log axis every decade is the same distance. On the linear axis
        // 100 Hz -> 1 kHz spans 3.75% of a 24 kHz display while 1 kHz -> 10 kHz
        // spans 37.5%, so the two gaps differ tenfold.
        const rowAt100 = paintOneFrameFor(100);
        const rowAt1000 = paintOneFrameFor(1000);
        const rowAt10000 = paintOneFrameFor(10_000);

        // Rows count downward, so a higher frequency sits at a smaller index.
        expect(rowAt10000).toBeLessThan(rowAt1000);
        expect(rowAt1000).toBeLessThan(rowAt100);

        const lowerDecade = rowAt100 - rowAt1000;
        const upperDecade = rowAt1000 - rowAt10000;
        expect(Math.abs(lowerDecade - upperDecade)).toBeLessThanOrEqual(1);
    });

    it('should put 1 kHz near the middle of the display rather than crushed into the bottom', () => {
        // 20 Hz..24 kHz is 10.2 octaves; 1 kHz sits 5.6 octaves up, i.e. ~55%.
        const rowAt1000 = paintOneFrameFor(1000);
        const fractionFromBottom = (HEIGHT - 1 - rowAt1000) / (HEIGHT - 1);

        expect(fractionFromBottom).toBeGreaterThan(0.5);
        expect(fractionFromBottom).toBeLessThan(0.62);
    });

    it('should cost the same number of canvas calls regardless of display height', () => {
        // This is an OPERATION COUNT, not a timing measurement.
        paintOneFrame(1000, 120);
        const shortDisplay = { ...callLog };

        paintOneFrame(1000, 480);
        const tallDisplay = { ...callLog };

        // A per-pixel `fillRect` column scales one draw call and one fillStyle
        // write per row: 122/122 at height 120 against 482/482 at height 480.
        expect(tallDisplay.fillRect).toBe(shortDisplay.fillRect);
        expect(tallDisplay.fillStyleWrites).toBe(shortDisplay.fillStyleWrites);

        // The column is blitted once per frame.
        expect(shortDisplay.putImageData).toBe(1);
        expect(tallDisplay.putImageData).toBe(1);
    });
});
