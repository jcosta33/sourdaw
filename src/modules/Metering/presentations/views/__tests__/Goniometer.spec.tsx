import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { Goniometer, computeLissajousPoint } from '../Goniometer';

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

const getMasterStereoAnalysers = vi.fn();

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getMasterStereoAnalysers: (...args: unknown[]) => getMasterStereoAnalysers(...args),
}));

type MockAnalyser = { fftSize: number; getFloatTimeDomainData: ReturnType<typeof vi.fn> };

function makeAnalyser(samples: number[]): MockAnalyser {
    return {
        fftSize: samples.length,
        getFloatTimeDomainData: vi.fn((buffer: Float32Array) => {
            buffer.set(samples);
        }),
    };
}

describe('computeLissajousPoint — M/S rotation math', () => {
    it('rotates identical L/R (mono, centred) onto the vertical M axis with zero S', () => {
        const { message, state } = computeLissajousPoint(0.5, 0.5);
        expect(message).toBeCloseTo(0.5 * Math.SQRT2, 5);
        expect(state).toBeCloseTo(0, 5);
    });

    it('rotates fully out-of-phase L/-R onto the horizontal S axis with zero M', () => {
        const { message, state } = computeLissajousPoint(0.5, -0.5);
        expect(message).toBeCloseTo(0, 5);
        expect(state).toBeCloseTo(0.5 * Math.SQRT2, 5);
    });

    it('rotates digital silence to the origin, deterministically', () => {
        const { message, state } = computeLissajousPoint(0, 0);
        expect(message).toBe(0);
        expect(state).toBe(0);
    });
});

describe('Goniometer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getMasterStereoAnalysers.mockReturnValue({
            left: makeAnalyser([1, -1, 0.5]),
            right: makeAnalyser([-1, 1, -0.5]),
        });
    });

    it('should render without crashing', () => {
        renderWithTooltip(<Goniometer />);
        expect(document.body).toBeTruthy();
    });

    it('reads left and right from two independent analysers via getMasterStereoAnalysers', () => {
        renderWithTooltip(<Goniometer />);

        // This is the crux of the fix: the pre-fix Goniometer called
        // getMasterAnalyser() (a single mono-summed analyser) and derived
        // pseudo L/R by splitting its consecutive samples at even/odd
        // indices. That reads adjacent samples of one signal, never a real
        // stereo pair. The fix reads two genuinely independent per-channel
        // analysers instead — asserting this call proves the pair is real.
        expect(getMasterStereoAnalysers).toHaveBeenCalled();
        const { left, right } = getMasterStereoAnalysers.mock.results.at(-1)!.value as {
            left: MockAnalyser;
            right: MockAnalyser;
        };
        expect(left.getFloatTimeDomainData).toHaveBeenCalled();
        expect(right.getFloatTimeDomainData).toHaveBeenCalled();
        // Each channel is read into its own buffer, not sliced out of a
        // shared interleaved one.
        expect(left.getFloatTimeDomainData.mock.calls[0]![0]).not.toBe(right.getFloatTimeDomainData.mock.calls[0]![0]);
    });
});
