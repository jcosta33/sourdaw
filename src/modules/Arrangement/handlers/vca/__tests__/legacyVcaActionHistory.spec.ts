import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
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
import { type AppAction } from '#/utils/handlerContract';

import { createTrack } from '../../../models/Track';
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
    first.vcaGroupId = 'vca-a';
    trackStore.set({ tracks: [first, second], selectedTrackId: first.id, ghostClips: [] });
    setVcaGroupsState([
        { id: 'vca-a', name: 'A', gain: 0.5, muted: false, trackIds: [first.id] },
        { id: 'vca-b', name: 'B', gain: 1, muted: false, trackIds: [] },
    ]);
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

    it.each([
        {
            label: 'a colliding create replay identity',
            prepare: () => {
                setVcaGroupsState([
                    ...getVcaGroupsState(),
                    { id: 'vca-12345678', name: 'Existing', gain: 1, muted: false, trackIds: [] },
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
});
