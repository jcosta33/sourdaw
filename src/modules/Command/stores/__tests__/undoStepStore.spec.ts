import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';

import { AppActionConflictError } from '../../errors/AppActionExecutionError';
import { type ActionUndoEntry, type CallbackUndoEntry } from '../../models/UndoEntry';
import { clearUndoHistory } from '../../useCases/clearUndoHistory';
import { moveHistoryToStep } from '../../useCases/moveHistoryToStep';
import { pushUndoEntry } from '../../useCases/pushUndoEntry';
import { REDO_NOT_APPLIED } from '../../useCases/redoResult';
import { undo } from '../../useCases/undo';
import { clearHandlerRegistry, registerHandlerMap } from '../handlerRegistry';
import { undoStepStore } from '../undoStepStore';
import { undoStore } from '../undoStore';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn<typeof import('../../useCases/executeAppAction').executeAppAction>(),
    notifyUser: vi.fn<(message: string, level?: string) => void>(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

// Only the forward replay is simulated, so a guarded handler's conflict can be
// produced without a project; the stores, undo, redo and the registered
// handlers' capability flags are real.
vi.mock('../../useCases/executeAppAction', () => ({
    executeAppAction: mocks.executeAppAction,
}));

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

    it("names a one-entry step by the entry's own label, not a generic group label", () => {
        const applied: Applied = new Set();
        pushTracked(applied, 'Add midi track MIDI 2', {
            groupId: 'prompt-1',
            groupLabel: 'Prompt action',
            source: 'prompt',
        });

        expect(pastLabels()).toEqual(['Add midi track MIDI 2']);
    });

    it('names a one-entry future step by its own label too', async () => {
        const applied: Applied = new Set();
        pushTracked(applied, 'Add midi track MIDI 2', {
            groupId: 'prompt-1',
            groupLabel: 'Prompt action',
            source: 'prompt',
        });

        await undo();

        expect(futureLabels()).toEqual(['Add midi track MIDI 2']);
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

describe('history moves over a conflicted redo unit', () => {
    beforeEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        mocks.executeAppAction.mockReset();
        mocks.notifyUser.mockReset();
        mocks.executeAppAction.mockImplementation(async (action) => {
            if (action.type === 'setTrackGain') {
                throw new AppActionConflictError('setTrackGain');
            }
        });
    });

    afterEach(() => {
        clearHandlerRegistry();
    });

    function replayEntry(id: string, action: ActionUndoEntry['action']): ActionUndoEntry {
        return { kind: 'action', id, label: id, timestamp: 0, source: 'manual', action, inverseAction: action };
    }

    it('stops at the conflicted target instead of stepping onto the unit behind it', async () => {
        const base = replayEntry('base', { type: 'togglePlayback' });
        const y = replayEntry('Y', {
            type: 'setTrackGain',
            payload: { trackId: 'track-1', gain: 0.5, expectedGain: 0.8 },
        });
        const z = replayEntry('Z', { type: 'setClipColor', payload: { clipId: 'clip-1', color: '#00ff00' } });
        undoStore.set({ past: [base], future: [y, z] });

        await moveHistoryToStep(stepNamed('futureSteps', 'Y').targetEntryId);

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        expect(pastIds()).toEqual(['base']);
        expect(undoStore.value?.future.map((entry) => entry.id)).toEqual(['Y', 'Z']);
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith('Cannot redo "Y": project state has changed', 'warning');
    });
});
