import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import { tempoMapStore, type TempoChange } from '../tempoMapStore';

type TestDoc = {
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

const fake_doc: TestDoc = {};

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

describe('tempoMapStore', () => {
    beforeEach(async () => {
        configureAutomergeStoragePort(null);
        tempoMapStore.set({ changes: [] });
        await flush_pending_frame();
        clear_fake_doc();
        configure_fake_crdt_port();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('should have an initial empty state', () => {
        expect(tempoMapStore.value).toEqual({ changes: [] });
    });

    it('should store tempo changes', () => {
        const change = { id: '1', beat: 4, tempo: 140, curve: 'linear' } satisfies TempoChange;
        tempoMapStore.set({ changes: [change] });

        expect(tempoMapStore.value?.changes).toHaveLength(1);
        expect(tempoMapStore.value?.changes[0]).toEqual(change);
    });

    it('should update state', () => {
        tempoMapStore.update((state) => ({
            ...state,
            changes: [...(state?.changes ?? []), { id: '2', beat: 8, tempo: 120, curve: 'instant' as const }],
        }));

        expect(tempoMapStore.value?.changes).toHaveLength(1);
        expect(tempoMapStore.value?.changes[0]?.beat).toBe(8);
    });

    it('should sanitize invalid top-level CRDT hydration to an empty tempo map without throwing', () => {
        fake_doc.tempoMap = 'invalid-tempo-map';

        expect(() => tempoMapStore.hydrate()).not.toThrow();

        expect(tempoMapStore.value).toEqual({ changes: [] });
    });

    it('should sanitize invalid CRDT changes to an empty tempo map without throwing', () => {
        fake_doc.tempoMap = { changes: 'not-an-array' };

        expect(() => tempoMapStore.hydrate()).not.toThrow();

        expect(tempoMapStore.value).toEqual({ changes: [] });
    });

    it('should drop malformed CRDT tempo changes while preserving valid neighbors', () => {
        const valid_change = { id: 'tempo-valid', beat: 4, tempo: 140, curve: 'linear' } satisfies TempoChange;
        fake_doc.tempoMap = {
            changes: [
                valid_change,
                { id: 7, beat: 8, tempo: 120, curve: 'instant' },
                { id: 'negative-beat', beat: -1, tempo: 120, curve: 'instant' },
                { id: 'low-tempo', beat: 12, tempo: 19, curve: 'instant' },
                { id: 'bad-curve', beat: 16, tempo: 120, curve: 'exponential' },
            ],
        };

        tempoMapStore.hydrate();

        expect(tempoMapStore.value).toEqual({ changes: [valid_change] });
    });

    it('should preserve valid CRDT tempo map hydration', () => {
        const valid_changes = [
            { id: 'tempo-a', beat: 0, tempo: 120, curve: 'instant' },
            { id: 'tempo-b', beat: 8, tempo: 150, curve: 'linear' },
        ] satisfies TempoChange[];
        fake_doc.tempoMap = { changes: valid_changes };

        tempoMapStore.hydrate();

        expect(tempoMapStore.value).toEqual({ changes: valid_changes });
    });

    it('should strip extra CRDT object fields while preserving valid tempo changes', () => {
        fake_doc.tempoMap = {
            changes: [
                {
                    id: 'tempo-extra',
                    beat: 4,
                    tempo: 132,
                    curve: 'linear',
                    hiddenField: 'drop-me',
                },
            ],
            hiddenTopLevel: true,
        };

        tempoMapStore.hydrate();

        expect(tempoMapStore.value).toEqual({
            changes: [{ id: 'tempo-extra', beat: 4, tempo: 132, curve: 'linear' }],
        });
    });
});
