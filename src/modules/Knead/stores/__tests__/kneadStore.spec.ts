import { beforeEach, describe, expect, it, vi } from 'vitest';

// A single fake CRDT document the mocked primitives read and mutate, so the
// real `createAutomergeStorage` adapter configured by `kneadStore` exercises
// its `toCrdt` / `fromCrdt` callbacks against controllable state.
const fakeDoc: Record<string, unknown> = {};

vi.mock('#/modules/CrdtDocument/stores/semanticChangeContext', () => ({
    getSemanticContext: () => null,
}));
vi.mock('#/modules/CrdtDocument/useCases/getCrdtDoc', () => ({
    getCrdtDoc: () => fakeDoc,
}));
vi.mock('#/modules/CrdtDocument/useCases/hasCrdtDoc', () => ({
    hasCrdtDoc: () => true,
}));
vi.mock('#/modules/CrdtDocument/useCases/mutateCrdtDoc', () => ({
    mutateCrdtDoc: ({ changeFn }: { changeFn: (doc: Record<string, unknown>) => void }) => {
        changeFn(fakeDoc);
    },
}));

import { kneadStore, defaultKneadState } from '../kneadStore';

async function flushRaf(): Promise<void> {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
}

describe('kneadStore persistence of transient analysis flags', () => {
    beforeEach(() => {
        for (const key of Object.keys(fakeDoc)) {
            delete fakeDoc[key];
        }
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
