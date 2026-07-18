import { type ReactNode } from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { asBaseAudioContext, createMockAudioContext, MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';

import { ExportDialog } from '../ExportDialog';

type TestClip = {
    id: string;
    trackId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    type: 'audio';
    audioBufferId?: string;
    fadeInBeats: number;
    fadeOutBeats: number;
    gain: number;
    color: string;
    locked: boolean;
    muted: boolean;
};

type TestTrack = {
    id: string;
    name: string;
    kind: 'audio';
    clips: TestClip[];
};

type TestTrackStoreState = {
    tracks: TestTrack[];
    selectedTrackId: string | null;
    ghostClips: TestClip[];
};

type TestStore<TData> = {
    value: TData;
};

type TestTransportState = {
    loopStart: number;
    loopEnd: number;
};

type TestClipSelectionState = {
    marqueeSelection: null;
};

type ExportDialogMocks = {
    audioContext: BaseAudioContext | null;
    encodeWav: ReturnType<typeof vi.fn>;
    getAudioContext: ReturnType<typeof vi.fn<() => BaseAudioContext | null>>;
    isExportActive: ReturnType<typeof vi.fn<() => boolean>>;
    loggerError: ReturnType<typeof vi.fn>;
    loggerWarn: ReturnType<typeof vi.fn>;
    notifyUser: ReturnType<typeof vi.fn>;
    renderOffline: ReturnType<typeof vi.fn>;
    restoreCachedAudioBuffersFromIdb: ReturnType<typeof vi.fn>;
    selectNativeAudioExportFile: ReturnType<typeof vi.fn>;
    trackStore: TestStore<TestTrackStoreState>;
    transportStore: TestStore<TestTransportState>;
    useStore: ReturnType<typeof vi.fn<(store: TestStore<unknown>, defaultValue?: unknown) => unknown>>;
    clipSelectionStore: TestStore<TestClipSelectionState>;
    writeNativeAudioMixdownFile: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted((): ExportDialogMocks => {
    const trackStore: TestStore<TestTrackStoreState> = {
        value: { tracks: [], selectedTrackId: null, ghostClips: [] },
    };
    const transportStore: TestStore<TestTransportState> = {
        value: { loopStart: 0, loopEnd: 0 },
    };
    const clipSelectionStore: TestStore<TestClipSelectionState> = {
        value: { marqueeSelection: null },
    };

    return {
        audioContext: null,
        encodeWav: vi.fn(),
        getAudioContext: vi.fn<() => BaseAudioContext | null>(() => null),
        isExportActive: vi.fn(() => false),
        loggerError: vi.fn(),
        loggerWarn: vi.fn(),
        notifyUser: vi.fn(),
        renderOffline: vi.fn(),
        restoreCachedAudioBuffersFromIdb: vi.fn(),
        selectNativeAudioExportFile: vi.fn(),
        trackStore,
        transportStore,
        useStore: vi.fn((store: TestStore<unknown>, defaultValue?: unknown) => store.value ?? defaultValue),
        clipSelectionStore,
        writeNativeAudioMixdownFile: vi.fn(),
    };
});

vi.mock('#/components/ui/dialog', () => ({
    Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) => (open ? <div>{children}</div> : null),
    DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        error: mocks.loggerError,
        warn: mocks.loggerWarn,
    },
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: mocks.useStore,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    defaultTrackState: { tracks: [], selectedTrackId: null, ghostClips: [] },
    trackStore: mocks.trackStore,
    defaultClipSelectionState: { selectedClipId: null, selectedClipIds: [], marqueeSelection: null },
    clipSelectionStore: mocks.clipSelectionStore,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cancelExport: vi.fn(),
    exportStems: vi.fn(),
    getAudioContext: mocks.getAudioContext,
    getAutoDetectedTailSeconds: vi.fn(() => 2),
    isExportActive: mocks.isExportActive,
    renderOffline: mocks.renderOffline,
    restoreCachedAudioBuffersFromIdb: mocks.restoreCachedAudioBuffersFromIdb,
}));

vi.mock('../../../useCases/audioBufferToWav', () => ({
    audioBufferToWav: mocks.encodeWav,
}));

vi.mock('../../../useCases/audioBufferToMp3', () => ({
    audioBufferToMp3: vi.fn(),
}));

vi.mock('../../../useCases/audioBufferToFlac', () => ({
    audioBufferToFlac: vi.fn(),
}));

vi.mock('#/modules/Transport/stores', () => ({
    defaultTransportState: { loopStart: 0, loopEnd: 0 },
    transportStore: mocks.transportStore,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('../../../useCases/audioExport/selectNativeAudioExportDirectory', () => ({
    selectNativeAudioExportDirectory: vi.fn(),
}));

vi.mock('../../../useCases/audioExport/selectNativeAudioExportFile', () => ({
    selectNativeAudioExportFile: mocks.selectNativeAudioExportFile,
}));

vi.mock('../../../useCases/audioExport/writeNativeAudioMixdownFile', () => ({
    writeNativeAudioMixdownFile: mocks.writeNativeAudioMixdownFile,
}));

vi.mock('../../../useCases/audioExport/writeNativeAudioStemFile', () => ({
    writeNativeAudioStemFile: vi.fn(),
}));

vi.mock('../../../useCases/renderToClip', () => ({
    renderToClip: vi.fn(),
}));

vi.mock('#/modules/Project/useCases', () => ({
    isNativeProjectRuntimeAvailable: vi.fn(() => true),
}));

vi.mock('../exportSettings', () => ({
    loadExportSettings: vi.fn(() => ({ formats: ['wav'], sampleRate: 44100, bitDepth: 24, mp3BitRate: 128 })),
    saveExportSettings: vi.fn(),
}));

function createClip(input: { id: string; audioBufferId?: string }): TestClip {
    return {
        id: input.id,
        trackId: 'track-1',
        name: input.id,
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        audioBufferId: input.audioBufferId,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ff0000',
        locked: false,
        muted: false,
    };
}

function setProjectClips(clips: TestClip[]): void {
    mocks.trackStore.value = {
        tracks: [
            {
                id: 'track-1',
                name: 'Track 1',
                kind: 'audio',
                clips,
            },
        ],
        selectedTrackId: 'track-1',
        ghostClips: [],
    };
}

async function startMixdownExport(): Promise<void> {
    render(<ExportDialog open={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /start baking/i }));

    await waitFor(() => {
        expect(mocks.renderOffline).toHaveBeenCalledTimes(1);
    });
}

describe('ExportDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.audioContext = asBaseAudioContext(createMockAudioContext());
        mocks.getAudioContext.mockImplementation(() => mocks.audioContext);
        mocks.restoreCachedAudioBuffersFromIdb.mockResolvedValue(0);
        mocks.selectNativeAudioExportFile.mockResolvedValue('/tmp/sourdaw-export.wav');
        mocks.renderOffline.mockResolvedValue(MockAudioBuffer.create(2, 128, 44100));
        mocks.encodeWav.mockResolvedValue(new Uint8Array([1, 2, 3]));
        mocks.writeNativeAudioMixdownFile.mockResolvedValue(undefined);
        setProjectClips([
            createClip({ id: 'clip-1', audioBufferId: 'buffer-1' }),
            createClip({ id: 'clip-2', audioBufferId: 'buffer-2' }),
        ]);
    });

    it('should restore referenced clip buffers through the AudioEngine owner use case before mixdown export', async () => {
        await startMixdownExport();

        expect(mocks.restoreCachedAudioBuffersFromIdb).toHaveBeenCalledWith({
            audioContext: mocks.audioContext,
            bufferIds: ['buffer-1', 'buffer-2'],
        });
    });

    it('should pass undefined buffer ids when no clips reference audio buffers', async () => {
        setProjectClips([createClip({ id: 'clip-without-buffer' })]);

        await startMixdownExport();

        expect(mocks.restoreCachedAudioBuffersFromIdb).toHaveBeenCalledWith({
            audioContext: mocks.audioContext,
            bufferIds: undefined,
        });
    });
});
