import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { pushUndoEntry } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';

import { type MidiCC, type MidiPitchBend } from '../../../../models/MidiNoteViewTypes';
import { CCLane } from '../CCLane';
import { PitchBendLane } from '../PitchBendLane';

vi.mock('#/components/daw/DawBlockedState', () => ({
    DawBlockedState: ({ title }: { title: string }) => (
        <div data-testid="blocked-state">
            <span>{title}</span>
        </div>
    ),
}));

vi.mock('#/modules/Command/useCases', () => ({
    getExecutableAppActionEffect: vi.fn(() => null),
    executeUserAppAction: vi.fn(),
    executeAppAction: vi.fn(),
    pushUndoEntry: vi.fn(),
}));

// Mirrors the lanes' private coordinate math so click targets are derived, never
// hand-computed magic numbers.
const beatFromX = (x: number, beatWidth: number): number => Math.max(0, (x - 8) / beatWidth);
const valueFromY = (y: number, height: number): number =>
    Math.round(Math.max(0, Math.min(127, ((height - y - 4) / (height - 8)) * 127)));

// Click target: x 48 → beat 1, y 40 → value 64. Drag target: x 88 → beat 2, y 20 → value 99.
const CLICK = { clientX: 48, clientY: 40 };
const DRAGGED = { clientX: 88, clientY: 20 };
const clickBeat = beatFromX(CLICK.clientX, 40);
const clickValue = valueFromY(CLICK.clientY, 80);
const draggedBeat = beatFromX(DRAGGED.clientX, 40);
const draggedValue = valueFromY(DRAGGED.clientY, 80);

const storedCCs = (): MidiCC[] => midiStore.value?.ccByClipId['clip-1'] ?? [];
const storedPBs = (): MidiPitchBend[] => midiStore.value?.pitchBendByClipId['clip-1'] ?? [];

/** The callbacks of the entry pushed at `index`, wrapped for store-driven rerenders. */
const entryAt = (index: number): { undo: () => void; redo: () => void } => {
    const call = vi.mocked(pushUndoEntry).mock.calls[index];
    const undoFn = call?.[1];
    const redoFn = call?.[2];
    if (!undoFn || !redoFn) {
        throw new Error(`Expected a pushed undo entry at ${index}`);
    }
    return {
        undo: () => {
            act(() => {
                undoFn();
            });
        },
        redo: () => {
            act(() => {
                redoFn();
            });
        },
    };
};

const lastEntry = (): { undo: () => void; redo: () => void } => entryAt(vi.mocked(pushUndoEntry).mock.calls.length - 1);

describe('lane undo round-trips (#4795)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 80));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('CCLane', () => {
        const renderLane = (): void => {
            render(<CCLane clipId="clip-1" controller={1} beatWidth={40} contentWidth={800} />);
        };

        it('add: undo -> redo -> undo -> redo restores the same point identity', () => {
            renderLane();
            fireEvent.click(screen.getByRole('group'), CLICK);

            const addedId = storedCCs()[0]?.id;
            expect(storedCCs()).toEqual([
                { id: addedId, controller: 1, value: clickValue, beat: clickBeat, channel: 0 },
            ]);
            const entry = lastEntry();

            entry.undo();
            expect(storedCCs()).toEqual([]);

            entry.redo();
            expect(storedCCs()).toEqual([
                { id: addedId, controller: 1, value: clickValue, beat: clickBeat, channel: 0 },
            ]);

            entry.undo();
            expect(storedCCs()).toEqual([]);

            entry.redo();
            expect(storedCCs()).toEqual([
                { id: addedId, controller: 1, value: clickValue, beat: clickBeat, channel: 0 },
            ]);
        });

        it('remove: undo re-creates the removed point under its own id, and redo still removes it', () => {
            midiStore.set({
                notesByClipId: {},
                ccByClipId: { 'clip-1': [{ id: 'cc-a', controller: 1, value: 40, beat: 2, channel: 1 }] },
                pitchBendByClipId: {},
            });
            renderLane();
            const point = document.querySelector('[data-cc-point="true"]');
            expect(point).not.toBeNull();

            fireEvent.doubleClick(point!);
            expect(storedCCs()).toEqual([]);
            const entry = lastEntry();

            entry.undo();
            expect(storedCCs()).toEqual([{ id: 'cc-a', controller: 1, value: 40, beat: 2, channel: 1 }]);

            entry.redo();
            expect(storedCCs()).toEqual([]);

            entry.undo();
            expect(storedCCs()).toEqual([{ id: 'cc-a', controller: 1, value: 40, beat: 2, channel: 1 }]);

            entry.redo();
            expect(storedCCs()).toEqual([]);
        });

        it('move: undo -> redo -> undo -> redo keeps addressing the same point', () => {
            midiStore.set({
                notesByClipId: {},
                ccByClipId: { 'clip-1': [{ id: 'cc-a', controller: 1, value: 20, beat: 0, channel: 0 }] },
                pitchBendByClipId: {},
            });
            renderLane();
            const point = document.querySelector('[data-cc-point="true"]');
            expect(point).not.toBeNull();

            fireEvent.pointerDown(point!, { pointerId: 2, button: 0, clientX: 8, clientY: 76 });
            fireEvent.pointerMove(point!, { pointerId: 2, clientX: DRAGGED.clientX, clientY: DRAGGED.clientY });
            fireEvent.pointerUp(point!, { pointerId: 2, clientX: DRAGGED.clientX, clientY: DRAGGED.clientY });

            expect(storedCCs()).toEqual([
                { id: 'cc-a', controller: 1, value: draggedValue, beat: draggedBeat, channel: 0 },
            ]);
            const entry = lastEntry();

            entry.undo();
            expect(storedCCs()).toEqual([{ id: 'cc-a', controller: 1, value: 20, beat: 0, channel: 0 }]);

            entry.redo();
            expect(storedCCs()).toEqual([
                { id: 'cc-a', controller: 1, value: draggedValue, beat: draggedBeat, channel: 0 },
            ]);

            entry.undo();
            expect(storedCCs()).toEqual([{ id: 'cc-a', controller: 1, value: 20, beat: 0, channel: 0 }]);

            entry.redo();
            expect(storedCCs()).toEqual([
                { id: 'cc-a', controller: 1, value: draggedValue, beat: draggedBeat, channel: 0 },
            ]);
        });

        it('a move recorded before a remove still applies after the remove undoes and redoes', () => {
            renderLane();
            fireEvent.click(screen.getByRole('group'), CLICK);
            const addedId = storedCCs()[0]?.id;

            // Move the freshly added point, then double-click it away. Three
            // entries now stand: Add, Move, Remove.
            const handle = document.querySelector('[data-cc-point="true"]');
            expect(handle).not.toBeNull();
            fireEvent.pointerDown(handle!, { pointerId: 2, button: 0, clientX: CLICK.clientX, clientY: CLICK.clientY });
            fireEvent.pointerMove(handle!, { pointerId: 2, clientX: DRAGGED.clientX, clientY: DRAGGED.clientY });
            fireEvent.pointerUp(handle!, { pointerId: 2, clientX: DRAGGED.clientX, clientY: DRAGGED.clientY });
            expect(storedCCs()).toEqual([
                { id: addedId, controller: 1, value: draggedValue, beat: draggedBeat, channel: 0 },
            ]);

            fireEvent.doubleClick(handle!);
            expect(storedCCs()).toEqual([]);
            expect(vi.mocked(pushUndoEntry).mock.calls).toHaveLength(3);

            // Undoing all three must walk back through Remove, Move, Add — the
            // Move still names the restored point's id, so it applies.
            const removeEntry = entryAt(2);
            const moveEntry = entryAt(1);
            const addEntry = entryAt(0);

            removeEntry.undo();
            expect(storedCCs()).toEqual([
                { id: addedId, controller: 1, value: draggedValue, beat: draggedBeat, channel: 0 },
            ]);

            moveEntry.undo();
            expect(storedCCs()).toEqual([
                { id: addedId, controller: 1, value: clickValue, beat: clickBeat, channel: 0 },
            ]);

            addEntry.undo();
            expect(storedCCs()).toEqual([]);

            addEntry.redo();
            expect(storedCCs()).toEqual([
                { id: addedId, controller: 1, value: clickValue, beat: clickBeat, channel: 0 },
            ]);

            moveEntry.redo();
            expect(storedCCs()).toEqual([
                { id: addedId, controller: 1, value: draggedValue, beat: draggedBeat, channel: 0 },
            ]);

            removeEntry.redo();
            expect(storedCCs()).toEqual([]);
        });
    });

    describe('PitchBendLane', () => {
        const renderLane = (): void => {
            render(<PitchBendLane clipId="clip-1" beatWidth={40} contentWidth={800} />);
        };

        it('add: undo -> redo -> undo -> redo restores the same point identity', () => {
            renderLane();
            fireEvent.click(screen.getByRole('group'), CLICK);

            const addedId = storedPBs()[0]?.id;
            expect(storedPBs()).toEqual([{ id: addedId, value: clickValue, beat: clickBeat, channel: 0 }]);
            const entry = lastEntry();

            entry.undo();
            expect(storedPBs()).toEqual([]);

            entry.redo();
            expect(storedPBs()).toEqual([{ id: addedId, value: clickValue, beat: clickBeat, channel: 0 }]);

            entry.undo();
            expect(storedPBs()).toEqual([]);

            entry.redo();
            expect(storedPBs()).toEqual([{ id: addedId, value: clickValue, beat: clickBeat, channel: 0 }]);
        });

        it('remove: undo re-creates the removed point under its own id, and redo still removes it', () => {
            midiStore.set({
                notesByClipId: {},
                ccByClipId: {},
                pitchBendByClipId: { 'clip-1': [{ id: 'pb-a', value: 40, beat: 2, channel: 1 }] },
            });
            renderLane();
            const point = document.querySelector('[data-pb-point="true"]');
            expect(point).not.toBeNull();

            fireEvent.doubleClick(point!);
            expect(storedPBs()).toEqual([]);
            const entry = lastEntry();

            entry.undo();
            expect(storedPBs()).toEqual([{ id: 'pb-a', value: 40, beat: 2, channel: 1 }]);

            entry.redo();
            expect(storedPBs()).toEqual([]);

            entry.undo();
            expect(storedPBs()).toEqual([{ id: 'pb-a', value: 40, beat: 2, channel: 1 }]);

            entry.redo();
            expect(storedPBs()).toEqual([]);
        });

        it('move: undo -> redo -> undo -> redo keeps addressing the same point', () => {
            midiStore.set({
                notesByClipId: {},
                ccByClipId: {},
                pitchBendByClipId: { 'clip-1': [{ id: 'pb-a', value: 20, beat: 0, channel: 0 }] },
            });
            renderLane();
            const point = document.querySelector('[data-pb-point="true"]');
            expect(point).not.toBeNull();

            fireEvent.pointerDown(point!, { pointerId: 2, button: 0, clientX: 8, clientY: 76 });
            fireEvent.pointerMove(point!, { pointerId: 2, clientX: DRAGGED.clientX, clientY: DRAGGED.clientY });
            fireEvent.pointerUp(point!, { pointerId: 2, clientX: DRAGGED.clientX, clientY: DRAGGED.clientY });

            expect(storedPBs()).toEqual([{ id: 'pb-a', value: draggedValue, beat: draggedBeat, channel: 0 }]);
            const entry = lastEntry();

            entry.undo();
            expect(storedPBs()).toEqual([{ id: 'pb-a', value: 20, beat: 0, channel: 0 }]);

            entry.redo();
            expect(storedPBs()).toEqual([{ id: 'pb-a', value: draggedValue, beat: draggedBeat, channel: 0 }]);

            entry.undo();
            expect(storedPBs()).toEqual([{ id: 'pb-a', value: 20, beat: 0, channel: 0 }]);

            entry.redo();
            expect(storedPBs()).toEqual([{ id: 'pb-a', value: draggedValue, beat: draggedBeat, channel: 0 }]);
        });
    });
});
