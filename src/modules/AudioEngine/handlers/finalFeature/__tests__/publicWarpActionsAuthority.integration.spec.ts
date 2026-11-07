import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, warpStateStore, type Clip, type TrackStoreState } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    executeUserAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    syncActionReplayMetadata,
    undo,
} from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntries,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { projectOfflineAudioClipPlaybacks } from '../../../useCases/offlineRender/projectOfflineAudioClipPlaybacks';
import { handleEnableWarping } from '../handleEnableWarping';

type Root = {
    tracks: Pick<TrackStoreState, 'tracks'>;
    warpStates: NonNullable<typeof warpStateStore.value>;
    actionHistory: NonNullable<typeof actionHistoryStore.value>;
};

const enable = { type: 'enableWarping', payload: { clipId: 'audio' } } as const;
const metadataPort = {
    record: recordActionHistoryEntry,
    recordBatch: recordActionHistoryEntries,
    markReverted: markActionHistoryEntryReverted,
    clear: clearActionHistory,
};

function root() {
    const doc = getCrdtDoc<Root>('root');
    if (!doc) {
        throw new Error('Expected a real project document');
    }
    return doc;
}

function audioClip(): Clip {
    const clip = trackStore.value?.tracks[0]?.clips.find((candidate) => candidate.id === 'audio');
    if (!clip) {
        throw new Error('Expected the audio clip');
    }
    return clip;
}

function projectRate(): number[] {
    // Flat 120 BPM fixture: 0.5 seconds/beat; ample source avoids truncation.
    return projectOfflineAudioClipPlaybacks({
        clip: audioClip(),
        bufferDurationSeconds: 100,
        regionStartBeat: 0,
        regionStartSec: 0,
        durationSeconds: 20,
        compensationDelay: 0,
        projectBeatToSeconds: (beat) => beat * 0.5,
        resolveTempoAtBeat: () => 120,
    }).map((playback) => playback.playbackRate);
}

function seed(mode: 'off' | undefined): void {
    const clip: Clip = {
        id: 'audio',
        trackId: 'track',
        name: 'Source',
        type: 'audio',
        audioBufferId: 'source',
        startBeat: 2,
        endBeat: 6,
        audioOffsetSeconds: 0.25,
        stretchRatio: 2,
        ...(mode === undefined ? {} : { stretchMode: mode }),
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 0.75,
        color: '#112233',
        locked: false,
        muted: false,
    };
    const track = createTrack({ id: 'track', name: 'Audio', kind: 'audio', withoutDefaultDevice: true });
    trackStore.set({
        tracks: [
            {
                ...track,
                clips: [
                    clip,
                    { ...clip, id: 'keeper', startBeat: 10, endBeat: 14, stretchMode: 'off', stretchRatio: 0.5 },
                    {
                        id: 'midi',
                        trackId: 'track',
                        name: 'MIDI',
                        type: 'midi',
                        startBeat: 2,
                        endBeat: 6,
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '#445566',
                        locked: false,
                        muted: false,
                    },
                ],
            },
        ],
        selectedTrackId: track.id,
        ghostClips: [],
    });
    warpStateStore.set({
        states: {
            audio: {
                enabled: true,
                stretchMode: 'repitch',
                originalTempo: 120,
                markers: [{ id: 'marker', originalBeat: 1, warpedBeat: 1.25, locked: true, origin: 'user' }],
            },
        },
    });
    flushAutomergeStorageWrites();
}

describe('public Enable Audio Warping project authority', () => {
    let unsubscribe: () => void;

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('public warp command');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        clearHandlerRegistry();
        registerHandlerMap({ ...getArrangementHandlers(), enableWarping: handleEnableWarping });
        setActionHistoryMetadataPort(metadataPort);
        clearUndoHistory();
        resetActionReplayAuthority();
        clearActionHistory();
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        unsubscribe = actionHistoryStore.subscribe((state) => syncActionReplayMetadata(state?.entries ?? []));
    });

    afterEach(() => {
        unsubscribe();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each(['off', undefined] as const)(
        'enables repitch from %s with exact undo/redo and durable history',
        async (mode) => {
            seed(mode);
            await executeAppAction({ type: 'setTrackColor', payload: { trackId: 'track', color: '#abcdef' } });
            const before = structuredClone(trackStore.value);
            const rawBefore = structuredClone(root().tracks.tracks);
            const markers = structuredClone(warpStateStore.value);
            const priorHistory = structuredClone(actionHistoryStore.value);
            expect(priorHistory?.entries).toHaveLength(1);
            expect(root().actionHistory).toEqual(priorHistory);
            expect(projectRate()).toEqual([1]);

            await executeUserAppAction(enable);

            const expected = structuredClone(before);
            if (!expected) {
                throw new Error('Expected a seeded track projection');
            }
            expected.tracks[0]!.clips[0]!.stretchMode = 'repitch';
            const rawExpected = structuredClone(rawBefore);
            rawExpected[0]!.clips[0]!.stretchMode = 'repitch';
            expect(trackStore.value).toStrictEqual(expected);
            expect(root().tracks.tracks).toStrictEqual(rawExpected);
            expect(warpStateStore.value).toStrictEqual(markers);
            expect(root().warpStates).toStrictEqual(markers);
            expect(projectRate()).toEqual([2]);
            expect(undoHistoryStore.value?.past).toHaveLength(2);
            const entry = undoHistoryStore.value?.past.at(-1);
            expect(entry).toMatchObject({
                kind: 'action',
                action: enable,
                inverseAction: { type: 'restoreClipStretchState', payload: { clipId: 'audio' } },
                redoAction: { type: 'restoreClipStretchState', payload: { clipId: 'audio' } },
            });
            const metadata = actionHistoryStore.value?.entries.at(-1);
            expect(metadata).toMatchObject({ actionKind: 'enableWarping', reverted: false });
            expect(root().actionHistory).toEqual(actionHistoryStore.value);
            const history = structuredClone(actionHistoryStore.value);
            const saved = Automerge.load<Root>(Automerge.save(root()));
            expect(saved.tracks.tracks).toStrictEqual(rawExpected);

            await executeUserAppAction(enable);
            expect(trackStore.value).toStrictEqual(expected);
            expect(actionHistoryStore.value).toStrictEqual(history);
            expect(undoHistoryStore.value?.past).toHaveLength(2);

            await expect(undo({ stepOverConflicts: false })).resolves.toEqual({ headConsumed: true });
            expect(trackStore.value).toStrictEqual(before);
            expect(root().tracks.tracks).toStrictEqual(rawBefore);
            expect(Object.hasOwn(audioClip(), 'stretchMode')).toBe(mode !== undefined);
            expect(projectRate()).toEqual([1]);
            // Ordinary Undo moves the live stacks; only the separate revertAction operation marks durable history.
            expect(actionHistoryStore.value).toStrictEqual(history);
            expect(root().actionHistory).toStrictEqual(history);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            expect(undoHistoryStore.value?.future).toHaveLength(1);

            await redo();
            expect(trackStore.value).toStrictEqual(expected);
            expect(root().tracks.tracks).toStrictEqual(rawExpected);
            expect(warpStateStore.value).toStrictEqual(markers);
            expect(projectRate()).toEqual([2]);
            expect(undoHistoryStore.value?.past).toHaveLength(2);
        }
    );

    it.each(['missing', 'midi'])('refuses %s without project, history or direct-execute effects', async (clipId) => {
        seed('off');
        const before = Automerge.save(root());
        const projection = structuredClone(trackStore.value);
        const history = structuredClone(undoHistoryStore.value);
        const action = { type: 'enableWarping', payload: { clipId } } as const;

        await expect(executeAppAction(action)).rejects.toThrow(/audio clip/i);
        expect(await handleEnableWarping.execute(action)).toEqual({
            status: 'conflict',
            reason: 'Audio warping requires an existing audio clip.',
        });
        expect(Automerge.save(root())).toEqual(before);
        expect(trackStore.value).toStrictEqual(projection);
        expect(undoHistoryStore.value).toStrictEqual(history);
        expect(actionHistoryStore.value?.entries).toEqual([]);
    });

    it('keeps a divergent stretch edit when the captured inverse is stale', async () => {
        seed('off');
        await executeAppAction(enable);
        const entry = undoHistoryStore.value?.past.at(-1);
        if (entry?.kind !== 'action' || !entry.inverseAction) {
            throw new Error('Expected the public command to capture a real inverse');
        }
        await executeAppAction({ type: 'setClipStretchRatio', payload: { clipId: 'audio', ratio: 1.5 } });
        const before = Automerge.save(root());
        const history = structuredClone(undoHistoryStore.value);

        await expect(executeAppAction(entry.inverseAction)).rejects.toThrow();
        expect(Automerge.save(root())).toEqual(before);
        expect(audioClip()).toMatchObject({ stretchMode: 'repitch', stretchRatio: 1.5 });
        expect(undoHistoryStore.value).toStrictEqual(history);
    });
});
