import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { createEventBus } from '#/infra/events/createEventBus';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    getExecutableCommandRegistrations,
    redo,
    registerProductionCommandHandlers,
    undo,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { createDefaultProductionBrief, isProductionBrief, type ProductionBrief } from '../../models/ProductionBrief';
import { defaultProjectStoreState, projectStore } from '../../stores/projectStore';
import { acceptCreativeIntent } from '../acceptCreativeIntent';
import { getProjectHandlers } from '../getProjectHandlers';
import { setTrackCanonicalRole } from '../setTrackCanonicalRole';
import { unlockProjectScopedBrief } from '../unlockProjectScopedBrief';

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const GAIN_TRACK_ID = 'track-gain';
const ROLE_TRACK_ID = 'track-role';

type StoredEntry = {
    label: string;
    action: AppAction;
    inverseAction: AppAction | null;
    redoAction?: AppAction;
};
type StoredSession = { past: StoredEntry[]; future: StoredEntry[] };
type BriefAction = Extract<AppAction, { type: 'setProductionBrief' }>;
type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

function registerHandlers(): void {
    registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
}

function readStoredSession(): StoredSession {
    const raw = sessionStorage.getItem(UNDO_SESSION_KEY);
    return raw === null ? { past: [], future: [] } : (JSON.parse(raw) as StoredSession);
}

/** The mirror writes after the history moves; waiting for the stored labels is that write landing. */
async function awaitStoredPastLabels(labels: readonly string[]): Promise<void> {
    await vi.waitFor(() => {
        expect(readStoredSession().past.map((entry) => entry.label)).toEqual(labels);
    });
}

/** A reload: the handlers are registered afresh, and registration replaces the live stacks with the mirror's. */
function reload(): void {
    clearHandlerRegistry();
    registerHandlers();
}

function tamperNewestBriefEntry(edit: (entry: StoredEntry) => void): void {
    const session = readStoredSession();
    const newest = session.past[session.past.length - 1];
    if (!newest || newest.action.type !== 'setProductionBrief') {
        throw new Error('The newest stored entry is not a brief edit.');
    }
    edit(newest);
    sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(session));
}

function briefPayload(action: AppAction | null | undefined): BriefAction['payload'] {
    if (!action || action.type !== 'setProductionBrief') {
        throw new Error('Not a brief action.');
    }
    return action.payload;
}

/** The stored brief itself, so a tamper edits the object the mirror will parse. */
function storedBrief(payload: BriefAction['payload']): ProductionBrief {
    if (!isProductionBrief(payload.brief)) {
        throw new Error('The stored payload holds no brief.');
    }
    return payload.brief;
}

function currentBrief(): ProductionBrief {
    const brief = projectStore.value?.productionBrief;
    if (!brief) {
        throw new Error('No project is open.');
    }
    return brief;
}

function gainOf(trackId: string): number {
    const gain = trackStore.value?.tracks.find((track) => track.id === trackId)?.gain;
    if (gain === undefined) {
        throw new Error(`No track ${trackId}.`);
    }
    return gain;
}

const PROJECT_LOCK = {
    id: 'lock-project',
    scope: { kind: 'project' as const },
    statement: 'Hold the arrangement',
    createdAt: 100,
};
const TRACK_LOCK = {
    id: 'lock-gain-track',
    scope: { kind: 'track' as const, trackId: GAIN_TRACK_ID },
    statement: 'Keep the gain track as it is',
    createdAt: 100,
};

/** Change a gain, then a canonical role through the Inspector's writer, and let the mirror record both. */
async function changeGainThenRole(): Promise<void> {
    await executeAppAction({
        type: 'setTrackGain',
        payload: { trackId: GAIN_TRACK_ID, gain: 0.25, expectedGain: gainOf(GAIN_TRACK_ID) },
    });
    await setTrackCanonicalRole({ trackId: ROLE_TRACK_ID, role: 'bass', expectedRevision: 0 });
    await awaitStoredPastLabels(['Set track gain', 'Update production brief to revision 1']);
}

describe('production brief undo across a session restore', () => {
    beforeEach(() => {
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        clearHandlerRegistry();
        registerHandlers();
        setArrangementEventBus(createEventBus());
        setNotificationEventBus(createEventBus<NotificationEvents>());
        setTrackStoreState({
            ...structuredClone(defaultTrackState),
            tracks: [
                { ...createTrack({ id: GAIN_TRACK_ID, name: 'Pad', kind: 'audio' }), gain: 0.8 },
                createTrack({ id: ROLE_TRACK_ID, name: 'Low end', kind: 'midi' }),
            ],
        });
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            productionBrief: createDefaultProductionBrief(100),
        });
        clearUndoHistory();
    });

    afterEach(() => {
        clearHandlerRegistry();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
    });

    it('keeps the brief command hidden from discovery', () => {
        const registration = getExecutableCommandRegistrations().find(
            (candidate) => candidate.actionType === 'setProductionBrief'
        );

        expect(registration?.discoverability).toBe('hidden');
    });

    it('restores a role change and the gain change before it, and undoes them newest first', async () => {
        const initialGain = gainOf(GAIN_TRACK_ID);
        await changeGainThenRole();

        reload();

        expect(undoStore.value?.past.map((entry) => entry.label)).toEqual([
            'Set track gain',
            'Update production brief to revision 1',
        ]);
        await undo();
        expect(currentBrief().trackRoles).toEqual([]);
        expect(gainOf(GAIN_TRACK_ID)).toBe(0.25);

        await undo();
        expect(gainOf(GAIN_TRACK_ID)).toBe(initialGain);

        await redo();
        await redo();
        expect(currentBrief().trackRoles.map(({ trackId, role }) => ({ trackId, role }))).toEqual([
            { trackId: ROLE_TRACK_ID, role: 'bass' },
        ]);
    });

    it('replays a restored redo of an unlock with the authority the unlock had', async () => {
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            productionBrief: { ...createDefaultProductionBrief(100), locks: [PROJECT_LOCK] },
        });
        await expect(unlockProjectScopedBrief()).resolves.toBe('unlocked');
        await undo();
        expect(currentBrief().locks).toEqual([PROJECT_LOCK]);
        await vi.waitFor(() => {
            expect(readStoredSession().future).toHaveLength(1);
        });

        reload();
        await redo();

        expect(currentBrief().locks).toEqual([]);
        expect(undoStore.value?.past).toHaveLength(1);
    });

    it('replays a restored undo of a decision accepted while a lock is held', async () => {
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            productionBrief: { ...createDefaultProductionBrief(100), locks: [TRACK_LOCK] },
        });
        await acceptCreativeIntent({ statement: 'Keep the verse sparse' });
        expect(currentBrief().decisions).toHaveLength(1);
        await vi.waitFor(() => {
            expect(readStoredSession().past).toHaveLength(1);
        });

        reload();
        await undo();

        expect(currentBrief().decisions).toEqual([]);
        expect(currentBrief().locks).toEqual([TRACK_LOCK]);
    });

    it.each([
        {
            tamper: 'an inverse that is not a production brief',
            edit: (entry: StoredEntry) => {
                briefPayload(entry.inverseAction).brief = { vision: 'not a brief' };
            },
        },
        {
            tamper: 'an inverse off the revision chain',
            edit: (entry: StoredEntry) => {
                const payload = briefPayload(entry.inverseAction);
                payload.expectedRevision += 5;
                storedBrief(payload).revision += 5;
            },
        },
        {
            tamper: 'a redo that writes a different brief from the forward edit',
            edit: (entry: StoredEntry) => {
                storedBrief(briefPayload(entry.redoAction)).trackRoles = [];
            },
        },
        {
            tamper: 'a redo off the revision chain',
            edit: (entry: StoredEntry) => {
                briefPayload(entry.redoAction).expectedRevision += 1;
            },
        },
        {
            tamper: 'no redo',
            edit: (entry: StoredEntry) => {
                delete entry.redoAction;
            },
        },
    ])('drops a restored brief entry carrying $tamper, and the older history with it', async ({ edit }) => {
        await changeGainThenRole();
        tamperNewestBriefEntry(edit);

        reload();

        expect(undoStore.value?.past).toEqual([]);
    });

    it('still refuses a fresh brief write that removes a locked entry', async () => {
        const locked = { ...createDefaultProductionBrief(100), locks: [PROJECT_LOCK] };
        projectStore.set({ ...structuredClone(defaultProjectStoreState), productionBrief: locked });

        await expect(
            executeAppAction({
                type: 'setProductionBrief',
                payload: { expectedRevision: 0, brief: { ...locked, revision: 1, locks: [] } },
            })
        ).rejects.toThrow();

        expect(currentBrief().locks).toEqual([PROJECT_LOCK]);
    });

    it('still refuses a fresh brief write that names a track the project no longer holds', () => {
        const handler = getProjectHandlers().setProductionBrief;
        const brief = {
            ...createDefaultProductionBrief(100),
            revision: 1,
            trackRoles: [{ id: 'role-gone', trackId: 'track-removed', role: 'bass', createdAt: 100 }],
        };
        const action: BriefAction = { type: 'setProductionBrief', payload: { expectedRevision: 0, brief } };

        expect(handler.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(false);
    });
});
