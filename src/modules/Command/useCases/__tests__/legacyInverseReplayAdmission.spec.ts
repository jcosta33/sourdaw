/**
 * Undo, redo and group revert ask Arrangement's legacy trim admission only for
 * an inverse list that holds a keyless `trimClipStart` inverse, so every other
 * replay runs in a realm that never registered the kernel ports.
 *
 * Every case loads a fresh module graph, because the port holds its
 * registration in module state for the life of the realm.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import type { ActionUndoEntry, UndoEntry } from '../../models/UndoEntry';

const mocks = vi.hoisted(() => ({
    undoStoreValue: {
        value: {
            past: [] as UndoEntry[],
            future: [] as UndoEntry[],
        },
    },
    executeAppAction: vi.fn<typeof import('../executeAppAction').executeAppAction>(),
    executeAppActionBatch: vi.fn<typeof import('../executeAppActionBatch').executeAppActionBatch>(),
}));

vi.mock('../../stores/undoStore', () => ({
    undoStore: {
        get value() {
            return mocks.undoStoreValue.value;
        },
        set: (state: typeof mocks.undoStoreValue.value) => {
            mocks.undoStoreValue.value = state;
        },
    },
}));
vi.mock('../executeAppAction', () => ({ executeAppAction: mocks.executeAppAction }));
vi.mock('../executeAppActionBatch', () => ({ executeAppActionBatch: mocks.executeAppActionBatch }));
vi.mock('../undoTree/undoTreeMoveTo', () => ({ undoTreeMoveTo: vi.fn() }));

const KEYLESS_TRIM_INVERSE: AppAction = {
    type: 'trimClipStart',
    payload: { clipId: 'clip-1', newStartBeat: 2, loopOriginBeat: null },
};
const KEYED_TRIM_INVERSE: AppAction = {
    type: 'trimClipStart',
    payload: { clipId: 'clip-1', newStartBeat: 2, loopOriginBeat: null, midiOffsetBeats: 0 },
};
const GAIN_INVERSE: AppAction = { type: 'setClipGain', payload: { clipId: 'clip-1', gain: 0.5 } };

function actionEntry(id: string, inverseAction: AppAction): ActionUndoEntry {
    return {
        kind: 'action',
        id,
        label: 'Edit',
        timestamp: 0,
        source: 'manual',
        action: { type: 'renameClip', payload: { clipId: 'clip-1', name: 'Edited' } },
        inverseAction,
    };
}

async function loadFreshModules() {
    vi.resetModules();
    const [{ undo }, { executeActionGroupUndo }, { getLegacyInverseReplayFailure }, { legacyInverseReplayAdmission }] =
        await Promise.all([
            import('../undo'),
            import('../executeActionGroupUndo'),
            import('../getLegacyInverseReplayFailure'),
            import('../legacyInverseReplayAdmission'),
        ]);
    return { undo, executeActionGroupUndo, getLegacyInverseReplayFailure, legacyInverseReplayAdmission };
}

let modules: Awaited<ReturnType<typeof loadFreshModules>>;

beforeEach(async () => {
    mocks.executeAppAction.mockReset();
    mocks.executeAppAction.mockResolvedValue(undefined);
    mocks.executeAppActionBatch.mockReset();
    mocks.executeAppActionBatch.mockResolvedValue({ status: 'executed', actions: [] });
    mocks.undoStoreValue.value = { past: [], future: [] };
    modules = await loadFreshModules();
});

describe('legacy inverse replay admission before registration', () => {
    it('undoes a non-trim action without reading the unregistered admission', async () => {
        const entry = actionEntry('gain', GAIN_INVERSE);
        mocks.undoStoreValue.value = { past: [entry], future: [] };

        await modules.undo();

        expect(mocks.executeAppAction).toHaveBeenCalledExactlyOnceWith(GAIN_INVERSE, {
            skipUndo: true,
            skipMacroRecording: true,
            undoEntryId: 'gain',
        });
        expect(mocks.undoStoreValue.value).toEqual({ past: [], future: [entry] });
    });

    it('undoes a group of non-trim inverses without an admission check', async () => {
        const outcome = await modules.executeActionGroupUndo([
            actionEntry('gain', GAIN_INVERSE),
            actionEntry('keyed-trim', KEYED_TRIM_INVERSE),
        ]);

        expect(outcome).toEqual({ status: 'undone' });
        const batchOptions = mocks.executeAppActionBatch.mock.calls[0]?.[1];
        expect(batchOptions).toBeDefined();
        expect(batchOptions?.preExecutionValidation).toBeUndefined();
    });

    it('admits an inverse list without a keyless trim inverse without reading the port', () => {
        expect(modules.getLegacyInverseReplayFailure([GAIN_INVERSE, KEYED_TRIM_INVERSE], 'spec')).toBeNull();
        expect(modules.getLegacyInverseReplayFailure([], 'spec')).toBeNull();
    });

    it('refuses a keyless trim inverse and names the caller and the registrar', () => {
        expect(() => modules.getLegacyInverseReplayFailure([GAIN_INVERSE, KEYLESS_TRIM_INVERSE], 'spec')).toThrow(
            /^spec: .*registerKernelPorts\(\) from #\/app\/registerKernelPorts/
        );
    });
});

describe('legacy inverse replay admission after registration', () => {
    const admit = vi.fn<(actions: readonly AppAction[]) => string | null>();

    beforeEach(() => {
        admit.mockReset();
        admit.mockReturnValue('The legacy MIDI trim has no captured offset');
        modules.legacyInverseReplayAdmission.configure({ getLegacyTrimInverseReplayFailure: admit });
    });

    it("hands undo's keyless trim inverse to the admission and returns its failure", async () => {
        mocks.undoStoreValue.value = { past: [actionEntry('trim', KEYLESS_TRIM_INVERSE)], future: [] };

        await modules.undo();

        const options = mocks.executeAppAction.mock.calls[0]?.[1];
        expect(admit).not.toHaveBeenCalled();
        expect(options?.authorizeFirstHandler?.()).toBe('The legacy MIDI trim has no captured offset');
        expect(admit).toHaveBeenCalledExactlyOnceWith([KEYLESS_TRIM_INVERSE]);
    });

    it("hands a group undo's whole inverse list to the admission", async () => {
        await modules.executeActionGroupUndo([
            actionEntry('gain', GAIN_INVERSE),
            actionEntry('trim', KEYLESS_TRIM_INVERSE),
        ]);

        const batchOptions = mocks.executeAppActionBatch.mock.calls[0]?.[1];
        expect(batchOptions?.preExecutionValidation?.()).toBe('The legacy MIDI trim has no captured offset');
        expect(admit).toHaveBeenCalledExactlyOnceWith([KEYLESS_TRIM_INVERSE, GAIN_INVERSE]);
    });

    it('never asks the admission about a list without a keyless trim inverse', () => {
        expect(modules.getLegacyInverseReplayFailure([GAIN_INVERSE, KEYED_TRIM_INVERSE], 'spec')).toBeNull();
        expect(admit).not.toHaveBeenCalled();
    });

    it('treats an identical registration as a no-op and refuses a different one', () => {
        expect(() =>
            modules.legacyInverseReplayAdmission.configure({ getLegacyTrimInverseReplayFailure: admit })
        ).not.toThrow();
        expect(() =>
            modules.legacyInverseReplayAdmission.configure({ getLegacyTrimInverseReplayFailure: () => null })
        ).toThrow(/legacyInverseReplayAdmission\.configure: .*differs/);
        expect(modules.legacyInverseReplayAdmission.read('spec').getLegacyTrimInverseReplayFailure).toBe(admit);
    });
});
