import { type ReactElement } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { addClip, addTrack } from '#/modules/Arrangement/useCases';
import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { type SampleItem } from '../../../components/Sidebar/sidebarConstants';
import { type PreviewHandle } from '../../../hooks/usePreviewAudio';
import { SamplesTab } from '../SamplesTab';

vi.mock('#/modules/Arrangement/useCases', () => ({
    addTrack: vi.fn(() => ({ id: 'new-track-id', name: 'New Track', kind: 'audio' })),
    addClip: vi.fn(),
}));

// Preview assertions spy through `getCachedAudioBuffer`; every other
// AudioEngine key in this factory is an unread graph-coverage stub (`vi.fn()`
// and `audioEngine: {}`).
vi.mock('#/modules/AudioEngine/useCases', () => ({
    soundsNativeNotes: vi.fn(() => false),
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
    isDeviceCarriedByNativeSession: () => false,
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
    selectedTrackId?: string | null;
    samples?: SampleItem[];
};

const renderSamplesTab = ({
    preview = createPreview(),
    selectedTrackId = 't1',
    samples = mockSamples,
}: RenderSamplesTabInput = {}) => {
    renderWithTooltip(
        <SamplesTab
            samples={samples}
            favorites={new Set()}
            onToggleFavorite={vi.fn<(id: string) => void>()}
            selectedTrackId={selectedTrackId}
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
        vi.mocked(addTrack).mockReset();
        vi.mocked(addTrack).mockReturnValue({ id: 'new-track-id', name: 'New Track', kind: 'audio' });
        vi.mocked(addClip).mockReset();
        transportStore.set({ ...defaultTransportState });
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

    it('creates clip with duration 4 beats when clicking a 4-second sample at 60 BPM', () => {
        transportStore.set({ ...defaultTransportState, tempo: 60 });
        const samples: SampleItem[] = [
            {
                id: 's-4s',
                name: 'Ambient Pad',
                category: 'Pads',
                duration: '4.0s',
                audioBufferId: 'b-4s',
                durationSeconds: 4.0,
            },
        ];
        renderSamplesTab({ samples });

        fireEvent.click(screen.getByText('Ambient Pad'));

        expect(addClip).toHaveBeenCalledWith({
            trackId: 't1',
            startBeat: 0,
            endBeat: 4,
            name: 'Ambient Pad',
            type: 'audio',
            audioBufferId: 'b-4s',
        });
    });

    it('creates clip with duration 8 beats when clicking a 4-second sample at 120 BPM', () => {
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        const samples: SampleItem[] = [
            {
                id: 's-4s',
                name: 'Ambient Pad',
                category: 'Pads',
                duration: '4.0s',
                audioBufferId: 'b-4s',
                durationSeconds: 4.0,
            },
        ];
        renderSamplesTab({ samples });

        fireEvent.click(screen.getByText('Ambient Pad'));

        expect(addClip).toHaveBeenCalledWith({
            trackId: 't1',
            startBeat: 0,
            endBeat: 8,
            name: 'Ambient Pad',
            type: 'audio',
            audioBufferId: 'b-4s',
        });
    });

    it('creates clip with duration 16 beats when clicking a 4-second sample at 240 BPM', () => {
        transportStore.set({ ...defaultTransportState, tempo: 240 });
        const samples: SampleItem[] = [
            {
                id: 's-4s',
                name: 'Ambient Pad',
                category: 'Pads',
                duration: '4.0s',
                audioBufferId: 'b-4s',
                durationSeconds: 4.0,
            },
        ];
        renderSamplesTab({ samples });

        fireEvent.click(screen.getByText('Ambient Pad'));

        expect(addClip).toHaveBeenCalledWith({
            trackId: 't1',
            startBeat: 0,
            endBeat: 16,
            name: 'Ambient Pad',
            type: 'audio',
            audioBufferId: 'b-4s',
        });
    });

    it('creates clip with ceil-rounded duration (7 beats) for fractional 3.2s duration at 120 BPM', () => {
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        const samples: SampleItem[] = [
            {
                id: 's-3.2s',
                name: 'Guitar Riff',
                category: 'Guitars',
                duration: '3.2s',
                audioBufferId: 'b-3.2s',
                durationSeconds: 3.2,
            },
        ];
        renderSamplesTab({ samples });

        fireEvent.click(screen.getByText('Guitar Riff'));

        expect(addClip).toHaveBeenCalledWith({
            trackId: 't1',
            startBeat: 0,
            endBeat: 7,
            name: 'Guitar Riff',
            type: 'audio',
            audioBufferId: 'b-3.2s',
        });
    });

    it('resolves cached buffer duration and computes correct beats when durationSeconds is omitted on sample', () => {
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        vi.mocked(getCachedAudioBuffer).mockReturnValue({
            ...cachedBuffer,
            duration: 3.0,
        });
        const samples: SampleItem[] = [
            { id: 's-cached', name: 'Vocal Chop', category: 'Vocals', duration: '3.0s', audioBufferId: 'b-cached' },
        ];
        renderSamplesTab({ samples });

        fireEvent.click(screen.getByText('Vocal Chop'));

        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'b-cached' });
        expect(addClip).toHaveBeenCalledWith({
            trackId: 't1',
            startBeat: 0,
            endBeat: 6,
            name: 'Vocal Chop',
            type: 'audio',
            audioBufferId: 'b-cached',
        });
    });

    it('defaults to 8 beats when neither durationSeconds nor cached buffer is present', () => {
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        vi.mocked(getCachedAudioBuffer).mockReturnValue(null);
        const samples: SampleItem[] = [
            { id: 's-unknown', name: 'Mystery Sample', category: 'FX', duration: 'unknown' },
        ];
        renderSamplesTab({ samples });

        fireEvent.click(screen.getByText('Mystery Sample'));

        expect(addClip).toHaveBeenCalledWith({
            trackId: 't1',
            startBeat: 0,
            endBeat: 8,
            name: 'Mystery Sample',
            type: 'audio',
            audioBufferId: undefined,
        });
    });

    it('creates a new track when selectedTrackId is null before adding clip', () => {
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        const samples: SampleItem[] = [
            { id: 's-1', name: 'Kick', category: 'Drums', duration: '1.0s', audioBufferId: 'b1', durationSeconds: 1.0 },
        ];
        renderSamplesTab({ samples, selectedTrackId: null });

        fireEvent.click(screen.getByText('Kick'));

        expect(addTrack).toHaveBeenCalledWith({ name: 'Kick', kind: 'audio' });
        expect(addClip).toHaveBeenCalledWith({
            trackId: 'new-track-id',
            startBeat: 0,
            endBeat: 2,
            name: 'Kick',
            type: 'audio',
            audioBufferId: 'b1',
        });
    });
});
