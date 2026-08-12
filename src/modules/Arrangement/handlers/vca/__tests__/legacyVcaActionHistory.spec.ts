import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    revertAction,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory as clearCrdtActionHistory,
    createCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
} from '#/modules/CrdtDocument/useCases';
import { sidechainStore } from '#/modules/Routing/stores';
import { type AppAction } from '#/utils/handlerContract';

import { createTrack, type Track } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { getVcaGroupsState, setVcaGroupsState } from '../../../stores/vcaGroupStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

type LegacyVcaState = {
    groups: ReturnType<typeof getVcaGroupsState>;
    memberships: Array<{ trackId: string; vcaGroupId: string | null }>;
};

function captureState(): LegacyVcaState {
    return {
        groups: getVcaGroupsState().map((group) => ({ ...group, trackIds: [...group.trackIds] })),
        memberships: (trackStore.value?.tracks ?? []).map((track) => ({
            trackId: track.id,
            vcaGroupId: track.vcaGroupId ?? null,
        })),
    };
}

function seedState(): void {
    const first = createTrack({ id: 'track-1', name: 'Kick', kind: 'audio' });
    const second = createTrack({ id: 'track-2', name: 'Bass', kind: 'midi' });
    second.devices = [
        {
            id: 'sidechain-device',
            name: 'Sidechain Compressor',
            type: 'builtin-sidechain-compressor',
            bypassed: false,
            parameterValues: {},
        },
    ];
    first.vcaGroupId = 'vca-a';
    trackStore.set({ tracks: [first, second], selectedTrackId: first.id, ghostClips: [] });
    setVcaGroupsState([
        { id: 'vca-a', name: 'A', gain: 0.5, muted: false, trackIds: [first.id] },
        { id: 'vca-b', name: 'B', gain: 1, muted: false, trackIds: [] },
    ]);
}

const DORMANT_ACTION_TRACK_ID = 'dormant-vca';
const DORMANT_ACTION_DEVICE_ID = 'dormant-device';

function seedDormantActionTarget(): Track {
    const state = trackStore.value;
    if (!state) {
        throw new Error('Expected seeded track state');
    }
    const dormant = createTrack({ id: DORMANT_ACTION_TRACK_ID, name: 'Dormant VCA', kind: 'audio' });
    dormant.armed = true;
    dormant.inputId = 'input-residue';
    dormant.outputId = 'track-2';
    dormant.devices = [
        {
            id: DORMANT_ACTION_DEVICE_ID,
            name: 'Dormant device residue',
            type: 'compressor',
            bypassed: false,
            parameterValues: { threshold: 0.25 },
        },
    ];
    dormant.sends = [{ busId: 'track-2', level: 0.25, preFader: false }];
    Object.defineProperty(dormant, 'kind', {
        value: 'vca',
        configurable: true,
        enumerable: true,
        writable: true,
    });
    trackStore.set({ ...state, tracks: [...state.tracks, dormant] });
    return dormant;
}

async function expectRoundTrip(action: AppAction): Promise<void> {
    const before = captureState();

    await executeAppAction(action);

    const after = captureState();
    expect(after).not.toEqual(before);
    expect(undoStore.value?.past).toHaveLength(1);
    const historyEntry = actionHistoryStore.value?.entries.at(-1);
    if (!historyEntry) {
        throw new Error('Expected replayable VCA action history');
    }

    await undo();
    expect(captureState()).toEqual(before);

    await redo();
    expect(captureState()).toEqual(after);

    await expect(revertAction(historyEntry.id)).resolves.toEqual({ status: 'executed' });
    expect(captureState()).toEqual(before);
    expect(actionHistoryStore.value?.entries.find((entry) => entry.id === historyEntry.id)?.reverted).toBe(true);
}

describe('legacy VCA action history', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        macroStore.set({ macros: [], recording: true, currentRecording: [] });
        sidechainStore.set({ routes: [] });
        resetActionReplayAuthority();
        clearCrdtActionHistory();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearCrdtActionHistory,
        });
        seedState();
    });

    afterEach(() => {
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        sidechainStore.set({ routes: [] });
        clearCrdtActionHistory();
        resetActionReplayAuthority();
        clearUndoHistory();
        clearHandlerRegistry();
        setVcaGroupsState([]);
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it.each([
        {
            label: 'create',
            action: { type: 'createVcaGroup', payload: { name: 'Created', trackIds: ['track-1', 'track-2'] } },
        },
        {
            label: 'assign',
            action: { type: 'assignToVca', payload: { trackId: 'track-1', vcaGroupId: 'vca-b' } },
        },
        { label: 'remove', action: { type: 'removeFromVca', payload: { trackId: 'track-1' } } },
        { label: 'gain', action: { type: 'setVcaGain', payload: { vcaGroupId: 'vca-a', gain: 0.75 } } },
    ] satisfies Array<{ label: string; action: AppAction }>)(
        'round-trips $label through real undo, redo, and action replay',
        async ({ action }) => {
            await expectRoundTrip(action);
        }
    );

    it('round-trips every duplicate legacy membership occurrence at its exact index', async () => {
        setVcaGroupsState([
            { id: 'vca-a', name: 'A', gain: 0.5, muted: false, trackIds: ['track-1', 'track-2', 'track-1'] },
            { id: 'vca-b', name: 'B', gain: 1, muted: false, trackIds: ['track-1'] },
        ]);
        const before = captureState();

        await executeAppAction({ type: 'removeFromVca', payload: { trackId: 'track-1' } });
        const after = captureState();
        expect(after.groups).toEqual([
            { id: 'vca-a', name: 'A', gain: 0.5, muted: false, trackIds: ['track-2'] },
            { id: 'vca-b', name: 'B', gain: 1, muted: false, trackIds: [] },
        ]);

        await undo();
        expect(captureState()).toEqual(before);

        await redo();
        expect(captureState()).toEqual(after);
    });

    it.each([
        {
            label: 'create',
            action: {
                type: 'createVcaGroup',
                payload: { name: 'Action A', trackIds: ['track-1'], vcaGroupId: 'vca-action-a' },
            },
        },
        {
            label: 'assign',
            action: { type: 'assignToVca', payload: { trackId: 'track-1', vcaGroupId: 'vca-b' } },
        },
        { label: 'remove', action: { type: 'removeFromVca', payload: { trackId: 'track-1' } } },
        { label: 'gain', action: { type: 'setVcaGain', payload: { vcaGroupId: 'vca-a', gain: 0.75 } } },
    ] satisfies Array<{ label: string; action: AppAction }>)(
        'reverts non-latest $label without overwriting a later group, gain, membership, or track',
        async ({ action }) => {
            const beforeActionA = captureState();
            await executeAppAction(action);
            const actionAHistoryEntry = actionHistoryStore.value?.entries.at(-1);
            if (!actionAHistoryEntry) {
                throw new Error('Expected history for VCA action A');
            }

            const trackState = trackStore.value;
            if (!trackState) {
                throw new Error('Expected seeded track state');
            }
            const laterTrack = createTrack({ id: 'track-later', name: 'Later', kind: 'audio' });
            trackStore.set({ ...trackState, tracks: [...trackState.tracks, laterTrack] });

            await executeAppAction({
                type: 'createVcaGroup',
                payload: {
                    name: 'Later group',
                    trackIds: [laterTrack.id],
                    vcaGroupId: 'vca-later',
                },
            });
            await executeAppAction({
                type: 'setVcaGain',
                payload: { vcaGroupId: 'vca-later', gain: 1.25 },
            });
            const laterGroup = getVcaGroupsState().find((group) => group.id === 'vca-later');
            if (!laterGroup) {
                throw new Error('Expected later VCA group');
            }

            await expect(revertAction(actionAHistoryEntry.id)).resolves.toEqual({ status: 'executed' });

            expect(captureState()).toEqual({
                groups: [...beforeActionA.groups, { ...laterGroup, trackIds: [...laterGroup.trackIds] }],
                memberships: [...beforeActionA.memberships, { trackId: laterTrack.id, vcaGroupId: laterGroup.id }],
            });
        }
    );

    it('reports a conflict without changing state when a later action overlaps the inverse footprint', async () => {
        await executeAppAction({ type: 'setVcaGain', payload: { vcaGroupId: 'vca-a', gain: 0.75 } });
        const actionAHistoryEntry = actionHistoryStore.value?.entries.at(-1);
        if (!actionAHistoryEntry) {
            throw new Error('Expected history for VCA action A');
        }

        await executeAppAction({ type: 'setVcaGain', payload: { vcaGroupId: 'vca-a', gain: 1.25 } });
        const beforeConflict = captureState();

        await expect(revertAction(actionAHistoryEntry.id)).resolves.toEqual({ status: 'conflict' });

        expect(captureState()).toEqual(beforeConflict);
        expect(actionHistoryStore.value?.entries.find((entry) => entry.id === actionAHistoryEntry.id)?.reverted).toBe(
            false
        );
    });

    it('keeps a stale guarded gain redo without overwriting a later durable gain', async () => {
        await executeAppAction({ type: 'setVcaGain', payload: { vcaGroupId: 'vca-a', gain: 0.75 } });
        await undo();
        setVcaGroupsState(
            getVcaGroupsState().map((group) => (group.id === 'vca-a' ? { ...group, gain: 1.25 } : group))
        );

        await expect(redo()).resolves.toBeUndefined();

        expect(getVcaGroupsState().find((group) => group.id === 'vca-a')?.gain).toBe(1.25);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);
    });

    it.each([
        {
            label: 'a colliding create replay identity',
            prepare: () => {
                setVcaGroupsState([
                    ...getVcaGroupsState(),
                    {
                        id: 'vca-command-12345678-0000-4000-8000-000000000000',
                        name: 'Existing',
                        gain: 1,
                        muted: false,
                        trackIds: [],
                    },
                ]);
                vi.spyOn(crypto, 'randomUUID').mockReturnValue('12345678-0000-4000-8000-000000000000');
            },
            action: { type: 'createVcaGroup', payload: { name: 'Duplicate', trackIds: [] } },
        },
        {
            label: 'an assignment with a missing target',
            prepare: () => undefined,
            action: { type: 'assignToVca', payload: { trackId: 'track-1', vcaGroupId: 'missing-vca' } },
        },
        {
            label: 'removing an already unassigned track',
            prepare: () => undefined,
            action: { type: 'removeFromVca', payload: { trackId: 'track-2' } },
        },
        {
            label: 'setting an unchanged gain',
            prepare: () => undefined,
            action: { type: 'setVcaGain', payload: { vcaGroupId: 'vca-a', gain: 0.5 } },
        },
    ] satisfies Array<{ label: string; prepare: () => void; action: AppAction }>)(
        'records no undo or replay history for $label',
        async ({ action, prepare }) => {
            prepare();
            const before = captureState();

            await executeAppAction(action);

            expect(captureState()).toEqual(before);
            expect(undoStore.value?.past).toEqual([]);
            expect(actionHistoryStore.value?.entries).toEqual([]);
        }
    );

    it.each([
        {
            label: 'add clip',
            action: {
                type: 'addClip',
                payload: {
                    trackId: DORMANT_ACTION_TRACK_ID,
                    startBeat: 0,
                    endBeat: 4,
                    name: 'Denied clip',
                    type: 'audio',
                },
            },
        },
        {
            label: 'add device',
            action: {
                type: 'addDevice',
                payload: { trackId: DORMANT_ACTION_TRACK_ID, deviceType: 'compressor' },
            },
        },
        {
            label: 'add send',
            action: {
                type: 'addSend',
                payload: { trackId: DORMANT_ACTION_TRACK_ID, busId: 'track-1', level: 0.5 },
            },
        },
        {
            label: 'load external plugin',
            action: {
                type: 'loadExternalPlugin',
                payload: { pluginId: 'external-plugin', trackId: DORMANT_ACTION_TRACK_ID },
            },
        },
        {
            label: 'set send',
            action: {
                type: 'setSend',
                payload: { trackId: DORMANT_ACTION_TRACK_ID, busId: 'track-2', level: 0.75 },
            },
        },
        {
            label: 'set device parameter',
            action: {
                type: 'setDeviceParameter',
                payload: { deviceId: DORMANT_ACTION_DEVICE_ID, paramId: 'threshold', value: 0.75 },
            },
        },
        {
            label: 'set input',
            action: {
                type: 'setTrackInput',
                payload: { trackId: DORMANT_ACTION_TRACK_ID, inputId: 'new-input' },
            },
        },
        {
            label: 'set output',
            action: {
                type: 'setTrackOutput',
                payload: { trackId: DORMANT_ACTION_TRACK_ID, outputId: 'track-1' },
            },
        },
        {
            label: 'bypass device',
            action: {
                type: 'bypassDevice',
                payload: { deviceId: DORMANT_ACTION_DEVICE_ID, bypassed: true },
            },
        },
        {
            label: 'arm',
            action: {
                type: 'armTrack',
                payload: { trackId: DORMANT_ACTION_TRACK_ID, armed: true },
            },
        },
        {
            label: 'freeze',
            action: { type: 'freezeTrack', payload: { trackId: DORMANT_ACTION_TRACK_ID } },
        },
        {
            label: 'bounce selection',
            action: {
                type: 'bounceSelection',
                payload: { trackId: DORMANT_ACTION_TRACK_ID, startBeat: 0, endBeat: 4 },
            },
        },
        {
            label: 'bounce in place',
            action: { type: 'bounceInPlace', payload: { trackId: DORMANT_ACTION_TRACK_ID } },
        },
        {
            label: 'bounce to new track',
            action: { type: 'bounceToNewTrack', payload: { trackId: DORMANT_ACTION_TRACK_ID } },
        },
    ] satisfies Array<{ label: string; action: AppAction }>)(
        'records no macro, replay, or undo history when dormant denial rejects $label',
        async ({ action }) => {
            seedDormantActionTarget();
            const before = structuredClone(trackStore.value);

            await executeAppAction(action);

            expect(trackStore.value).toEqual(before);
            expect(macroStore.value?.currentRecording).toEqual([]);
            expect(actionHistoryStore.value?.entries).toEqual([]);
            expect(undoStore.value?.past).toEqual([]);
        }
    );

    it.each([
        {
            label: 'input cleanup',
            action: {
                type: 'setTrackInput',
                payload: { trackId: DORMANT_ACTION_TRACK_ID, inputId: null },
            },
            assertTrack: (track: Track) => expect(track.inputId).toBeNull(),
        },
        {
            label: 'disarm cleanup',
            action: {
                type: 'armTrack',
                payload: { trackId: DORMANT_ACTION_TRACK_ID, armed: false },
            },
            assertTrack: (track: Track) => expect(track.armed).toBe(false),
        },
    ] satisfies Array<{ label: string; action: AppAction; assertTrack: (track: Track) => void }>)(
        'records macro, replay, and undo history for permitted dormant $label',
        async ({ action, assertTrack }) => {
            seedDormantActionTarget();
            const before = structuredClone(trackStore.value);

            await executeAppAction(action);

            expect(trackStore.value).not.toEqual(before);
            const updated = trackStore.value?.tracks.find((track) => track.id === DORMANT_ACTION_TRACK_ID);
            if (!updated) {
                throw new Error('Expected updated dormant action target');
            }
            assertTrack(updated);
            expect(macroStore.value?.currentRecording).toEqual([
                expect.objectContaining({
                    type: action.type,
                    payload: expect.objectContaining(action.payload),
                }),
            ]);
            if (action.type === 'armTrack') {
                expect(macroStore.value?.currentRecording[0]).toEqual(
                    expect.objectContaining({
                        payload: expect.objectContaining({
                            midiInputOwnerId: expect.stringMatching(/^arm-command-/),
                        }),
                    })
                );
            }
            expect(actionHistoryStore.value?.entries).toHaveLength(1);
            expect(undoStore.value?.past).toHaveLength(1);
        }
    );

    it.each([
        {
            label: 'a dormant source',
            expectConflict: true,
            prepare: () => {
                const source = trackStore.value?.tracks.find((track) => track.id === 'track-1');
                if (!source) {
                    throw new Error('Expected source track');
                }
                Object.defineProperty(source, 'kind', { value: 'vca' });
            },
            action: {
                type: 'addSidechainRoute',
                payload: { sourceTrackId: 'track-1', targetTrackId: 'track-2' },
            },
        },
        {
            label: 'a dormant destination',
            expectConflict: true,
            prepare: () => {
                const target = trackStore.value?.tracks.find((track) => track.id === 'track-2');
                if (!target) {
                    throw new Error('Expected target track');
                }
                Object.defineProperty(target, 'kind', { value: 'vca' });
            },
            action: {
                type: 'addSidechainRoute',
                payload: { sourceTrackId: 'track-1', targetTrackId: 'track-2' },
            },
        },
        {
            label: 'a malformed source',
            expectConflict: true,
            prepare: () => {
                const source = trackStore.value?.tracks.find((track) => track.id === 'track-1');
                if (!source) {
                    throw new Error('Expected source track');
                }
                Object.defineProperty(source, 'kind', { value: 'malformed' });
            },
            action: {
                type: 'addSidechainRoute',
                payload: { sourceTrackId: 'track-1', targetTrackId: 'track-2' },
            },
        },
        {
            label: 'a malformed destination',
            expectConflict: true,
            prepare: () => {
                const target = trackStore.value?.tracks.find((track) => track.id === 'track-2');
                if (!target) {
                    throw new Error('Expected target track');
                }
                Object.defineProperty(target, 'kind', { value: 'malformed' });
            },
            action: {
                type: 'addSidechainRoute',
                payload: { sourceTrackId: 'track-1', targetTrackId: 'track-2' },
            },
        },
        {
            label: 'a missing source',
            expectConflict: true,
            prepare: () => undefined,
            action: {
                type: 'addSidechainRoute',
                payload: { sourceTrackId: 'missing-source', targetTrackId: 'track-2' },
            },
        },
        {
            label: 'a missing destination',
            prepare: () => undefined,
            action: {
                type: 'addSidechainRoute',
                payload: { sourceTrackId: 'track-1', targetTrackId: 'missing-target' },
            },
        },
        {
            label: 'a target without a sidechain device',
            prepare: () => {
                const target = trackStore.value?.tracks.find((track) => track.id === 'track-2');
                if (!target) {
                    throw new Error('Expected target track');
                }
                target.devices = [];
            },
            action: {
                type: 'addSidechainRoute',
                payload: { sourceTrackId: 'track-1', targetTrackId: 'track-2' },
            },
        },
        {
            label: 'missing Routing store state',
            expectConflict: true,
            prepare: () => sidechainStore.set(null),
            action: {
                type: 'addSidechainRoute',
                payload: { sourceTrackId: 'track-1', targetTrackId: 'track-2' },
            },
        },
        {
            label: 'a duplicate route',
            expectConflict: true,
            prepare: () => {
                sidechainStore.set({
                    routes: [
                        {
                            id: 'existing-route',
                            sourceTrackId: 'track-1',
                            targetTrackId: 'track-2',
                            targetDeviceId: 'sidechain-device',
                            targetParameterId: 'threshold',
                            gain: 1,
                        },
                    ],
                });
            },
            action: {
                type: 'addSidechainRoute',
                payload: { sourceTrackId: 'track-1', targetTrackId: 'track-2' },
            },
        },
    ] satisfies Array<{ label: string; expectConflict?: boolean; prepare: () => void; action: AppAction }>)(
        'records no macro, replay, or undo history for $label',
        async ({ action, expectConflict, prepare }) => {
            prepare();
            const routesBefore = structuredClone(sidechainStore.value);

            if (expectConflict) {
                await expect(executeAppAction(action)).rejects.toThrow('Action conflicts with current project state');
            } else {
                await executeAppAction(action);
            }

            expect(sidechainStore.value).toEqual(routesBefore);
            expect(macroStore.value?.currentRecording).toEqual([]);
            expect(actionHistoryStore.value?.entries).toEqual([]);
            expect(undoStore.value?.past).toEqual([]);
        }
    );

    it('records macro, replay, inverse, and undo history for a real sidechain write', async () => {
        const action = {
            type: 'addSidechainRoute',
            payload: { sourceTrackId: 'track-1', targetTrackId: 'track-2' },
        } satisfies AppAction;

        await executeAppAction(action);

        expect(sidechainStore.value?.routes).toEqual([
            expect.objectContaining({
                sourceTrackId: 'track-1',
                targetTrackId: 'track-2',
                targetDeviceId: 'sidechain-device',
            }),
        ]);
        expect(macroStore.value?.currentRecording).toEqual([
            {
                type: 'addSidechainRoute',
                payload: {
                    sourceTrackId: 'track-1',
                    targetTrackId: 'track-2',
                    targetDeviceId: 'sidechain-device',
                    targetParameterId: 'threshold',
                    gain: 1,
                    routeId: expect.stringMatching(/^sidechain-command-/),
                },
            },
        ]);
        expect(actionHistoryStore.value?.entries).toHaveLength(1);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]).toEqual({ label: 'Add sidechain route' });

        // The public undo store intentionally exposes labels only. Executing undo
        // proves the registered handler retained its inverse action and routes it
        // through removeSidechainRoute to remove the project/runtime route.
        await undo();
        expect(sidechainStore.value?.routes).toEqual([]);
    });

    it('propagates a sidechain cycle without recording macro, replay, or undo history', async () => {
        const action = {
            type: 'addSidechainRoute',
            payload: { sourceTrackId: 'track-2', targetTrackId: 'track-2' },
        } satisfies AppAction;

        await expect(executeAppAction(action)).rejects.toThrow();

        expect(sidechainStore.value?.routes).toEqual([]);
        expect(macroStore.value?.currentRecording).toEqual([]);
        expect(actionHistoryStore.value?.entries).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
    });
});
