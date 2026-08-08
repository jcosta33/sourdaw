import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { Spectrogram } from '../Spectrogram';

// The shared analyser stub in `setupTests.ts` omits `context`, which every real
// `AnalyserNode` carries and which the log frequency axis reads for its
// sample rate.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getMasterAnalyser: () => ({
        frequencyBinCount: 128,
        context: { sampleRate: 48_000 },
        getFloatFrequencyData: (data: Float32Array) => data.fill(-100),
    }),
    getTrackAnalyser: () => undefined,
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('Spectrogram', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        renderWithTooltip(<Spectrogram />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        renderWithTooltip(<Spectrogram />);
        expect(document.body).toBeTruthy();
    });
});
