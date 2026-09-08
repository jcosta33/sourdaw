import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type TrackStoreState, trackStore } from '#/modules/Arrangement/stores';
import { importMidiFile } from '#/modules/Arrangement/useCases';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { type MidiStoreState, midiStore } from '../../stores';
import { downloadMidiFile } from '../../useCases';

import '../midiImportWorker';

const mocks = vi.hoisted(() => ({
    downloadBlob: vi.fn(),
}));

vi.mock('../../repositories/downloadFile', () => ({
    downloadBlob: mocks.downloadBlob,
}));

type RootProjectDocument = {
    midi?: MidiStoreState;
    tracks?: TrackStoreState;
};

type WorkerGlobal = {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: (message: unknown) => void;
};

const workerGlobal = self as unknown as WorkerGlobal;
const actualWorkerHandler = workerGlobal.onmessage;
const originalPostMessage = workerGlobal.postMessage;

class InlineMidiImportWorker {
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;

    postMessage(message: unknown): void {
        if (!actualWorkerHandler) {
            throw new TypeError('Expected the MIDI import worker to register its message handler');
        }

        workerGlobal.postMessage = (response) => {
            this.onmessage?.(new MessageEvent('message', { data: response }));
        };
        try {
            actualWorkerHandler(new MessageEvent('message', { data: message }));
        } catch (error) {
            this.onerror?.(
                new ErrorEvent('error', { message: error instanceof Error ? error.message : String(error) })
            );
        } finally {
            workerGlobal.postMessage = originalPostMessage;
        }
    }

    terminate(): void {}
}

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function lastDownloadedBytes(): Uint8Array<ArrayBuffer> {
    const call = mocks.downloadBlob.mock.calls.at(-1);
    if (!call || !(call[0] instanceof Uint8Array)) {
        throw new TypeError('Expected the MIDI exporter to download bytes');
    }
    return new Uint8Array(call[0]);
}

function findSequence(bytes: Uint8Array, sequence: readonly number[]): number {
    for (let start = 0; start <= bytes.length - sequence.length; start++) {
        if (sequence.every((value, offset) => bytes[start + offset] === value)) {
            return start;
        }
    }
    return -1;
}

function useRunningStatusForSecondSustain(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    const statusIndex = findSequence(bytes, [0xb9, 64, 0]);
    if (statusIndex < 0) {
        throw new Error('Expected a second explicit channel-9 sustain event');
    }

    const runningStatusBytes = new Uint8Array(bytes.length - 1);
    runningStatusBytes.set(bytes.subarray(0, statusIndex));
    runningStatusBytes.set(bytes.subarray(statusIndex + 1), statusIndex);

    const trackLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(18);
    new DataView(runningStatusBytes.buffer).setUint32(18, trackLength - 1);
    return runningStatusBytes;
}

function requireRootDocument(): RootProjectDocument {
    const document = getCrdtDoc<RootProjectDocument>('root');
    if (!document) {
        throw new Error('Expected the root CRDT document');
    }
    return document;
}

function requireImportedClip() {
    const track = trackStore.value?.tracks[0];
    const clip = track?.clips[0];
    if (!track || !clip) {
        throw new Error('Expected an imported MIDI track and clip');
    }
    return { clip, track };
}

describe('importMidiFile serialized owner integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('Worker', InlineMidiImportWorker);
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('MIDI import serialized owner integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        flushAutomergeStorageWrites();
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    afterAll(() => {
        workerGlobal.postMessage = originalPostMessage;
    });

    it('preserves overlapping same-pitch note channels and CC fields from exported bytes', async () => {
        downloadMidiFile({
            clipName: 'Layered',
            clipStartBeat: 0,
            notes: [
                { id: 'source-3', pitch: 60, startBeat: 0, duration: 1, velocity: 90, channel: 3 },
                { id: 'source-9', pitch: 60, startBeat: 0, duration: 2, velocity: 70, channel: 9 },
            ],
            ccs: [{ id: 'source-cc', controller: 1, value: 72, beat: 3, channel: 9 }],
        });

        const file = new File([lastDownloadedBytes()], 'layered.mid', { type: 'audio/midi' });
        await expect(importMidiFile(file, { shouldContinue: () => true })).resolves.toBe('completed');
        flushAutomergeStorageWrites();
        projectCrdtToStores({ resetProjections: true });

        const { clip } = requireImportedClip();
        expect(midiStore.value?.notesByClipId[clip.id]).toMatchObject([
            { pitch: 60, startBeat: 0, duration: 1, velocity: 90, channel: 3 },
            { pitch: 60, startBeat: 0, duration: 2, velocity: 70, channel: 9 },
        ]);
        expect(midiStore.value?.ccByClipId[clip.id]).toMatchObject([{ controller: 1, value: 72, beat: 3, channel: 9 }]);
        expect(requireRootDocument().midi).toEqual(midiStore.value);
        expect(requireRootDocument().tracks?.tracks).toEqual(trackStore.value?.tracks);
    });

    it('imports running-status controller-only bytes through real stores and undo history', async () => {
        downloadMidiFile({
            clipName: 'Sustain',
            clipStartBeat: 0,
            notes: [],
            ccs: [
                { id: 'source-down', controller: 64, value: 127, beat: 0, channel: 9 },
                { id: 'source-up', controller: 64, value: 0, beat: 5, channel: 9 },
            ],
        });
        const bytes = useRunningStatusForSecondSustain(lastDownloadedBytes());

        await expect(
            importMidiFile(new File([bytes], 'sustain.mid', { type: 'audio/midi' }), {
                shouldContinue: () => true,
            })
        ).resolves.toBe('completed');
        flushAutomergeStorageWrites();
        projectCrdtToStores({ resetProjections: true });

        const imported = requireImportedClip();
        const importedTrackId = imported.track.id;
        const importedClipId = imported.clip.id;
        const importedCCs = midiStore.value?.ccByClipId[importedClipId];
        expect(imported.clip.endBeat).toBe(8);
        expect(midiStore.value?.notesByClipId[importedClipId]).toEqual([]);
        expect(importedCCs).toMatchObject([
            { controller: 64, value: 127, beat: 0, channel: 9 },
            { controller: 64, value: 0, beat: 5, channel: 9 },
        ]);
        expect(new Set(importedCCs?.map((cc) => cc.id)).size).toBe(2);
        expect(importedCCs?.every((cc) => cc.beat < imported.clip.endBeat - imported.clip.startBeat)).toBe(true);
        expect(requireRootDocument().midi).toEqual(midiStore.value);
        expect(requireRootDocument().tracks?.tracks).toEqual(trackStore.value?.tracks);

        await expect(undo()).resolves.toEqual({ headConsumed: true });
        flushAutomergeStorageWrites();
        projectCrdtToStores({ resetProjections: true });
        expect(trackStore.value?.tracks).toEqual([]);
        expect(midiStore.value?.notesByClipId).not.toHaveProperty(importedClipId);
        expect(midiStore.value?.ccByClipId).not.toHaveProperty(importedClipId);
        expect(requireRootDocument().midi).toEqual(midiStore.value);
        expect(requireRootDocument().tracks?.tracks).toEqual([]);

        await redo();
        flushAutomergeStorageWrites();
        projectCrdtToStores({ resetProjections: true });
        const redone = requireImportedClip();
        expect(redone.track.id).toBe(importedTrackId);
        expect(redone.clip).toMatchObject({ id: importedClipId, endBeat: 8 });
        expect(midiStore.value?.notesByClipId[importedClipId]).toEqual([]);
        expect(midiStore.value?.ccByClipId[importedClipId]).toEqual(importedCCs);
        expect(requireRootDocument().midi).toEqual(midiStore.value);
        expect(requireRootDocument().tracks?.tracks).toEqual(trackStore.value?.tracks);
    });
});
