import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import {
    actionHistoryStore,
    defaultActionHistoryState,
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

    it('should preserve valid entries, clear hydrated inverses, and drop malformed action rows', () => {
        const valid_entry = {
            id: 'entry-1',
            label: 'Add track',
            actionKind: 'app-action',
            action: { type: 'addTrack', payload: { name: 'Bass' } },
            inverseAction: { type: 'removeTrack', payload: { trackId: 'track-1' } },
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
                    { ...valid_entry, id: 'bad-action', action: { payload: {} } },
                    { ...valid_entry, id: 'bad-inverse', inverseAction: { payload: {} } },
                    { ...valid_entry, id: 'bad-source', source: 'robot' },
                    { ...valid_entry, id: 'bad-timestamp', timestamp: Number.NaN },
                ],
            })
        ).toEqual({ entries: [{ ...valid_entry, inverseAction: null }] });
    });

    it('should strip unknown fields and malformed optional group labels', () => {
        expect(
            sanitize_action_history_state({
                entries: [
                    {
                        id: 'entry-1',
                        label: 'Add track',
                        actionKind: 'app-action',
                        action: { type: 'addTrack', payload: { name: 'Bass' }, stale: true },
                        inverseAction: null,
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
                    action: { type: 'addTrack', payload: { name: 'Bass' } },
                    inverseAction: null,
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
            action: { type: 'togglePlayback' },
            inverseAction: null,
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
                    action: { type: 'addTrack' },
                    inverseAction: null,
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
});
