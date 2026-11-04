import { beforeEach, describe, expect, it } from 'vitest';

import { type ActionUndoEntry, type CallbackUndoEntry } from '../../models/UndoEntry';
import { clearUndoHistory } from '../../useCases/clearUndoHistory';
import { moveHistoryToStep } from '../../useCases/moveHistoryToStep';
import { pushUndoEntry } from '../../useCases/pushUndoEntry';
import { REDO_NOT_APPLIED } from '../../useCases/redoResult';
import { undo } from '../../useCases/undo';
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

/** An entry with no inverse: undo drops it without running anything. */
function inertEntry(id: string): ActionUndoEntry {
    return {
        kind: 'action',
        id,
        label: id,
        timestamp: 0,
        source: 'manual',
        action: { type: 'togglePlayback' },
        inverseAction: null,
    };
}

/** A callback entry whose redo toggles `id` back into `applied`. */
function trackedEntry(applied: Applied, id: string): CallbackUndoEntry {
    return {
        kind: 'callback',
        id,
        label: id,
        timestamp: 0,
        source: 'manual',
        undo: () => applied.delete(id),
        redo: () => applied.add(id),
    };
}

function pastLabels(): string[] {
    return undoStepStore.value?.pastSteps.map((step) => step.label) ?? [];
}

function futureLabels(): string[] {
    return undoStepStore.value?.futureSteps.map((step) => step.label) ?? [];
}

function pastIds(): string[] {
    return undoStore.value?.past.map((entry) => entry.id) ?? [];
}

function stepNamed(steps: 'pastSteps' | 'futureSteps', label: string) {
    const step = undoStepStore.value?.[steps].find((candidate) => candidate.label === label);
    if (!step) {
        throw new Error(`expected a ${steps} row named ${label}`);
    }
    return step;
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
        expect(undoStepStore.value?.pastSteps[0]?.key).toBe(undoStore.value?.past[2]?.id);
        expect(undoStepStore.value?.pastSteps[0]?.targetEntryId).toBe(undoStore.value?.past[2]?.id);
    });

    it('names a grouped step by its group label, as undo and redo do', () => {
        const applied: Applied = new Set();
        pushTracked(applied, 'move note', { groupId: 'g', groupLabel: 'Quantize', source: 'prompt' });
        pushTracked(applied, 'move note', { groupId: 'g', groupLabel: 'Quantize', source: 'prompt' });

        const newestId = undoStore.value?.past[1]?.id;
        expect(undoStepStore.value?.pastSteps).toEqual([
            { key: newestId, label: 'Quantize', source: 'prompt', targetEntryId: newestId },
        ]);
    });

    it('leaves a fully inert unit out of the past steps, as one undo reverts past it', async () => {
        const applied: Applied = new Set();
        undoStore.set({ past: [trackedEntry(applied, 'Move clip'), inertEntry('Cut clip')], future: [] });
        applied.add('Move clip');

        expect(pastLabels()).toEqual(['Move clip']);

        await undo();

        expect(applied.has('Move clip')).toBe(false);
        expect(undoStepStore.value?.pastSteps).toEqual([]);
    });

    it('keeps the clicked past step applied when the move targets it', async () => {
        const applied: Applied = new Set();
        pushTracked(applied, 'first');
        pushTracked(applied, 'group a', { groupId: 'g' });
        pushTracked(applied, 'group b', { groupId: 'g' });
        pushTracked(applied, 'group c', { groupId: 'g' });
        pushTracked(applied, 'last');

        await moveHistoryToStep(stepNamed('pastSteps', 'group c').targetEntryId);

        expect(pastLabels()).toEqual(['first', 'group c']);
        expect([...applied]).toEqual(['first', 'group a', 'group b', 'group c']);
        expect(futureLabels()).toEqual(['last']);
    });

    it('stops at the clicked past step when an inert entry sits directly above it', async () => {
        const applied = new Set(['first', 'last']);
        undoStore.set({
            past: [trackedEntry(applied, 'first'), inertEntry('dead'), trackedEntry(applied, 'last')],
            future: [],
        });
        expect(pastLabels()).toEqual(['first', 'last']);

        await moveHistoryToStep(stepNamed('pastSteps', 'first').targetEntryId);

        expect(pastIds()).toEqual(['first']);
        expect([...applied]).toEqual(['first']);
    });

    it('redoes through the clicked future step and no further', async () => {
        const applied: Applied = new Set();
        pushTracked(applied, 'first');
        pushTracked(applied, 'group a', { groupId: 'g' });
        pushTracked(applied, 'group b', { groupId: 'g' });
        pushTracked(applied, 'last');
        await moveHistoryToStep(stepNamed('pastSteps', 'first').targetEntryId);
        expect(futureLabels()).toEqual(['group a', 'last']);

        await moveHistoryToStep(stepNamed('futureSteps', 'group a').targetEntryId);

        expect(pastLabels()).toEqual(['first', 'group b']);
        expect(applied.has('group a') && applied.has('group b')).toBe(true);
        expect(applied.has('last')).toBe(false);
        expect(futureLabels()).toEqual(['last']);
    });

    it('stops at the clicked future step when redo drops a not-applied entry on the way', async () => {
        const applied = new Set(['base']);
        const notApplied: CallbackUndoEntry = {
            ...trackedEntry(applied, 'X'),
            redo: () => REDO_NOT_APPLIED,
        };
        undoStore.set({
            past: [trackedEntry(applied, 'base')],
            future: [notApplied, trackedEntry(applied, 'Y'), trackedEntry(applied, 'Z')],
        });

        await moveHistoryToStep(stepNamed('futureSteps', 'Y').targetEntryId);

        expect(pastIds()).toEqual(['base', 'Y']);
        expect(applied.has('Z')).toBe(false);
        expect(futureLabels()).toEqual(['Z']);
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
