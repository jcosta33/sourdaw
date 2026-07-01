import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

// A single fake CRDT document the mocked primitives read and mutate, so the
// real `createAutomergeStorage` adapter configured by `kneadStore` exercises
// its `toCrdt` / `fromCrdt` callbacks against controllable state.
const fakeDoc: Record<string, unknown> = {};

import { kneadStore, defaultKneadState } from '../kneadStore';

function configureFakeCrdtPort(): void {
    configureAutomergeStoragePort({
        getDoc: () => fakeDoc,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            changeFn(fakeDoc);
        },
    });
}

async function flushRaf(): Promise<void> {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
}

describe('kneadStore persistence of transient analysis flags', () => {
    beforeEach(() => {
        for (const key of Object.keys(fakeDoc)) {
            delete fakeDoc[key];
        }
        configureFakeCrdtPort();
        kneadStore.set(defaultKneadState);
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('does not persist isAnalyzing / analysisProgress to the CRDT', async () => {
        kneadStore.set({ ...defaultKneadState, isAnalyzing: true, analysisProgress: 0.5 });
        await flushRaf();

        const persisted = fakeDoc.knead as Record<string, unknown>;
        expect(persisted).toBeDefined();
        expect(persisted).not.toHaveProperty('isAnalyzing');
        expect(persisted).not.toHaveProperty('analysisProgress');
        // Durable fields are still persisted.
        expect(persisted).toHaveProperty('clips');
        expect(persisted).toHaveProperty('contours');
    });

    it('resets a stale isAnalyzing flag from an older document on hydrate', () => {
        // Simulate a document persisted before the strip, or a mid-analysis crash.
        fakeDoc.knead = {
            activeClipId: null,
            clips: {},
            contours: {},
            isAnalyzing: true,
            analysisProgress: 0.7,
        };

        kneadStore.hydrate();

        expect(kneadStore.value?.isAnalyzing).toBe(false);
        expect(kneadStore.value?.analysisProgress).toBe(0);
    });
});
