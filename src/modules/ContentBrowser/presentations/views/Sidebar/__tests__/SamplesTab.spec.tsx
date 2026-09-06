import { type ReactElement } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { type PreviewHandle } from '../../../hooks/usePreviewAudio';
import { SamplesTab } from '../SamplesTab';

// Preview assertions spy through `getCachedAudioBuffer`; every other
// AudioEngine key in this factory is an unread graph-coverage stub (`vi.fn()`
// and `audioEngine: {}`).
vi.mock('#/modules/AudioEngine/useCases', () => ({
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    discardDecodedAudioFile: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    addMidiFxToStrip: vi.fn(),
    analyzePitchForClip: vi.fn(),
    applyNoteExpression: vi.fn(),
    applyRuntimeGraphDelta: vi.fn(),
    audioEngine: {},
    cacheAudioBuffer: vi.fn(),
    clearReportedLatency: vi.fn(),
    createRuntimeGraphTopologyFingerprint: vi.fn(),
    decodeAudioFile: vi.fn(),
    ensureBusStrip: vi.fn(),
    garbageCollectCachedAudioBuffersByAge: vi.fn(),
    garbageCollectCachedAudioBuffersBySize: vi.fn(),
    garbageCollectFreezeAudioBuffers: vi.fn(),
    getAudioContext: vi.fn(),
    getCompensationDelay: vi.fn(),
    getDefaultBendRangeSemitones: vi.fn(),
    getDeviceChainTailSeconds: vi.fn(),
    getEngineState: vi.fn(),
    getFactoryDrumKitByIndex: vi.fn(),
    getLiveEngineSampleRate: vi.fn(),
    getRuntimeGraphRevision: vi.fn(),
    getTrackStrip: vi.fn(),
    initializeTrackStripFromSnapshot: vi.fn(),
    matchesRuntimeDeviceChainTopology: vi.fn(),
    removeBusStrip: vi.fn(),
    removeMidiFxFromStrip: vi.fn(),
    removeSend: vi.fn(),
    removeTrackStrip: vi.fn(),
    renderTrackSubgraphOffline: vi.fn(),
    reportLatency: vi.fn(),
    resolveToasterPadBinding: vi.fn(),
    setBusGain: vi.fn(),
    setSend: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackOutput: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackSoloGate: vi.fn(),
    startInputMonitoring: vi.fn(),
    stopInputMonitoring: vi.fn(),
    unwireSidechainRoute: vi.fn(),
    updateDeviceBypass: vi.fn(),
    updateDeviceParam: vi.fn(),
    updateMidiFxBypass: vi.fn(),
    updateMidiFxParam: vi.fn(),
    wireSidechainRoute: vi.fn(),
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
    getChannelData: vi.fn<(channelNumber: number) => Float32Array<ArrayBuffer>>(() => new Float32Array(1)),
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
