import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { PhaseCorrelationDisplay } from '../PhaseCorrelationDisplay';

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

const getMasterStereoAnalysers = vi.fn();
const meterUpdate = vi.fn((_left: Float32Array, _right: Float32Array) => 0);

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getMasterStereoAnalysers: (...args: unknown[]) => getMasterStereoAnalysers(...args),
    PhaseCorrelationMeter: class {
        update(left: Float32Array, right: Float32Array): number {
            return meterUpdate(left, right);
        }
        get value(): number {
            return 0;
        }
        reset(): void {}
    },
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

describe('PhaseCorrelationDisplay', () => {
    const leftSamples = [1, 1, 1];
    const rightSamples = [-1, -1, -1];

    beforeEach(() => {
        vi.clearAllMocks();
        getMasterStereoAnalysers.mockReturnValue({
            left: makeAnalyser(leftSamples),
            right: makeAnalyser(rightSamples),
        });
    });

    it('should render without crashing', () => {
        renderWithTooltip(<PhaseCorrelationDisplay />);
        expect(document.body).toBeTruthy();
    });

    it('feeds the meter genuinely independent left/right channels from getMasterStereoAnalysers', () => {
        renderWithTooltip(<PhaseCorrelationDisplay />);

        // This is the crux of the fix: the pre-fix component called
        // getMasterAnalyser() (a single mono-summed analyser) and derived
        // pseudo L/R by splitting its consecutive samples at even/odd
        // indices — reading adjacent samples of one signal as a stereo pair.
        // The fix reads two genuinely independent per-channel analysers and
        // passes their real content straight to the meter, unmodified.
        expect(getMasterStereoAnalysers).toHaveBeenCalled();
        expect(meterUpdate).toHaveBeenCalled();
        const [left, right] = meterUpdate.mock.calls.at(-1)!;
        expect(Array.from(left)).toEqual(leftSamples);
        expect(Array.from(right)).toEqual(rightSamples);
    });
});
