import { type ReactElement } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { addBrowserSample } from '../../../../useCases/addBrowserSample';
import { type SampleItem } from '../../../components/Sidebar/sidebarConstants';
import { type PreviewHandle } from '../../../hooks/usePreviewAudio';
import { SamplesTab } from '../SamplesTab';

vi.mock('../../../../useCases/addBrowserSample', () => ({
    addBrowserSample: vi.fn(),
}));

// Preview assertions spy through `getCachedAudioBuffer`; every other
// AudioEngine key in this factory is an unread graph-coverage stub (`vi.fn()`
// and `audioEngine: {}`).
vi.mock('#/modules/AudioEngine/useCases', () => ({
    soundsNativeNotes: vi.fn(() => false),
    writeNativeBuiltinParameters: vi.fn(),
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    discardDecodedAudioFile: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    playAudioBufferPreview: vi.fn(),
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
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiControl: () => Promise.resolve(true),
    sendNativeLiveMidiNote: () => Promise.resolve(true),
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

const mockSamples: SampleItem[] = [
    { id: 's1', name: 'Kick', category: 'Drums', duration: '1.0s', audioBufferId: 'b1', durationSeconds: 1.0 },
    { id: 's2', name: 'Snare', category: 'Drums', duration: '0.5s', audioBufferId: 'b2', durationSeconds: 0.5 },
];

type RenderSamplesTabInput = {
    preview?: PreviewHandle;
    samples?: SampleItem[];
};

const renderSamplesTab = ({ preview = createPreview(), samples = mockSamples }: RenderSamplesTabInput = {}) => {
    renderWithTooltip(
        <SamplesTab
            samples={samples}
            favorites={new Set()}
            onToggleFavorite={vi.fn<(id: string) => void>()}
            preview={preview}
        />
    );

    return { preview };
};

const clickPreviewButton = (sampleName: string) => {
    fireEvent.click(screen.getByRole('button', { name: `Preview ${sampleName}` }));
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
        vi.mocked(addBrowserSample).mockReset();
    });

    it('should render sample rows', () => {
        renderSamplesTab();

        expect(screen.getByText('Kick')).toBeInTheDocument();
        expect(screen.getByText('Snare')).toBeInTheDocument();
    });

    it('populates dataTransfer with sample details including durationSeconds on drag start', () => {
        renderSamplesTab();

        const kickRow = screen.getByText('Kick').closest('[draggable="true"]');
        expect(kickRow).not.toBeNull();

        const setData = vi.fn();
        const dataTransfer = {
            setData,
            effectAllowed: '',
        };

        fireEvent.dragStart(kickRow!, { dataTransfer });

        expect(setData).toHaveBeenCalledWith(
            'application/x-sourdaw-sample',
            JSON.stringify({
                name: 'Kick',
                id: 's1',
                duration: '1.0s',
                audioBufferId: 'b1',
                durationSeconds: 1.0,
            })
        );
        expect(dataTransfer.effectAllowed).toBe('copy');
    });

    it('should preview a cached audio buffer through the AudioEngine cache read use case', () => {
        vi.mocked(getCachedAudioBuffer).mockReturnValue(cachedBuffer);
        const { preview } = renderSamplesTab();

        clickPreviewButton('Kick');

        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'b1' });
        expect(preview.play).toHaveBeenCalledWith('s1', cachedBuffer);
        expect(preview.playTone).not.toHaveBeenCalled();
    });

    it('should play a fallback tone when the cached audio buffer is missing', () => {
        const { preview } = renderSamplesTab();

        clickPreviewButton('Kick');

        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'b1' });
        expect(preview.play).not.toHaveBeenCalled();
        expect(preview.playTone).toHaveBeenCalledWith('s1', 261.63, 0.5);
    });

    it('names each row preview and favorite button after its own sample', () => {
        renderSamplesTab();

        expect(screen.getByRole('button', { name: 'Preview Kick' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Preview Snare' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add Kick to favorites' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add Snare to favorites' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Preview sound' })).toBeNull();
    });

    it.each([
        ['Kick', { id: 's1', name: 'Kick', audioBufferId: 'b1', durationSeconds: 1.0 }],
        ['Snare', { id: 's2', name: 'Snare', audioBufferId: 'b2', durationSeconds: 0.5 }],
    ])('exposes a native Add action for %s and places that sample once', (sampleName, expected) => {
        renderSamplesTab();

        const addButton = screen.getByRole('button', { name: `Add ${sampleName} to timeline` });
        expect(addButton.tagName).toBe('BUTTON');
        fireEvent.click(addButton);

        expect(addBrowserSample).toHaveBeenCalledTimes(1);
        expect(addBrowserSample).toHaveBeenCalledWith(expected);
    });

    it('keeps Preview and Favorite separate from sample placement', () => {
        const onToggleFavorite = vi.fn<(id: string) => void>();
        renderWithTooltip(
            <SamplesTab
                samples={mockSamples}
                favorites={new Set()}
                onToggleFavorite={onToggleFavorite}
                preview={createPreview()}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Preview Kick' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add Kick to favorites' }));

        expect(addBrowserSample).not.toHaveBeenCalled();
        expect(onToggleFavorite).toHaveBeenCalledExactlyOnceWith('s1');
    });

    it('hands a clicked sample to the shared browser placement', () => {
        renderSamplesTab();

        fireEvent.click(screen.getByText('Kick'));

        expect(addBrowserSample).toHaveBeenCalledWith({
            id: 's1',
            name: 'Kick',
            audioBufferId: 'b1',
            durationSeconds: 1.0,
        });
    });
});
