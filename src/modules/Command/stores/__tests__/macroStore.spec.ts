import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { type Macro } from '../../models/Macro';
import { type MacroStoreState, macroStore } from '../macroStore';

const STORAGE_KEY = 'sourdaw:macros';

/** Resolve after the persistence microtask flush has run. */
function flushPersist(): Promise<void> {
    return new Promise<void>((resolve) => queueMicrotask(resolve));
}

async function loadHydratedMacroState(raw: string): Promise<MacroStoreState | null> {
    vi.resetModules();
    localStorage.setItem(STORAGE_KEY, raw);
    const { macroStore: hydratedMacroStore } = await import('../macroStore');
    return hydratedMacroStore.value;
}

describe('macroStore', () => {
    beforeEach(() => {
        localStorage.removeItem(STORAGE_KEY);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
    });

    afterEach(async () => {
        // Let any pending coalesced write flush before clearing, so a deferred
        // write from one test cannot leak into the next.
        await flushPersist();
        localStorage.removeItem(STORAGE_KEY);
    });

    it('should drop persisted macros that contain malformed action entries', async () => {
        const state = await loadHydratedMacroState(
            JSON.stringify([
                {
                    id: 'valid',
                    name: 'Valid',
                    createdAt: 42,
                    actions: [{ type: 'togglePlayback', payload: { unchecked: true }, extra: 'preserved' }],
                },
                {
                    id: 'array-action',
                    name: 'Array action',
                    createdAt: 43,
                    actions: [['togglePlayback']],
                },
                {
                    id: 'missing-type',
                    name: 'Missing type',
                    createdAt: 44,
                    actions: [{ payload: { unchecked: true } }],
                },
                {
                    id: 'numeric-type',
                    name: 'Numeric type',
                    createdAt: 45,
                    actions: [{ type: 123 }],
                },
            ])
        );

        expect(state).toEqual({
            macros: [
                {
                    id: 'valid',
                    name: 'Valid',
                    createdAt: 42,
                    actions: [{ type: 'togglePlayback', payload: { unchecked: true }, extra: 'preserved' }],
                },
            ],
            recording: false,
            currentRecording: [],
        });
    });

    it('should drop persisted macros with non-finite createdAt values', async () => {
        const state = await loadHydratedMacroState(
            '[{"id":"infinite","name":"Infinite","createdAt":1e999,"actions":[{"type":"togglePlayback"}]}]'
        );

        expect(state).toEqual({ macros: [], recording: false, currentRecording: [] });
    });

    it('should drop persisted macros containing a retired action type', async () => {
        const state = await loadHydratedMacroState(
            JSON.stringify([
                {
                    id: 'valid',
                    name: 'Valid',
                    createdAt: 42,
                    actions: [{ type: 'togglePlayback' }],
                },
                {
                    id: 'restore-snapshot',
                    name: 'Restore snapshot',
                    createdAt: 43,
                    actions: [{ type: 'restoreDsoSnapshot', payload: { bundle: {} } }],
                },
            ])
        );

        expect(state).toEqual({
            macros: [
                {
                    id: 'valid',
                    name: 'Valid',
                    createdAt: 42,
                    actions: [{ type: 'togglePlayback' }],
                },
            ],
            recording: false,
            currentRecording: [],
        });
    });

    it('should hydrate malformed raw storage text to empty runtime state', async () => {
        const state = await loadHydratedMacroState('{not json');

        expect(state).toEqual({ macros: [], recording: false, currentRecording: [] });
    });

    it('should hydrate non-array top-level storage to empty runtime state', async () => {
        const state = await loadHydratedMacroState('{"macros":[]}');

        expect(state).toEqual({ macros: [], recording: false, currentRecording: [] });
    });

    it('should persist macros array to localStorage when state updates', async () => {
        const macros: Macro[] = [
            { id: 'm1', name: 'Test macro', actions: [{ type: 'togglePlayback' }], createdAt: 42 },
        ];
        macroStore.set({ macros, recording: false, currentRecording: [] });

        // Persistence writes are coalesced onto a microtask flush.
        await flushPersist();

        const raw = localStorage.getItem(STORAGE_KEY);
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw!) as Macro[];
        expect(parsed).toHaveLength(1);
        expect(parsed[0]?.name).toBe('Test macro');
        expect(parsed[0]?.id).toBe('m1');
    });

    it('should expose recording and currentRecording in state', () => {
        macroStore.set({ macros: [], recording: true, currentRecording: [{ type: 'stopPlayback' }] });

        expect(macroStore.value?.recording).toBe(true);
        expect(macroStore.value?.currentRecording).toEqual([{ type: 'stopPlayback' }]);
    });

    it('should NOT write to localStorage while recording (no O(N) writes per recorded action)', async () => {
        // Seed a committed write so the key exists, then flip into recording.
        macroStore.set({
            macros: [{ id: 'm1', name: 'seed', actions: [], createdAt: 1 }],
            recording: false,
            currentRecording: [],
        });
        await flushPersist();
        localStorage.removeItem(STORAGE_KEY);

        // Each recorded action mutates currentRecording while recording === true.
        macroStore.set({
            macros: macroStore.value!.macros,
            recording: true,
            currentRecording: [{ type: 'togglePlayback' }],
        });
        macroStore.set({
            macros: macroStore.value!.macros,
            recording: true,
            currentRecording: [{ type: 'togglePlayback' }, { type: 'stopPlayback' }],
        });
        await flushPersist();

        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('should coalesce multiple committing mutations in the same turn into one write', async () => {
        // Three synchronous sets before the microtask runs.
        macroStore.set({
            macros: [{ id: 'a', name: 'a', actions: [], createdAt: 1 }],
            recording: false,
            currentRecording: [],
        });
        macroStore.set({
            macros: [{ id: 'b', name: 'b', actions: [], createdAt: 2 }],
            recording: false,
            currentRecording: [],
        });
        macroStore.set({
            macros: [{ id: 'c', name: 'c', actions: [], createdAt: 3 }],
            recording: false,
            currentRecording: [],
        });
        await flushPersist();

        // Only the final state is serialized.
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Macro[];
        expect(parsed).toHaveLength(1);
        expect(parsed[0]?.id).toBe('c');
    });

    it('should cap the persisted macro list at MAX_MACROS (100)', async () => {
        const macros: Macro[] = Array.from({ length: 130 }, (_item, index) => ({
            id: `m${index}`,
            name: `macro ${index}`,
            actions: [],
            createdAt: index,
        }));
        macroStore.set({ macros, recording: false, currentRecording: [] });
        await flushPersist();

        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Macro[];
        expect(parsed).toHaveLength(100);
        // The most recent macros are kept (tail slice).
        expect(parsed[0]?.id).toBe('m30');
        expect(parsed[parsed.length - 1]?.id).toBe('m129');
        // In-memory state is untouched — only the persisted projection is trimmed.
        expect(macroStore.value?.macros).toHaveLength(130);
    });

    it('should cap each persisted macro at MAX_MACRO_ACTIONS (500)', async () => {
        const actions = Array.from({ length: 600 }, () => ({ type: 'togglePlayback' as const }));
        macroStore.set({
            macros: [{ id: 'big', name: 'big', actions, createdAt: 1 }],
            recording: false,
            currentRecording: [],
        });
        await flushPersist();

        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Macro[];
        expect(parsed[0]?.actions).toHaveLength(500);
        // In-memory state keeps the full action list.
        expect(macroStore.value?.macros[0]?.actions).toHaveLength(600);
    });
});
