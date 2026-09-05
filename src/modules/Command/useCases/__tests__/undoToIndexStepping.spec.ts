import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';

import { AppActionConflictError } from '../../errors/AppActionExecutionError';
import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { undoToIndex } from '../undoToIndex';

import type { ActionUndoEntry, UndoEntry } from '../../models/UndoEntry';
import type { UndoStoreState } from '../../stores/undoStore';

// #2881 — the anchor-targeted history sweep must not inherit the keystroke
// path's step-over. `undoToIndex(n)` rewinds TO row n: that row names the entry
// the user clicked to KEEP, so when the head above it conflicts, stepping over
// it onto "the next unit" undoes exactly the row the user targeted. The sweep
// therefore drives the no-step variant of `undo`; only the bare keystroke entry
// point ever steps. These specs run the REAL `undoToIndex` and the REAL
// `undo` (only `executeAppAction` and friends are mocked), with the production
// Arrangement handler map registered so the step-over gate reads live
// capability flags — proving the sweep refuses to step even onto a unit that
// IS flagged conflict-capable.

const mocks = vi.hoisted(() => ({
    undoStoreValue: {
        value: { past: [] as UndoEntry[], future: [] as UndoEntry[] },
    },
    executeAppAction: vi.fn<typeof import('../executeAppAction').executeAppAction>(),
    executeAppActionBatch: vi.fn<typeof import('../executeAppActionBatch').executeAppActionBatch>(),
    undoTreeMoveTo: vi.fn<(currentEntryId: string | null) => void>(),
    notifyUser: vi.fn<(message: string, level?: string) => void>(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('../../stores/undoStore', () => ({
    undoStore: {
        get value() {
            return mocks.undoStoreValue.value;
        },
        // The sweep re-reads the store after every step, so the mock has to
        // apply writes the way the real store does.
        set: (next: UndoStoreState) => {
            mocks.undoStoreValue.value = next;
        },
    },
}));

vi.mock('../executeAppAction', () => ({
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('../executeAppActionBatch', () => ({
    executeAppActionBatch: mocks.executeAppActionBatch,
}));

vi.mock('../undoTree/undoTreeMoveTo', () => ({
    undoTreeMoveTo: mocks.undoTreeMoveTo,
}));

vi.mock('../isProjectMutationAllowed', () => ({
    getProjectMutationAdmissionFailure: () => null,
}));

function actionEntry(overrides: Partial<ActionUndoEntry> = {}): ActionUndoEntry {
    return {
        kind: 'action',
        id: 'e1',
        label: 'Test',
        timestamp: 0,
        source: 'manual',
        action: { type: 'togglePlayback' },
        inverseAction: { type: 'toggleRecording' },
        ...overrides,
    };
}

/** An inverse whose handler is flagged `canReportConflict` — a step the gate
 *  WOULD admit; the sweep must still refuse it. */
const conflictCapableFadeInverse = {
    type: 'setClipFade',
    payload: { clipId: 'clip-1', fadeInBeats: 0, fadeOutBeats: 0, expectedFadeInBeats: 0, expectedFadeOutBeats: 0 },
} as const;

const conflictCapableGainInverse = {
    type: 'setTrackGain',
    payload: { trackId: 'track-1', gain: 0.5, expectedGain: 0.8 },
} as const;

/** Rejects the inverses named here as guarded conflicts; applies every other. */
function conflictOn(...actionTypes: readonly string[]): void {
    mocks.executeAppAction.mockImplementation(async (action) => {
        if (actionTypes.includes(action.type)) {
            throw new AppActionConflictError(action.type);
        }
    });
}

describe('undoToIndex never steps over a conflicted head (#2881)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.undoStoreValue.value = { past: [], future: [] };
        mocks.executeAppAction.mockResolvedValue(undefined);
        mocks.executeAppActionBatch.mockResolvedValue({ status: 'executed', actions: [] });
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
    });

    it('attempts only the conflicted head when rewinding to the row beneath it', async () => {
        const keptRow = actionEntry({
            id: 'a-1',
            label: 'Deep Action',
            inverseAction: { type: 'setClipColor', payload: { clipId: 'clip-1', color: '#00ff00' } },
        });
        const targetRow = actionEntry({
            id: 'v-1',
            label: 'Target Row',
            inverseAction: conflictCapableFadeInverse,
        });
        const conflictedHead = actionEntry({
            id: 'u-1',
            label: 'Head Edit',
            inverseAction: conflictCapableGainInverse,
        });
        mocks.undoStoreValue.value = { past: [keptRow, targetRow, conflictedHead], future: [] };
        conflictOn('setTrackGain');

        await expect(undoToIndex(1)).resolves.toBeUndefined();

        // Exactly one inverse attempt — the conflicted head's. No step onto the
        // target row, no batch, nothing moved: every row stays applied.
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppAction).toHaveBeenCalledWith(conflictCapableGainInverse, expect.anything());
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
        expect(mocks.undoStoreValue.value.past.map((entry) => entry.id)).toEqual(['a-1', 'v-1', 'u-1']);
        expect(mocks.undoStoreValue.value.future).toEqual([]);
        expect(mocks.undoTreeMoveTo).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith('Cannot undo "Head Edit": project state has changed', 'warning');
    });

    it('still undoes normally when nothing conflicts: no-step is not no-undo', async () => {
        const keptRow = actionEntry({ id: 'a-1', label: 'Deep Action' });
        const middleRow = actionEntry({ id: 'v-1', label: 'Target Row', inverseAction: conflictCapableFadeInverse });
        const headRow = actionEntry({ id: 'u-1', label: 'Head Edit', inverseAction: conflictCapableGainInverse });
        mocks.undoStoreValue.value = { past: [keptRow, middleRow, headRow], future: [] };

        await expect(undoToIndex(0)).resolves.toBeUndefined();

        // The sweep walked two rows down by undoing each head in turn; only the
        // row it was pointed at to keep remains applied. `future` is newest
        // first: v-1 was undone after u-1, so it heads the future stack.
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(2);
        expect(mocks.undoStoreValue.value.past.map((entry) => entry.id)).toEqual(['a-1']);
        expect(mocks.undoStoreValue.value.future.map((entry) => entry.id)).toEqual(['v-1', 'u-1']);
    });
});
