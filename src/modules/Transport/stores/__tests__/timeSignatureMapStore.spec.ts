import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import { timeSignatureMapStore, type TimeSignatureChange } from '../timeSignatureMapStore';

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

describe('timeSignatureMapStore', () => {
    beforeEach(async () => {
        configureAutomergeStoragePort(null);
        timeSignatureMapStore.set({ changes: [] });
        await flush_pending_frame();
        clear_fake_doc();
        configure_fake_crdt_port();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('should have an initial empty state', () => {
        expect(timeSignatureMapStore.value).toEqual({ changes: [] });
    });

    it('should store time-signature changes', () => {
        const change = { id: '1', beat: 4, numerator: 3, denominator: 4 } satisfies TimeSignatureChange;
        timeSignatureMapStore.set({ changes: [change] });

        expect(timeSignatureMapStore.value?.changes).toHaveLength(1);
        expect(timeSignatureMapStore.value?.changes[0]).toEqual(change);
    });

    it('should sanitize invalid top-level CRDT hydration to an empty time-signature map without throwing', () => {
        fake_doc.timeSignatureMap = 'invalid-time-signature-map';

        expect(() => timeSignatureMapStore.hydrate()).not.toThrow();

        expect(timeSignatureMapStore.value).toEqual({ changes: [] });
    });

    it('should sanitize invalid CRDT changes to an empty time-signature map without throwing', () => {
        fake_doc.timeSignatureMap = { changes: 'not-an-array' };

        expect(() => timeSignatureMapStore.hydrate()).not.toThrow();

        expect(timeSignatureMapStore.value).toEqual({ changes: [] });
    });

    it('should drop malformed CRDT time-signature changes while preserving valid neighbors', () => {
        const valid_change = {
            id: 'time-signature-valid',
            beat: 4,
            numerator: 3,
            denominator: 4,
        } satisfies TimeSignatureChange;
        fake_doc.timeSignatureMap = {
            changes: [
                valid_change,
                { id: 7, beat: 8, numerator: 4, denominator: 4 },
                { id: 'negative-beat', beat: -1, numerator: 4, denominator: 4 },
                { id: 'zero-numerator', beat: 12, numerator: 0, denominator: 4 },
                { id: 'fractional-denominator', beat: 16, numerator: 4, denominator: 4.5 },
            ],
        };

        timeSignatureMapStore.hydrate();

        expect(timeSignatureMapStore.value).toEqual({ changes: [valid_change] });
    });

    it('should preserve valid CRDT time-signature map hydration', () => {
        const valid_changes = [
            { id: 'time-signature-a', beat: 0, numerator: 4, denominator: 4 },
            { id: 'time-signature-b', beat: 8, numerator: 7, denominator: 8 },
        ] satisfies TimeSignatureChange[];
        fake_doc.timeSignatureMap = { changes: valid_changes };

        timeSignatureMapStore.hydrate();

        expect(timeSignatureMapStore.value).toEqual({ changes: valid_changes });
    });
});
