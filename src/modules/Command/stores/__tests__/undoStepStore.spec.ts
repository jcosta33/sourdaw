import { beforeEach, describe, expect, it } from 'vitest';

import { clearUndoHistory } from '../../useCases/clearUndoHistory';
import { pushUndoEntry } from '../../useCases/pushUndoEntry';
import { undoToIndex } from '../../useCases/undoToIndex';
import { undoStepStore } from '../undoStepStore';
import { undoStore } from '../undoStore';

type Applied = Set<string>;

/** Pushes one callback entry whose undo/redo toggle `name` in `applied`. */
function pushTracked(
    applied: Applied,
    name: string,
    options?: { groupId: string; groupLabel?: string; source?: 'prompt' }
): void {
    applied.add(name);
    pushUndoEntry(
        name,
        () => applied.delete(name),
        () => applied.add(name),
        options
    );
}

function pastLabels(): string[] {
    return undoStepStore.value?.pastSteps.map((step) => step.label) ?? [];
}

function futureLabels(): string[] {
    return undoStepStore.value?.futureSteps.map((step) => step.label) ?? [];
}

describe('undoStepStore', () => {
    beforeEach(() => {
        clearUndoHistory();
    });

    it('publishes one past step per undo unit, named by its newest entry', () => {
        const applied: Applied = new Set();
        pushTracked(applied, 'drag a', { groupId: 'drag' });
        pushTracked(applied, 'drag b', { groupId: 'drag' });
        pushTracked(applied, 'drag c', { groupId: 'drag' });
        pushTracked(applied, 'rename');

        expect(undoStore.value?.past).toHaveLength(4);
        expect(pastLabels()).toEqual(['drag c', 'rename']);
        expect(undoStepStore.value?.pastSteps.map((step) => step.historyIndex)).toEqual([2, 3]);
        expect(undoStepStore.value?.pastSteps[0]?.key).toBe(undoStore.value?.past[2]?.id);
    });

    it('names a grouped step by its group label, as undo and redo do', () => {
        const applied: Applied = new Set();
        pushTracked(applied, 'move note', { groupId: 'g', groupLabel: 'Quantize', source: 'prompt' });
        pushTracked(applied, 'move note', { groupId: 'g', groupLabel: 'Quantize', source: 'prompt' });

        expect(undoStepStore.value?.pastSteps).toEqual([
            { key: undoStore.value?.past[1]?.id, label: 'Quantize', source: 'prompt', historyIndex: 1 },
        ]);
    });

    it('keeps the clicked past step applied when the sweep targets its historyIndex', async () => {
        const applied: Applied = new Set();
        pushTracked(applied, 'first');
        pushTracked(applied, 'group a', { groupId: 'g' });
        pushTracked(applied, 'group b', { groupId: 'g' });
        pushTracked(applied, 'group c', { groupId: 'g' });
        pushTracked(applied, 'last');

        const target = undoStepStore.value!.pastSteps[1]!;
        expect(target.label).toBe('group c');
        await undoToIndex(target.historyIndex);

        expect(pastLabels()).toEqual(['first', 'group c']);
        expect([...applied]).toEqual(['first', 'group a', 'group b', 'group c']);
        expect(futureLabels()).toEqual(['last']);
    });

    it('redoes through the clicked future step and no further', async () => {
        const applied: Applied = new Set();
        pushTracked(applied, 'first');
        pushTracked(applied, 'group a', { groupId: 'g' });
        pushTracked(applied, 'group b', { groupId: 'g' });
        pushTracked(applied, 'last');
        await undoToIndex(0);
        expect(futureLabels()).toEqual(['group a', 'last']);

        const target = undoStepStore.value!.futureSteps[0]!;
        expect(target.historyIndex).toBe(2);
        await undoToIndex(target.historyIndex);

        expect(pastLabels()).toEqual(['first', 'group b']);
        expect(applied.has('group a') && applied.has('group b')).toBe(true);
        expect(applied.has('last')).toBe(false);
        expect(futureLabels()).toEqual(['last']);
    });

    it('returns frozen snapshots that stay identical until the history changes', () => {
        const applied: Applied = new Set();
        pushTracked(applied, 'one');

        const first = undoStepStore.getSnapshot();
        expect(undoStepStore.getSnapshot()).toBe(first);
        expect(Object.isFrozen(first)).toBe(true);
        expect(Object.isFrozen(first?.pastSteps)).toBe(true);
        expect(Object.isFrozen(first?.pastSteps[0])).toBe(true);

        pushTracked(applied, 'two');
        expect(undoStepStore.getSnapshot()).not.toBe(first);
        expect(pastLabels()).toEqual(['one', 'two']);
    });

    it('does not expose write methods', () => {
        expect(undoStepStore).not.toHaveProperty('set');
        expect(undoStepStore).not.toHaveProperty('update');
    });
});
