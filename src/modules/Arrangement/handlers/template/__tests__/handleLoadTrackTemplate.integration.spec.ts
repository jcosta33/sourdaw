import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { trackStore } from '../../../stores/trackStore';
import { ArrangementEventBus, setArrangementEventBus } from '../../../useCases/arrangementEventBus';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { trackTemplateCache } from '../../../useCases/trackTemplate';

class NoopArrangementEventBus extends ArrangementEventBus {
    async emit(): Promise<void> {}
}

// Restoring a track drives the live engine strip on `afterCommit`, which jsdom's
// stubbed AudioContext cannot build. The subject here is which tracks project truth
// holds after undo and redo, so the engine seam is stubbed rather than exercised.
// Partial, over the real barrel: the restore path reaches further into the engine
// than a hand-listed mock can anticipate, and a missing export fails as an
// unrelated post-commit error rather than as the assertion under test.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getAudioContext: vi.fn(() => ({ currentTime: 0, sampleRate: 48000 })),
    getAudioDevices: vi.fn(() => Promise.resolve([])),
    getTrackAnalyser: vi.fn(() => null),
    getMasterAnalyser: vi.fn(() => null),
    createTrackStrip: vi.fn(),
    removeTrackStrip: vi.fn(),
    updateDeviceParam: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackSolo: vi.fn(),
    setTrackSoloGate: vi.fn(),
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

describe('loadTrackTemplate undo/redo integration', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('load track template integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        setArrangementEventBus(new NoopArrangementEventBus());
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        trackTemplateCache.templates = [
            {
                id: 'tmpl-lead',
                name: 'Lead',
                category: 'user',
                trackKind: 'audio',
                devices: [],
                sends: [],
                gain: 0.8,
                pan: 0,
                color: '#123456',
                createdAt: 0,
            },
        ];
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackTemplateCache.templates = null;
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('redoes the template load by restoring the tracks it created, so the next undo can still remove them', async () => {
        await executeAppAction(
            { type: 'loadTrackTemplate', payload: { templateId: 'tmpl-lead' } },
            {
                source: 'manual',
            }
        );

        expect(trackStore.value?.tracks).toHaveLength(1);
        const createdId = trackStore.value!.tracks[0]!.id;

        await undo();
        expect(trackStore.value?.tracks).toEqual([]);

        await redo();
        // `loadTrackTemplate` mints `track-${crypto.randomUUID()}` on every run, so a
        // redo that replayed the forward action would leave a track the undo entry's
        // `discardCreatedTracks` inverse does not name.
        expect(trackStore.value?.tracks.map((track) => track.id)).toEqual([createdId]);

        await undo();
        // The decisive assertion: undo after redo actually removes the template's
        // tracks. Against a redo that re-ran the template, `discardCreatedTracks`
        // conflicts on an id nothing holds, so this leaves the track in the project —
        // and, because a conflicted undo does not pop its entry, every later undo
        // press retries it and no older entry is ever reachable again.
        expect(trackStore.value?.tracks).toEqual([]);
    });

    it('keeps unwinding past the template entry after a redo', async () => {
        await executeAppAction({ type: 'addTrack', payload: { name: 'Drums', kind: 'audio' } }, { source: 'manual' });
        const firstTrackId = trackStore.value!.tracks[0]!.id;

        await executeAppAction(
            { type: 'loadTrackTemplate', payload: { templateId: 'tmpl-lead' } },
            {
                source: 'manual',
            }
        );
        expect(trackStore.value?.tracks).toHaveLength(2);

        await undo();
        await redo();
        await undo();
        expect(trackStore.value?.tracks.map((track) => track.id)).toEqual([firstTrackId]);

        // The entry beneath the template load is only reachable when the template
        // entry itself popped.
        await undo();
        expect(trackStore.value?.tracks).toEqual([]);
    });
});
