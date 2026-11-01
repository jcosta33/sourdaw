import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    createUndoEntry,
    executeAppAction,
    commandBatchPreflightPort,
    createVersionedCommandEnvelope,
    parseVersionedCommandEnvelope,
    previewVersionedCommandBatchEnvelope,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import * as commandUseCases from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { transportStore } from '#/modules/Transport/stores';
import { createHandler } from '#/utils/createHandler';
import { type HandlerValidationContext } from '#/utils/handlerContract';
import { type ConfirmPayload, type NotifyPayload, type PromptPayload } from '#/utils/Notification/notificationEventBus';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake, createTakeLane } from '../../../models/TakeLane';
import { type Clip } from '../../../models/Track';
import { gainEnvelopeStore } from '../../../stores/gainEnvelopeStore';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { warpStateStore } from '../../../stores/warpStates';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { commitRecording } from '../../../useCases/recording/commitRecording';
import { startRecording } from '../../../useCases/recording/startRecording';
import { updateTrack } from '../../../useCases/updateTrack';
import { handleDiscardRecording } from '../handleDiscardRecording';
import { handleRestoreRecording } from '../handleRestoreRecording';

const A = 'recording-track-a';
const B = 'peer-track-b';
const metadata = { record: () => [], markReverted: () => ({ status: 'unavailable' as const }), clear: () => undefined };

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

type ReplayOperation = typeof undo | typeof redo;

function flush(): void {
    flushAutomergeStorageWrites();
}

async function record(expectedEntries = 1): Promise<Clip> {
    const [provisional] = startRecording(4);
    if (!provisional) {
        throw new Error('expected a provisional recording');
    }
    flush();
    const clip = {
        ...provisional,
        audioBufferId: 'recorded-buffer',
        fileId: 'recorded.wav',
        assetHash: 'recorded-media',
        startBeat: 4,
        endBeat: 8,
    };
    await commitRecording(clip);
    flush();
    expect(undoHistoryStore.value?.past).toHaveLength(expectedEntries);
    return clip;
}

function peerClip(clip: Clip, duplicates: 'moved' | 'across' | 'within' = 'moved'): void {
    const moved = {
        ...clip,
        trackId: B,
        audioBufferId: 'peer-buffer',
        fileId: 'peer.wav',
        assetHash: 'peer-media',
        gain: 0.37,
    };
    if (duplicates === 'moved') {
        updateTrack(A, (track) => ({ ...track, clips: [] }));
    }
    if (duplicates === 'within') {
        updateTrack(A, (track) => ({ ...track, clips: [clip, structuredClone(clip)] }));
    } else {
        updateTrack(B, (track) => ({ ...track, clips: [moved] }));
    }
    const take = createTake(clip.id, 'Peer take', 4, 8);
    takeLaneStore.set({
        lanes: [
            { ...createTakeLane(B), takes: [take], activeCompRegions: [{ startBeat: 4, endBeat: 8, takeId: take.id }] },
        ],
    });
    midiStore.set({
        notesByClipId: { [clip.id]: [{ id: 'peer-note', pitch: 64, startBeat: 0, duration: 1, velocity: 91 }] },
        ccByClipId: { [clip.id]: [{ id: 'peer-cc', controller: 74, value: 83, beat: 1, channel: 2 }] },
        pitchBendByClipId: { [clip.id]: [{ id: 'peer-bend', value: 123, beat: 2, channel: 2 }] },
    });
    automationStore.set({
        lanes: [
            {
                id: 'peer-automation',
                trackId: B,
                clipId: clip.id,
                parameterId: 'gain',
                parameterName: 'Gain',
                points: [{ beat: 0, value: 0.4, curve: 'linear', tension: 0 }],
                objects: [],
                visible: true,
                enabled: true,
                collapsed: false,
                minValue: 0,
                maxValue: 1,
            },
        ],
    });
    gainEnvelopeStore.set({
        envelopes: {
            [clip.id]: { clipId: clip.id, enabled: true, points: [{ id: 'peer-envelope', beatOffset: 1, gainDb: -3 }] },
        },
    });
    warpStateStore.set({
        states: {
            [clip.id]: {
                enabled: true,
                stretchMode: 'repitch',
                originalTempo: 119,
                markers: [{ id: 'peer-warp', originalBeat: 1, warpedBeat: 1.2, origin: 'user' }],
            },
        },
    });
    flush();
}

function witness() {
    flush();
    return {
        raw: JSON.stringify(getCrdtDoc('root')),
        tracks: structuredClone(trackStore.value),
        takes: structuredClone(takeLaneStore.value),
        midi: structuredClone(midiStore.value),
        automation: structuredClone(automationStore.value),
        gain: structuredClone(gainEnvelopeStore.value),
        warp: structuredClone(warpStateStore.value),
        history: structuredClone(undoHistoryStore.value),
    };
}

async function expectRefused(replay: ReplayOperation): Promise<void> {
    const before = witness();
    const state = undoHistoryStore.value;
    const entries = state ? [...state.past, ...state.future] : [];
    await replay();
    expect(witness()).toEqual(before);
    const updated = undoHistoryStore.value;
    const after = updated ? [...updated.past, ...updated.future] : [];
    expect(after).toHaveLength(entries.length);
    for (const [index, entry] of entries.entries()) {
        expect(after[index]).toBe(entry);
    }
}

describe('recording replay preserves peer ownership (#5288)', () => {
    beforeEach(() => {
        injectDependencies(notifyUser, { eventBus: createEventBus<NotificationEvents>() });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('recording replay ownership integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(metadata);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: A, kind: 'audio', armed: true, clips: [] }),
                TrackDummy.create({ id: B, kind: 'audio', armed: false, clips: [] }),
            ],
            selectedTrackId: A,
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        automationStore.set({ lanes: [] });
        gainEnvelopeStore.set({ envelopes: {} });
        warpStateStore.set({ states: {} });
        transportStore.set({ ...transportStore.value!, playheadPosition: 4 });
        flush();
    });
    afterEach(() => {
        vi.restoreAllMocks();
        commandBatchPreflightPort.setProvider(null);
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        flush();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('before-Redo refuses a peer same-ID clip on B without touching any peer facet or pending history', async () => {
        const clip = await record();
        await undo();
        flush();
        peerClip(clip);
        await expectRefused(redo);
    });

    it.each(['moved', 'across', 'within'] as const)(
        'before-Undo refuses %s identity occurrences without touching peer facets or pending history',
        async (placement) => {
            const clip = await record();
            peerClip(clip, placement);
            await expectRefused(undo);
        }
    );

    it('refuses an occurrence whose outer owner is A but embedded owner is B', async () => {
        const clip = await record();
        updateTrack(A, (track) => ({ ...track, clips: [{ ...clip, trackId: B }] }));
        flush();
        await expectRefused(undo);
    });

    it.each(['undo', 'redo'] as const)(
        'grouped %s refuses before an earlier writing sentinel executes',
        async (leg) => {
            const clip = await record();
            if (leg === 'redo') {
                await undo();
                flush();
            }
            peerClip(clip);
            let writes = 0;
            clearHandlerRegistry();
            const { setTrackPan: _ordinaryPan, ...handlers } = getArrangementHandlers();
            registerHandlerMap({
                ...handlers,
                setTrackPan: createHandler<'setTrackPan'>({
                    validate: () => true,
                    execute: (action) => {
                        writes += 1;
                        updateTrack(B, (track) => ({ ...track, pan: action.payload.pan }));
                    },
                    describe: () => ({ label: 'Writing sentinel' }),
                    undoable: false,
                }),
            });
            const sentinel = createUndoEntry(
                'Writing sentinel',
                { type: 'setTrackPan', payload: { trackId: B, pan: 0.2, expectedPan: 0.8 } },
                { type: 'setTrackPan', payload: { trackId: B, pan: 0.8, expectedPan: 0.2 } }
            );
            const state = undoHistoryStore.value!;
            const recording = leg === 'undo' ? state.past[0]! : state.future[0]!;
            recording.groupId = sentinel.groupId = 'recording-and-sentinel';
            // Undo reverses past; redo runs future forwards. Sentinel executes first in both.
            if (leg === 'undo') {
                undoHistoryStore.set({ past: [recording, sentinel], future: [] });
            } else {
                undoHistoryStore.set({ past: [], future: [sentinel, recording] });
            }
            await expectRefused(leg === 'undo' ? undo : redo);
            expect(writes).toBe(0);
        }
    );

    it('retains undiverged legacy singleton replay and a distinct peer clip with all its facets', async () => {
        const clip = await record();
        const entry = undoHistoryStore.value!.past[0]!;
        if (entry.kind !== 'action') {
            throw new Error('expected action');
        }
        expect(entry.inverseAction).toEqual({ type: 'discardRecording', payload: { clipId: clip.id } });
        const distinct = { ...clip, id: 'distinct-peer' };
        peerClip(distinct, 'across');
        const peerBefore = {
            clip: structuredClone(trackStore.value!.tracks[1]!.clips),
            takes: structuredClone(takeLaneStore.value!.lanes.filter((lane) => lane.trackId === B)),
            midi: structuredClone(midiStore.value),
            automation: structuredClone(automationStore.value),
            gain: structuredClone(gainEnvelopeStore.value),
            warp: structuredClone(warpStateStore.value),
        };
        await undo();
        flush();
        expect(trackStore.value!.tracks[0]!.clips).toEqual([]);
        expect(undoHistoryStore.value?.future).toHaveLength(1);
        await redo();
        flush();
        expect(trackStore.value!.tracks[0]!.clips).toEqual([clip]);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect({
            clip: trackStore.value!.tracks[1]!.clips,
            takes: takeLaneStore.value!.lanes.filter((lane) => lane.trackId === B),
            midi: midiStore.value,
            automation: automationStore.value,
            gain: gainEnvelopeStore.value,
            warp: warpStateStore.value,
        }).toEqual(peerBefore);
    });

    it('undoes and redoes an undiverged multi-recording group with its original identities and takes', async () => {
        const first = await record();
        const second = await record(2);
        const entries = undoHistoryStore.value!.past;
        for (const entry of entries) {
            entry.groupId = 'multi-recording';
        }
        const before = {
            clips: structuredClone(trackStore.value!.tracks[0]!.clips),
            takes: structuredClone(takeLaneStore.value),
        };
        await undo();
        flush();
        expect(trackStore.value!.tracks[0]!.clips).toEqual([]);
        expect(undoHistoryStore.value?.future).toHaveLength(2);
        await redo();
        flush();
        expect({ clips: trackStore.value!.tracks[0]!.clips, takes: takeLaneStore.value }).toEqual(before);
        expect(trackStore.value!.tracks[0]!.clips.map((clip) => clip.id)).toEqual([first.id, second.id]);
        expect(undoHistoryStore.value?.past).toHaveLength(2);
    });

    it('replays a harmless mixed group through the production recording and color handlers', async () => {
        const clip = await record();
        await executeAppAction({ type: 'setTrackColor', payload: { trackId: B, color: '#123456' } });
        for (const entry of undoHistoryStore.value!.past) {
            entry.groupId = 'recording-and-color';
        }
        await undo();
        flush();
        expect(trackStore.value!.tracks[0]!.clips).toEqual([]);
        expect(trackStore.value!.tracks[1]!.color).toBe('#ff0000');
        await redo();
        flush();
        expect(trackStore.value!.tracks[0]!.clips).toEqual([clip]);
        expect(trackStore.value!.tracks[1]!.color).toBe('#123456');
        expect(undoHistoryStore.value?.past).toHaveLength(2);
    });

    it('refuses restore when the captured destination track is gone', async () => {
        await record();
        await undo();
        flush();
        trackStore.set({ ...trackStore.value!, tracks: trackStore.value!.tracks.filter((track) => track.id !== A) });
        flush();
        await expectRefused(redo);
    });

    it.each(['missing-source', 'missing-redo', 'wrong-id', 'wrong-redo-id', 'wrong-redo-owner', 'duplicate'] as const)(
        'refuses %s inverse authority without writes',
        async (kind) => {
            await record();
            const entry = undoHistoryStore.value!.past[0]!;
            if (
                entry.kind !== 'action' ||
                entry.action.type !== 'commitRecording' ||
                entry.redoAction?.type !== 'restoreRecording'
            ) {
                throw new Error('expected recording entry');
            }
            const original = entry.action;
            const redoCapture = entry.redoAction;
            if (kind === 'missing-source') {
                entry.action = { type: 'discardRecording', payload: { clipId: original.payload.clip.id } };
            }
            if (kind === 'wrong-id') {
                entry.action = {
                    type: 'commitRecording',
                    payload: { clip: { ...original.payload.clip, id: 'different-source' } },
                };
            }
            if (kind === 'missing-redo') {
                delete entry.redoAction;
            }
            if (kind === 'wrong-redo-id') {
                entry.redoAction = {
                    type: 'restoreRecording',
                    payload: { ...redoCapture.payload, clip: { ...redoCapture.payload.clip, id: 'different-redo' } },
                };
            }
            if (kind === 'wrong-redo-owner') {
                entry.redoAction = {
                    type: 'restoreRecording',
                    payload: { ...redoCapture.payload, clip: { ...redoCapture.payload.clip, trackId: B } },
                };
            }
            if (kind === 'duplicate') {
                undoHistoryStore.set({ past: [entry], future: [entry] });
            }
            await expectRefused(undo);
        }
    );

    it('refuses detached or missing inverse association and accepts the fresh current inverse', async () => {
        await record();
        const entry = undoHistoryStore.value!.past[0]!;
        if (entry.kind !== 'action' || entry.inverseAction?.type !== 'discardRecording') {
            throw new Error('expected recording inverse');
        }
        const original = entry.inverseAction;
        const detached = structuredClone(original);
        const before = witness();
        expect(handleDiscardRecording.execute(detached)).toEqual({ status: 'conflict' });
        expect(witness()).toEqual(before);
        entry.inverseAction = structuredClone(original);
        expect(handleDiscardRecording.execute(original)).toEqual({ status: 'conflict' });
        await undo();
        flush();
        expect(undoHistoryStore.value?.future).toHaveLength(1);
        expect(trackStore.value!.tracks[0]!.clips).toEqual([]);
        await redo();
        flush();
        expect(trackStore.value!.tracks[0]!.clips).toHaveLength(1);
    });

    it('rejects both replay actions through the real isolated preview capability boundary', async () => {
        await record();
        const entry = undoHistoryStore.value!.past[0]!;
        if (entry.kind !== 'action' || !entry.inverseAction || !entry.redoAction) {
            throw new Error('expected replay actions');
        }
        const before = witness();
        for (const action of [entry.inverseAction, entry.redoAction]) {
            const command = createVersionedCommandEnvelope({
                action,
                availableDeviceVersions: {},
                expectedEffect: 'Replay recording',
                normalizedProjectRevision: 'recording-revision',
                objectReferences: [],
                parameterUnits: [],
                reason: 'Preview replay capability',
                time: [],
            });
            expect(parseVersionedCommandEnvelope(JSON.stringify(command))).toMatchObject({
                status: 'invalid',
                reason: 'Command operation is not deterministic at the serialized boundary',
            });
            // Even an internal typed envelope cannot bypass the preview capability check.
            const envelope: Parameters<typeof previewVersionedCommandBatchEnvelope>[0] = {
                schemaVersion: 1,
                runId: 'recording-preview',
                batchId: 'recording-preview',
                projectId: 'recording-project',
                baseRevision: 'recording-revision',
                idempotencyKey: 'recording-preview',
                intent: 'Preview replay capability',
                mode: 'preview',
                commands: [command],
                scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                preconditions: [],
                postconditions: [],
                dependencies: [],
                batchLocalBindings: [],
                grants: {
                    allowedOperationPrefixes: [],
                    create: false,
                    delete: false,
                    routing: false,
                    tempo: false,
                    master: false,
                    file: false,
                    audioUpload: false,
                    remoteGeneration: false,
                    autoCommit: false,
                },
                budgets: {
                    maxCommands: 1,
                    maxCreatedTracks: 0,
                    maxDeletedObjects: 0,
                    maxAffectedTracks: 2,
                    maxAffectedClips: 1,
                    maxAutomationPoints: 0,
                    maxImportedAssets: 0,
                    maxRenderJobs: 0,
                },
            };
            commandBatchPreflightPort.setProvider(() => ({
                projectId: 'recording-project',
                projectInvariantsValid: true,
                audioGraphValid: true,
                availableAudioBufferIds: ['recorded-buffer'],
                availableAssetHashes: ['recorded-media'],
                lockedRanges: [],
                targetFingerprints: {},
            }));
            expect(previewVersionedCommandBatchEnvelope(envelope)).toMatchObject({
                status: 'rejected',
                reason: `Action cannot execute inside an isolated preview: ${action.type}`,
            });
        }
        expect(witness()).toEqual(before);
    });

    it('refuses direct isolated preview validation and execution before reading live inverse history', async () => {
        await record();
        const entry = undoHistoryStore.value!.past[0]!;
        if (
            entry.kind !== 'action' ||
            entry.inverseAction?.type !== 'discardRecording' ||
            entry.redoAction?.type !== 'restoreRecording'
        ) {
            throw new Error('expected recording actions');
        }
        const before = witness();
        const read = vi.spyOn(commandUseCases, 'readUndoEntryForInverse');
        const context: HandlerValidationContext = {
            actions: [entry.inverseAction, entry.redoAction],
            actionIndex: 0,
            executionMode: 'isolated-preview',
        };
        expect(handleDiscardRecording.validate?.(entry.inverseAction, context)).toBe(false);
        expect(handleDiscardRecording.execute(entry.inverseAction, context)).toEqual({ status: 'conflict' });
        expect(handleRestoreRecording.validate?.(entry.redoAction, context)).toBe(false);
        expect(handleRestoreRecording.execute(entry.redoAction, context)).toEqual({ status: 'conflict' });
        expect(read).not.toHaveBeenCalled();
        expect(witness()).toEqual(before);
    });
});
