import { type ReactElement } from 'react';

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import { useProofAnalyser } from '../../hooks/useProofAnalyser';
import { TonalBalance } from '../TonalBalance';

const engineMocks = vi.hoisted(() => ({
    getMasterAnalyser: vi.fn<() => unknown>(() => null),
    getAudioSampleRate: vi.fn(() => 48000),
    isEngineAudioAvailable: vi.fn(() => true),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getMasterAnalyser: engineMocks.getMasterAnalyser,
    getAudioSampleRate: engineMocks.getAudioSampleRate,
    isEngineAudioAvailable: engineMocks.isEngineAudioAvailable,
}));

/** The live pairing the panel builds: the hook's verdict drives the overlay. */
const LiveTonalBalance = (): ReactElement => {
    const { status, fftData, fftVersion, sampleRate, fftSize } = useProofAnalyser();
    return (
        <TonalBalance
            status={status}
            fftData={fftData}
            fftVersion={fftVersion}
            sampleRate={sampleRate}
            fftSize={fftSize}
            width={200}
            height={80}
        />
    );
};

function makeMasterAnalyserStub(): unknown {
    return {
        context: {
            createAnalyser: () => ({
                fftSize: 2048,
                smoothingTimeConstant: 0,
                frequencyBinCount: 8,
                getFloatFrequencyData: vi.fn(),
                disconnect: vi.fn(),
            }),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
    };
}

type GetContext2d = (contextId: '2d', options?: CanvasRenderingContext2DSettings) => CanvasRenderingContext2D | null;

function spyOnGetContext(ctx: CanvasRenderingContext2D | null): void {
    const proto: { getContext: GetContext2d } = HTMLCanvasElement.prototype;
    vi.spyOn(proto, 'getContext').mockReturnValue(ctx);
}

function make2dContext(): CanvasRenderingContext2D {
    return document.createElement('canvas').getContext('2d')!;
}

describe('TonalBalance', () => {
    // Re-seeded per test: `restoreAllMocks` strips the implementations off these
    // module mocks too, so a later test would read `undefined` availability.
    beforeEach(() => {
        engineMocks.getMasterAnalyser.mockReturnValue(null);
        engineMocks.getAudioSampleRate.mockReturnValue(48000);
        engineMocks.isEngineAudioAvailable.mockReturnValue(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should render', () => {
        const { container } = render(
            <TonalBalance
                status="active"
                fftData={null}
                fftVersion={0}
                sampleRate={44100}
                fftSize={2048}
                width={200}
                height={80}
            />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('scales the backing store to devicePixelRatio before painting', () => {
        const ctx = make2dContext();
        const scaleSpy = vi.spyOn(ctx, 'scale');
        spyOnGetContext(ctx);
        vi.stubGlobal('devicePixelRatio', 2);

        const { container } = render(
            <TonalBalance
                status="active"
                fftData={null}
                fftVersion={0}
                sampleRate={44100}
                fftSize={2048}
                width={200}
                height={80}
            />
        );
        const canvas = container.querySelector('canvas');
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new TypeError('Expected a TonalBalance canvas');
        }

        expect(canvas.width).toBe(400);
        expect(canvas.height).toBe(160);
        expect(scaleSpy).toHaveBeenCalledWith(2, 2);

        vi.unstubAllGlobals();
    });

    it('paints the grid, Harman target curve, and target-band fill even with no signal', () => {
        const ctx = make2dContext();
        const strokeSpy = vi.spyOn(ctx, 'stroke');
        const fillSpy = vi.spyOn(ctx, 'fill');
        const fillTextSpy = vi.spyOn(ctx, 'fillText');
        const setLineDashSpy = vi.spyOn(ctx, 'setLineDash');
        spyOnGetContext(ctx);

        render(
            <TonalBalance
                status="active"
                fftData={null}
                fftVersion={0}
                sampleRate={44100}
                fftSize={2048}
                width={200}
                height={80}
            />
        );

        // Grid lines + the dashed target curve are stroked; the tolerance band is filled.
        expect(strokeSpy).toHaveBeenCalled();
        expect(fillSpy).toHaveBeenCalled();
        // The dashed target curve toggles the line dash on then clears it.
        expect(setLineDashSpy).toHaveBeenCalledWith([4, 4]);
        expect(setLineDashSpy).toHaveBeenCalledWith([]);
        // The always-drawn legend label identifies the target curve.
        expect(fillTextSpy).toHaveBeenCalledWith('Harman Target', expect.any(Number), expect.any(Number));
    });

    it('bails out without painting when the 2d context is unavailable', () => {
        spyOnGetContext(null);

        // No throw and nothing to assert on the context — the guard returns early.
        expect(() =>
            render(
                <TonalBalance
                    status="active"
                    fftData={null}
                    fftVersion={0}
                    sampleRate={44100}
                    fftSize={2048}
                    width={200}
                    height={80}
                />
            )
        ).not.toThrow();
    });

    it('draws the filled spectrum area and stroked spectrum line when FFT data is present', () => {
        const ctx = make2dContext();
        const createGradientSpy = vi.spyOn(ctx, 'createLinearGradient');
        const fillSpy = vi.spyOn(ctx, 'fill');
        spyOnGetContext(ctx);

        // In-band magnitudes (above the -50 dB floor) so the spectrum path is drawn.
        const fftData = new Float32Array(1024).fill(-20);
        render(
            <TonalBalance
                status="active"
                fftData={fftData}
                fftVersion={1}
                sampleRate={44100}
                fftSize={2048}
                width={200}
                height={80}
            />
        );

        // The idle draw makes one gradient (background); the live spectrum area adds a second.
        expect(createGradientSpy).toHaveBeenCalledTimes(2);
        expect(fillSpy).toHaveBeenCalled();
    });

    it('applies genre adjustments to the target curve so a bass-forward genre moves points off Harman neutral', () => {
        const collectLinePoints = (genre: string | undefined): number[] => {
            const ctx = make2dContext();
            const points: number[] = [];
            vi.spyOn(ctx, 'lineTo').mockImplementation((_x, y) => {
                points.push(y);
            });
            spyOnGetContext(ctx);

            render(
                <TonalBalance
                    status="active"
                    fftData={null}
                    fftVersion={0}
                    sampleRate={44100}
                    fftSize={2048}
                    width={200}
                    height={80}
                    genre={genre}
                />
            );
            vi.restoreAllMocks();
            return points;
        };

        // Grid and target-band line points are genre-independent; only the Harman
        // target curve's interior points move, so the full lineTo sequence differs.
        const neutral = collectLinePoints(undefined);
        const edm = collectLinePoints('edm');

        expect(edm).toHaveLength(neutral.length);
        expect(edm).not.toEqual(neutral);
    });

    it('treats an empty FFT buffer as no signal and skips the spectrum gradient', () => {
        const ctx = make2dContext();
        const createGradientSpy = vi.spyOn(ctx, 'createLinearGradient');
        spyOnGetContext(ctx);

        const empty = new Float32Array(0);
        render(
            <TonalBalance
                status="active"
                fftData={empty}
                fftVersion={1}
                sampleRate={44100}
                fftSize={2048}
                width={200}
                height={80}
            />
        );

        // Only the background gradient is created — no spectrum area gradient.
        expect(createGradientSpy).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['unavailable', true],
        ['active', false],
    ] as const)('announces an unavailable analyser and stays quiet when it is %s', (status, announced) => {
        render(
            <TonalBalance
                status={status}
                fftData={null}
                fftVersion={0}
                sampleRate={44100}
                fftSize={2048}
                width={200}
                height={80}
            />
        );

        const notice = screen.queryByRole('status');
        expect(notice !== null).toBe(announced);
        if (notice) {
            expect(notice).toHaveTextContent('Spectrum analyser unavailable');
        }
    });

    it('shows the dead-tap notice when the engine is running its silent fallback shim', () => {
        // The shim's analyser connects and reads back like a real one, so the
        // notice only ever appears if availability comes from the engine itself.
        engineMocks.isEngineAudioAvailable.mockReturnValue(false);
        engineMocks.getMasterAnalyser.mockReturnValue(makeMasterAnalyserStub());

        render(<LiveTonalBalance />);

        expect(screen.getByRole('status')).toHaveTextContent('Spectrum analyser unavailable');
    });

    it('never flashes the dead-tap notice on a live analyser, not even on the first render', () => {
        engineMocks.isEngineAudioAvailable.mockReturnValue(true);
        engineMocks.getMasterAnalyser.mockReturnValue(makeMasterAnalyserStub());
        vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);

        // No frame is ever delivered here: a status raised from the frame loop
        // would leave the notice painted over a working spectrum.
        render(<LiveTonalBalance />);

        expect(screen.queryByRole('status')).toBeNull();
    });
});
