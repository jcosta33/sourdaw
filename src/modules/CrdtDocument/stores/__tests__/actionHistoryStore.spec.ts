import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import {
    actionHistoryStore,
    defaultActionHistoryState,
    markEntryReverted,
    pushActionHistoryEntry,
    sanitize_action_history_state,
    type ActionHistoryState,
} from '../actionHistoryStore';

type TestDoc = {
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

const fake_doc: TestDoc = {};
let mutation_count = 0;

function clear_fake_doc(): void {
    for (const key of Object.keys(fake_doc)) {
        delete fake_doc[key];
    }
}

function configure_fake_crdt_port(): void {
    const port: TestPort = {
        getDoc: () => fake_doc,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            mutation_count += 1;
            changeFn(fake_doc);
        },
    };

    configureAutomergeStoragePort(port);
}

async function flush_pending_frame(): Promise<void> {
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

describe('sanitize_action_history_state', () => {
    it('should reset malformed persisted action-history state', () => {
        expect(sanitize_action_history_state('corrupt')).toEqual(defaultActionHistoryState);
    });

    it('should retain display metadata but strip executable fields from hydrated rows', () => {
        expect(
            sanitize_action_history_state({
                entries: [
                    {
                        id: 'entry-1',
                        label: 'Add track',
                        actionKind: 'addTrack',
                        action: { type: 'addTrack', payload: { name: 'Bass' } },
                        inverseAction: { type: 'removeTrack', payload: { trackId: 'track-1' } },
                        source: 'manual',
                        timestamp: 10,
                        reverted: false,
                    },
                ],
            })
        ).toEqual({
            entries: [
                {
                    id: 'entry-1',
                    label: 'Add track',
                    actionKind: 'addTrack',
                    source: 'manual',
                    timestamp: 10,
                    reverted: false,
                },
            ],
        });
    });

    it('should preserve valid metadata and drop malformed metadata rows', () => {
        const valid_entry = {
            id: 'entry-1',
            label: 'Add track',
            actionKind: 'app-action',
            source: 'manual',
            timestamp: 10,
            groupId: 'group-1',
            groupLabel: 'Group',
            reverted: false,
        };

        expect(
            sanitize_action_history_state({
                entries: [
                    valid_entry,
                    { ...valid_entry, id: 'bad-source', source: 'robot' },
                    { ...valid_entry, id: 'bad-timestamp', timestamp: Number.NaN },
                ],
            })
        ).toEqual({ entries: [valid_entry] });
    });

    it('should strip unknown fields and malformed optional group labels', () => {
        expect(
            sanitize_action_history_state({
                entries: [
                    {
                        id: 'entry-1',
                        label: 'Add track',
                        actionKind: 'app-action',
                        source: 'ai',
                        timestamp: 10,
                        groupId: 42,
                        groupLabel: 'Group',
                        reverted: true,
                        stale: true,
                    },
                ],
                stale: true,
            })
        ).toEqual({
            entries: [
                {
                    id: 'entry-1',
                    label: 'Add track',
                    actionKind: 'app-action',
                    source: 'ai',
                    timestamp: 10,
                    groupLabel: 'Group',
                    reverted: true,
                },
            ],
        });
    });

    it('should cap exact hydrated history to the same MAX_HISTORY window as writes', () => {
        const entries = Array.from({ length: 201 }, (_, index) => ({
            id: `entry-${index}`,
            label: `Action ${index}`,
            actionKind: 'app-action',
            source: 'manual' as const,
            timestamp: index,
            reverted: false,
        }));

        expect(sanitize_action_history_state({ entries }).entries).toHaveLength(200);
        expect(sanitize_action_history_state({ entries }).entries[0]?.id).toBe('entry-1');
    });
});

describe('actionHistoryStore', () => {
    beforeEach(async () => {
        configureAutomergeStoragePort(null);
        actionHistoryStore.set(defaultActionHistoryState);
        await flush_pending_frame();
        clear_fake_doc();
        mutation_count = 0;
        configure_fake_crdt_port();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('should sanitize malformed CRDT hydration to an empty history without throwing', () => {
        fake_doc.actionHistory = { entries: 'not-an-array' };

        expect(() => {
            actionHistoryStore.hydrate();
        }).not.toThrow();

        expect(actionHistoryStore.value).toEqual(defaultActionHistoryState);
    });

    it('should preserve valid CRDT hydration without writing back', async () => {
        const valid_state = {
            entries: [
                {
                    id: 'entry-1',
                    label: 'Add track',
                    actionKind: 'app-action',
                    source: 'manual',
                    timestamp: 10,
                    reverted: false,
                },
            ],
        } satisfies ActionHistoryState;
        fake_doc.actionHistory = valid_state;

        actionHistoryStore.hydrate();
        await flush_pending_frame();

        expect(actionHistoryStore.value).toEqual(valid_state);
        expect(mutation_count).toBe(0);
    });

    it('should return the exact metadata IDs evicted by a bounded write', () => {
        const entries = Array.from({ length: 200 }, (_, index) => ({
            id: `entry-${index}`,
            label: `Action ${index}`,
            actionKind: 'app-action',
            source: 'manual' as const,
            timestamp: index,
            reverted: false,
        }));
        actionHistoryStore.set({ entries });

        const evicted_entry_ids = pushActionHistoryEntry({
            id: 'entry-200',
            label: 'Action 200',
            actionKind: 'app-action',
            source: 'manual',
            timestamp: 200,
            reverted: false,
        });

        expect(evicted_entry_ids).toEqual(['entry-0']);
        expect(actionHistoryStore.value?.entries[0]?.id).toBe('entry-1');
        expect(actionHistoryStore.value?.entries.at(-1)?.id).toBe('entry-200');
    });

    it('should mark only the row whose ID and immutable fingerprint both match', () => {
        actionHistoryStore.set({
            entries: [
                {
                    id: 'shared-id',
                    label: 'Local action',
                    actionKind: 'setTempo',
                    source: 'manual',
                    timestamp: 10,
                    reverted: false,
                },
                {
                    id: 'shared-id',
                    label: 'Peer replacement',
                    actionKind: 'setTempo',
                    source: 'manual',
                    timestamp: 10,
                    reverted: false,
                },
            ],
        });

        const outcome = markEntryReverted({
            entryId: 'shared-id',
            expectedFingerprint: '["shared-id","Local action","setTempo","manual",10,null,null]',
        });

        expect(outcome).toEqual({ status: 'marked' });
        expect(actionHistoryStore.value?.entries).toEqual([
            expect.objectContaining({ label: 'Local action', reverted: true }),
            expect.objectContaining({ label: 'Peer replacement', reverted: false }),
        ]);
    });
});
