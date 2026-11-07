import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    redo,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { setAllEnvelopes, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { trackStore } from '../../../stores/trackStore';
import { warpStates } from '../../../stores/warpStates';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { setArrangementEventBus } from '../../../useCases/arrangementEventBus';

registerDeviceEnginePorts();
registerProjectSlotProjections();

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

function content() {
    flushAutomergeStorageWrites();
    const document = getCrdtDoc<{ tracks: unknown; midi: unknown; gainEnvelopes: unknown; automation: unknown }>(
        'root'
    );
    return structuredClone({
        raw: document && {
            tracks: document.tracks,
            midi: document.midi,
            gainEnvelopes: document.gainEnvelopes,
            automation: document.automation,
        },
        tracks: trackStore.value,
        midi: midiStore.value,
        automation: automationStore.value,
    });
}

function creator(type: 'addClip' | 'duplicateClip' | 'duplicateClipAt' | 'duplicateClipToNextBar'): AppAction {
    if (type === 'addClip')
        return {
            type,
            payload: { id: 'copy', trackId: 'track-1', startBeat: 4, endBeat: 8, name: 'Created', type: 'midi' },
        };
    if (type === 'duplicateClipAt')
        return {
            type,
            payload: { clipId: 'source', targetClipId: 'copy', destinationTrackId: 'track-1', startBeat: 4 },
        };
    return { type, payload: { clipId: 'source', targetClipId: 'copy' } };
}

describe('created clip replay preserves its own action prefix', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('created clip replay prefix');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        sessionStorage.removeItem('sourdaw-undo-session');
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        setArrangementEventBus({ emit: async () => undefined });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const { audioBufferId: _buffer, ...source } = ClipDummy.create({
            id: 'source',
            trackId: 'track-1',
            startBeat: 0,
            endBeat: 4,
            type: 'midi',
        });
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-1', kind: 'midi', clips: [source], devices: [] })],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: { source: [{ id: 'source-note', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        automationStore.set({ lanes: [] });
        setAllEnvelopes({});
        setEnvelope('source', { clipId: 'source', enabled: true, points: [{ id: 'gain', beatOffset: 0, gainDb: -6 }] });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        setAllEnvelopes({});
        warpStates.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each(['addClip', 'duplicateClip', 'duplicateClipAt', 'duplicateClipToNextBar'] as const)(
        '%s keeps repeated replay with MIDI and satellite ownership',
        async (type) => {
            const before = content();
            await executeAppAction(creator(type));
            const created = content();
            expect(trackStore.value?.tracks[0]?.clips.some((clip) => clip.id === 'copy')).toBe(true);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            expect((await undo()).headConsumed).toBe(true);
            expect(content()).toEqual(before);
            await redo();
            expect(trackStore.value?.tracks[0]?.clips.find((clip) => clip.id === 'copy')).toEqual(
                created.tracks?.tracks[0]?.clips.find((clip) => clip.id === 'copy')
            );
            expect(midiStore.value?.notesByClipId.copy?.map(({ id: _id, ...note }) => note)).toEqual(
                created.midi?.notesByClipId.copy?.map(({ id: _id, ...note }) => note)
            );
            expect((await undo()).headConsumed).toBe(true);
            expect(content()).toEqual(before);
        }
    );

    it.each([false, true])(
        'addClip preserves its prefix before later grouped notes (hydrated=%s)',
        async (hydrated) => {
            const before = content();
            expect(
                await executeAppActionBatch(
                    [
                        creator('addClip'),
                        {
                            type: 'addNotes',
                            payload: {
                                clipId: 'copy',
                                notes: [{ id: 'later', pitch: 67, startBeat: 2, duration: 1, velocity: 90 }],
                            },
                        },
                    ],
                    { requireCompensation: true, groupId: 'creation-notes' }
                )
            ).toMatchObject({ status: 'committed' });
            const created = content();
            expect(midiStore.value?.notesByClipId.copy?.some((note) => note.id === 'later')).toBe(true);
            expect((await undo()).headConsumed).toBe(true);
            expect(content()).toEqual(before);
            if (hydrated) {
                await vi.waitFor(() => {
                    const mirror = JSON.parse(sessionStorage.getItem('sourdaw-undo-session') ?? '{}') as {
                        past?: unknown[];
                        future?: unknown[];
                    };
                    expect(mirror.past).toHaveLength(0);
                    expect(mirror.future).toHaveLength(2);
                });
                const outgoing = undoHistoryStore.value!.future;
                clearHandlerRegistry();
                registerProductionCommandHandlers(
                    getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true })
                );
                expect(undoHistoryStore.value?.future).toHaveLength(2);
                expect(undoHistoryStore.value!.future[0]).not.toBe(outgoing[0]);
                if (outgoing[0]?.kind === 'action' && undoHistoryStore.value!.future[0]?.kind === 'action') {
                    expect(undoHistoryStore.value!.future[0].inverseAction).not.toBe(outgoing[0].inverseAction);
                    expect(undoHistoryStore.value!.future[0].action).not.toBe(outgoing[0].action);
                } else {
                    throw new Error('Expected hydrated action entries');
                }
            }
            await redo();
            expect(content()).toEqual(created);
            expect((await undo()).headConsumed).toBe(true);
            expect(content()).toEqual(before);
        }
    );

    it('does not publish a fresh creator guard when a grouped replay rolls back', async () => {
        await executeAppActionBatch(
            [
                creator('addClip'),
                {
                    type: 'addNotes',
                    payload: {
                        clipId: 'copy',
                        notes: [{ id: 'later', pitch: 67, startBeat: 2, duration: 1, velocity: 90 }],
                    },
                },
            ],
            { groupId: 'failed-publication', requireCompensation: true }
        );
        await undo();
        const before = content();
        const history = structuredClone(undoHistoryStore.value);
        const handler = getMidiNoteTransformHandlers().restoreMidiClipNotes;
        let staged = false;
        clearHandlerRegistry();
        registerHandlerMap({
            ...getArrangementHandlers(),
            ...getMidiNoteTransformHandlers(),
            restoreMidiClipNotes: {
                ...handler,
                execute: (action, context) => {
                    handler.execute(action, context);
                    staged = true;
                    return { status: 'conflict' };
                },
            },
        });
        await redo();
        expect(staged).toBe(true);
        expect(content()).toEqual(before);
        expect(undoHistoryStore.value).toEqual(history);
    });
});
