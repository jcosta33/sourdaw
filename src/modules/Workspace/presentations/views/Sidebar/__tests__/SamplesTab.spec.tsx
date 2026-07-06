import { type ReactElement } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { type PreviewHandle } from '../../../hooks/usePreviewAudio';
import { SamplesTab } from '../SamplesTab';

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: vi.fn(),
}));

const renderWithTooltip = (ui: ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

const createPreview = (): PreviewHandle => ({
    playingId: null,
    play: vi.fn<PreviewHandle['play']>(),
    playTone: vi.fn<PreviewHandle['playTone']>(),
    playFile: vi.fn<PreviewHandle['playFile']>().mockResolvedValue(undefined),
    stop: vi.fn<PreviewHandle['stop']>(),
});

const mockSamples = [
    { id: 's1', name: 'Kick', category: 'Drums', duration: '1.0s', audioBufferId: 'b1' },
    { id: 's2', name: 'Snare', category: 'Drums', duration: '0.5s', audioBufferId: 'b2' },
] satisfies React.ComponentProps<typeof SamplesTab>['samples'];

type RenderSamplesTabInput = {
    preview?: PreviewHandle;
};

const renderSamplesTab = ({ preview = createPreview() }: RenderSamplesTabInput = {}) => {
    renderWithTooltip(
        <SamplesTab
            samples={mockSamples}
            favorites={new Set()}
            onToggleFavorite={vi.fn<(id: string) => void>()}
            selectedTrackId="t1"
            preview={preview}
        />
    );

    return { preview };
};

const clickFirstPreviewButton = () => {
    const previewButtons = screen.getAllByRole('button', { name: 'Preview sound' });
    const firstPreviewButton = previewButtons[0];

    if (!firstPreviewButton) {
        throw new Error('Expected at least one preview button');
    }

    fireEvent.click(firstPreviewButton);
};

const cachedBuffer: AudioBuffer = {
    copyFromChannel: vi.fn<(destination: Float32Array, channelNumber: number, bufferOffset?: number) => void>(),
    copyToChannel: vi.fn<(source: Float32Array, channelNumber: number, bufferOffset?: number) => void>(),
    duration: 0.5,
    getChannelData: vi.fn<(channelNumber: number) => Float32Array>(() => new Float32Array(1)),
    length: 1,
    numberOfChannels: 1,
    sampleRate: 44100,
};

describe('SamplesTab', () => {
    beforeEach(() => {
        vi.mocked(getCachedAudioBuffer).mockReset();
        vi.mocked(getCachedAudioBuffer).mockReturnValue(null);
    });

    it('should render sample rows', () => {
        renderSamplesTab();

        expect(screen.getByText('Kick')).toBeInTheDocument();
        expect(screen.getByText('Snare')).toBeInTheDocument();
    });

    it('should preview a cached audio buffer through the AudioEngine cache read use case', () => {
        vi.mocked(getCachedAudioBuffer).mockReturnValue(cachedBuffer);
        const { preview } = renderSamplesTab();

        clickFirstPreviewButton();

        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'b1' });
        expect(preview.play).toHaveBeenCalledWith('s1', cachedBuffer);
        expect(preview.playTone).not.toHaveBeenCalled();
    });

    it('should play a fallback tone when the cached audio buffer is missing', () => {
        const { preview } = renderSamplesTab();

        clickFirstPreviewButton();

        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'b1' });
        expect(preview.play).not.toHaveBeenCalled();
        expect(preview.playTone).toHaveBeenCalledWith('s1', 261.63, 0.5);
    });
});
