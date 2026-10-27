import { clone as cloneAutomergeDoc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    DOC_PREFIX_ROOT,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake } from '../../../models/TakeLane';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../getArrangementHandlers';
import { commitRecording } from '../commitRecording';
import { recordingPassTiming } from '../recordingPassTiming';
import { stageRecordingTake } from '../stageRecordingTake';
import { startRecording } from '../startRecording';

const hold = vi.hoisted(() => ({
    afterCommit: null as null | { reached: () => void; resume: Promise<void> },
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...actual,
        executeAppAction: async (...args: Parameters<typeof actual.executeAppAction>) => {
            await actual.executeAppAction(...args);
            if (hold.afterCommit) {
                hold.afterCommit.reached();
                await hold.afterCommit.resume;
            }
        },
    };
});

const TRACK_ID = 'track-audio';

function replaceRootWithSuccessor(): void {
    const root = getCrdtDoc(DOC_PREFIX_ROOT);
    if (!root) {
        throw new Error('expected the recording root');
    }
    replaceCrdtDoc({ id: DOC_PREFIX_ROOT, doc: cloneAutomergeDoc(root) });
}

describe('recording pass timing belongs to its captured project root', () => {
    beforeEach(() => {
        hold.afterCommit = null;
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('recording pass timing root owner');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: [TrackDummy.create({ id: TRACK_ID, kind: 'audio', armed: true, clips: [] })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });
        transportStore.set({ ...transportStore.value!, playheadPosition: 4, tempo: 120 });
    });

    afterEach(() => {
        hold.afterCommit = null;
        vi.restoreAllMocks();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        try {
            flushAutomergeStorageWrites();
        } catch {
            // A replaced root can refuse the outgoing projection flush.
        }
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('retains a same-ID successor witness when the old committed action resumes', async () => {
        flushAutomergeStorageWrites();
        const root = getCrdtDoc(DOC_PREFIX_ROOT);
        if (!root) {
            throw new Error('expected the empty recording root');
        }
        const successorRoot = cloneAutomergeDoc(root);
        const clipUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const nextUuid = vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(clipUuid);
        const [clip] = startRecording(4);
        if (!clip) {
            throw new Error('expected a staged clip');
        }
        flushAutomergeStorageWrites();
        const reached = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        hold.afterCommit = { reached: reached.resolve, resume: release.promise };

        const committing = commitRecording({ ...clip, audioBufferId: 'captured-a', endBeat: 6 });
        await reached.promise;
        replaceCrdtDoc({ id: DOC_PREFIX_ROOT, doc: successorRoot });
        trackStore.hydrate();
        takeLaneStore.hydrate();
        nextUuid.mockReturnValueOnce(clipUuid);
        const [successorClip] = startRecording(4, () => 0);
        expect(successorClip?.id).toBe(clip.id);
        const successor = recordingPassTiming.ownedTakes(clip.id);
        expect(successor).toBeDefined();
        const successorPass = createTake(clip.id, 'Successor pass', 4, 8, 0);
        recordingPassTiming.stage(successorPass, 1);
        expect(recordingPassTiming.depthSeconds(successorPass, 0, 0)).toBe(0);

        release.resolve();
        await committing;

        expect(recordingPassTiming.ownedTakes(clip.id)).toBe(successor);
        expect(recordingPassTiming.depthSeconds(successorPass, 0, 0)).toBe(0);
    });

    it('refuses source timing read from a replaced root', () => {
        const clipId = 'same-id-on-another-root';
        recordingPassTiming.begin(clipId, 4, () => 0);
        const pass = createTake(clipId, 'Old pass', 4, 8, 0);
        recordingPassTiming.stage(pass, 1);
        expect(recordingPassTiming.depthSeconds(pass, 0, 0)).toBe(0);
        expect(recordingPassTiming.sourceEndSeconds(pass, 0, 0)).toBe(1);

        replaceRootWithSuccessor();

        expect(() => recordingPassTiming.depthSeconds(pass, 0, 0)).toThrow(
            'Recording pass has no captured source timing'
        );
        expect(() => recordingPassTiming.sourceEndSeconds(pass, 0, 0)).toThrow(
            'Recording pass has no captured source ending'
        );
    });

    it('finalizes the staged pass clock after roll without republishing its take', () => {
        transportStore.set({
            ...transportStore.value!,
            isPlaying: true,
            isLooping: true,
            loopStart: 8,
            loopEnd: 12,
            playheadPosition: 11.9,
        });
        let firstPassContextSeconds: number | null = null;
        const [clip] = startRecording(11.9, () => firstPassContextSeconds);
        if (!clip) {
            throw new Error('expected the recording clip');
        }
        const finalize = stageRecordingTake({
            trackId: TRACK_ID,
            clipId: clip.id,
            name: 'Initial seam',
            startBeat: 8,
            endBeat: 12,
            sourceOffsetBeats: 0,
            plannedPassEnd: true,
        });
        const staged = takeLaneStore.value;
        const take = staged?.lanes[0]?.takes.at(-1);
        if (!finalize || !take) {
            throw new Error('expected the staged pass and its clock receipt');
        }

        firstPassContextSeconds = 52.1;
        expect(finalize(52.15)).toBe(true);
        expect(takeLaneStore.value).toBe(staged);
        expect(Math.round(recordingPassTiming.depthSeconds(take, 51.9, 0) * 48000)).toBe(9600);
        expect(Math.round(recordingPassTiming.sourceEndSeconds(take, 51.9, 0) * 48000)).toBe(12000);
        expect(finalize(53)).toBe(false);
        expect(Math.round(recordingPassTiming.sourceEndSeconds(take, 51.9, 0) * 48000)).toBe(12000);
    });

    it.each(['retired', 'root replaced', 'same-ID successor'] as const)(
        'leaves the successor unchanged when a staged clock belongs to an owner that was %s',
        (change) => {
            transportStore.set({ ...transportStore.value!, isPlaying: false, loopStart: 0 });
            const [clip] = startRecording(4, () => 50);
            if (!clip) {
                throw new Error('expected the recording clip');
            }
            const finalize = stageRecordingTake({
                trackId: TRACK_ID,
                clipId: clip.id,
                name: 'Old pass',
                startBeat: 4,
                endBeat: 8,
                sourceOffsetBeats: 0,
            });
            if (!finalize) {
                throw new Error('expected a staged clock receipt');
            }
            if (change === 'root replaced') {
                replaceRootWithSuccessor();
            }
            recordingPassTiming.retire(clip.id);
            if (change !== 'retired') {
                recordingPassTiming.begin(clip.id, 4, () => 60);
            }
            const successor = recordingPassTiming.ownedTakes(clip.id);
            const successorTake = createTake(clip.id, 'Successor', 4, 8, 0);
            if (successor) {
                recordingPassTiming.stage(successorTake, 61);
            }
            const staged = takeLaneStore.value;

            expect(finalize(52)).toBe(false);
            expect(recordingPassTiming.ownedTakes(clip.id)).toBe(successor);
            expect(takeLaneStore.value).toBe(staged);
            if (successor) {
                expect(recordingPassTiming.depthSeconds(successorTake, 60, 0)).toBe(0);
                expect(recordingPassTiming.sourceEndSeconds(successorTake, 60, 0)).toBe(1);
            }
        }
    );
});
