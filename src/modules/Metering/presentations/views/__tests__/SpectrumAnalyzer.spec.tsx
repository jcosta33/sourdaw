/**
 * SpectrumAnalyzer spec.
 *
 * Two claims are under test:
 *  - the component renders (smoke);
 *  - the useCase bindings are live: the mounted component reads frequency
 *    data from the analyser the use cases select for master vs track mode,
 *    that data shapes the painted spectrum, and the animation-frame loop
 *    keeps re-reading until unmount.
 *
 * The analyser, the 2D context, and the animation clock are controlled
 * fakes; a red here means one of those bindings is actually broken.
 */
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { dbToYLiveAnalyser as dbToY, freqToLogX } from '#/components/daw/spectrumMath';
import { TooltipProvider } from '#/components/ui/tooltip';
import { getTrackAnalyser } from '#/modules/AudioEngine/useCases';

import { SpectrumAnalyzer } from '../SpectrumAnalyzer';

const SAMPLE_RATE = 48_000;
const BIN_COUNT = 1024;
const HZ_PER_BIN = SAMPLE_RATE / 2 / BIN_COUNT;
const WIDTH = 300;
const HEIGHT = 120;
const NYQUIST_CAP = Math.min(22_000, SAMPLE_RATE / 2);

/** A spectrum that is silent everywhere except one 0 dB bin. */
const spectrumWithToneAt =
    (hz: number) =>
    (target: Float32Array): void => {
        target.fill(-100);
        target[Math.round(hz / HZ_PER_BIN)] = 0;
    };
const silentSpectrum = (target: Float32Array): void => {
    target.fill(-100);
};

/** Fakes one AnalyserNode and records every read buffer handed to it. */
const createFakeAnalyser = () => {
    const analyser = {
        frequencyBinCount: BIN_COUNT,
        /** Length of each Float32Array the component passed to a read. */
        reads: [] as number[],
        getFloatFrequencyData: (target: Float32Array): void => {
            analyser.reads.push(target.length);
            writeSpectrum(target);
        },
    };
    return analyser;
};
type FakeAnalyser = ReturnType<typeof createFakeAnalyser>;

/**
 * Module state the mocked useCases hand out. Defaults exist because vi.mock
 * is file-wide: the untouched smoke test renders through the same bindings.
 * The bindings describe reassigns fresh fakes per test.
 */
let writeSpectrum: (target: Float32Array) => void = silentSpectrum;
let masterAnalyser: FakeAnalyser = createFakeAnalyser();
let trackAnalyser: FakeAnalyser | null = createFakeAnalyser();

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getMasterAnalyser: vi.fn(() => masterAnalyser),
    getTrackAnalyser: vi.fn(() => trackAnalyser),
    getAudioSampleRate: vi.fn(() => SAMPLE_RATE),
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('SpectrumAnalyzer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        renderWithTooltip(<SpectrumAnalyzer />);
        expect(document.body).toBeTruthy();
    });
});

describe('SpectrumAnalyzer — useCase bindings', () => {
    let frameCallbacks: FrameRequestCallback[];
    let cancelledFrameIds: number[];
    /** Every (x, y) the component drew a spectrum vertex at. */
    let linePoints: Array<{ x: number; y: number }>;
    let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

    const createRecordingContext = () => ({
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        roundRect: vi.fn(),
        fill: vi.fn(),
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn((x: number, y: number) => {
            linePoints.push({ x, y });
        }),
        stroke: vi.fn(),
        fillText: vi.fn(),
        closePath: vi.fn(),
        setLineDash: vi.fn(),
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        font: '',
        textAlign: 'left',
        shadowColor: '',
        shadowBlur: 0,
        globalAlpha: 0,
    });

    beforeEach(() => {
        vi.clearAllMocks();
        masterAnalyser = createFakeAnalyser();
        trackAnalyser = createFakeAnalyser();
        writeSpectrum = silentSpectrum;
        frameCallbacks = [];
        cancelledFrameIds = [];
        linePoints = [];
        originalGetContext = HTMLCanvasElement.prototype.getContext;
        // The 2D context is a recording double so the painted spectrum
        // vertices can be observed and compared against the analyser data.
        HTMLCanvasElement.prototype.getContext = (() =>
            createRecordingContext()) as unknown as typeof HTMLCanvasElement.prototype.getContext;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            frameCallbacks.push(callback);
            return frameCallbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', (rafId: number) => {
            cancelledFrameIds.push(rafId);
        });
    });

    afterEach(() => {
        cleanup();
        HTMLCanvasElement.prototype.getContext = originalGetContext;
        vi.unstubAllGlobals();
    });

    /** Mounts one instance and lets it paint exactly its first frame. */
    const mountFirstFrame = (props: { trackId?: string } = {}) => {
        linePoints = [];
        return renderWithTooltip(<SpectrumAnalyzer {...props} />);
    };

    /** The spectrum vertex painted highest on screen (smallest y). */
    const topmostPoint = (): { x: number; y: number } => {
        expect(linePoints.length).toBeGreaterThan(0);
        return linePoints.reduce((top, point) => (point.y < top.y ? point : top));
    };

    /** Where a 0 dB bin must land, replicating the component's tilt math. */
    const expectedPeakFor = (hz: number): { x: number; y: number } => {
        const bin = Math.round(hz / HZ_PER_BIN);
        const freq = bin * HZ_PER_BIN;
        const tiltedDb = 3 * Math.log2(Math.max(1, freq / 1000));
        return { x: freqToLogX(freq, WIDTH, NYQUIST_CAP), y: dbToY(tiltedDb, HEIGHT) };
    };

    it('should read from the master analyser when no trackId is given', () => {
        mountFirstFrame();

        expect(masterAnalyser.reads).toEqual([BIN_COUNT]);
        expect(trackAnalyser?.reads).toEqual([]);
        expect(getTrackAnalyser).not.toHaveBeenCalled();
    });

    it('should read from the track analyser when a trackId is given', () => {
        mountFirstFrame({ trackId: 'track-7' });

        expect(getTrackAnalyser).toHaveBeenCalledWith('track-7');
        expect(trackAnalyser?.reads).toEqual([BIN_COUNT]);
        expect(masterAnalyser.reads).toEqual([]);
    });

    it('should fall back to the master analyser when the track has none', () => {
        trackAnalyser = null;

        mountFirstFrame({ trackId: 'track-7' });

        expect(getTrackAnalyser).toHaveBeenCalledWith('track-7');
        expect(masterAnalyser.reads).toEqual([BIN_COUNT]);
    });

    it('should feed analyser frequency data into the painted spectrum', () => {
        writeSpectrum = spectrumWithToneAt(1000);
        mountFirstFrame();

        const expected = expectedPeakFor(1000);
        const peak = topmostPoint();
        expect(peak.y).toBeCloseTo(expected.y, 6);
        expect(peak.x).toBeCloseTo(expected.x, 6);
        // The path is not flat: bins away from the tone sit on the noise
        // floor, so the data genuinely modulates the geometry.
        expect(linePoints.some((point) => point.y > expected.y + 1)).toBe(true);

        // A different spectrum moves the painted peak accordingly.
        writeSpectrum = spectrumWithToneAt(2000);
        const second = expectedPeakFor(2000);
        const { unmount } = mountFirstFrame();
        const secondPeak = topmostPoint();
        expect(secondPeak.y).toBeCloseTo(second.y, 6);
        expect(secondPeak.x).toBeCloseTo(second.x, 6);
        unmount();
    });

    it('should re-read on scheduled animation frames and stop on unmount', () => {
        const { unmount } = mountFirstFrame();

        expect(frameCallbacks).toHaveLength(1);
        expect(masterAnalyser.reads).toEqual([BIN_COUNT]);

        frameCallbacks[0]?.(0);
        expect(masterAnalyser.reads).toEqual([BIN_COUNT, BIN_COUNT]);
        expect(frameCallbacks).toHaveLength(2);

        frameCallbacks[1]?.(16);
        expect(masterAnalyser.reads).toEqual([BIN_COUNT, BIN_COUNT, BIN_COUNT]);
        expect(frameCallbacks).toHaveLength(3);

        // The pending third tick is the one cancellation must stop.
        unmount();
        expect(cancelledFrameIds).toEqual([3]);
    });
});
