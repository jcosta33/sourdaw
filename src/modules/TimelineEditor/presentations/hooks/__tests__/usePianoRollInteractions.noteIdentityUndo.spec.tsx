import { type ReactElement, useEffect, useRef, useState } from 'react';

import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { clearUndoHistory, redo, undo } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { getNotesForClip } from '#/modules/MIDI/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences } from '#/modules/Preferences/useCases';

import { usePianoRollInteractions } from '../usePianoRollInteractions';

/**
 * Default Velocity preference for every creation spec here, set on the real
 * preferences store in beforeEach. Deliberately not 100 — the value the
 * note-creation paths used to hard-code — so a regression to that constant
 * fails these specs instead of passing silently.
 */
const PREFERRED_DEFAULT_VELOCITY = 87;

// Issue #3664. Every common piano-roll edit used to reconstruct notes through
// `addMidiNote` inside its undo/redo closures: undo restored a stripped
// pitch/start/duration/velocity copy under a FRESH id, and redo removed the
// original id that no longer existed — so cycles accumulated duplicates and
// every optional performance field (probability, pressure, slide, pitch bend,
// bend range, channel, articulation) was silently dropped. These specs drive
// the real handlers against the real MIDI store and the real undo stack, and
// pin that each path restores the exact prior note object.

// Only the audition seam is stubbed; the rest of the barrel stays real because
// the real MIDI use-case graph imports names from it (WebMIDI dispatch).
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    playAuditionNote: vi.fn(() => () => undefined),
}));

vi.mock('#/modules/Transport/useCases', () => ({
    getTransportState: vi.fn(() => ({ playheadPosition: 2.5 })),
}));

/**
 * A note carrying every optional performance field at a non-default value, so
 * any reconstruction from the 4 positional fields fails the equality below.
 */
const expressiveNote = {
    id: 'n1',
    pitch: 60,
    startBeat: 2,
    duration: 2,
    velocity: 80,
    probability: 35,
    pressure: 0.75,
    slide: -0.4,
    pitchBend: 1024,
    pitchBendRangeSemitones: 12,
    channel: 3,
    articulation: 'staccato',
};

const seedStore = (notesByClipId: Record<string, object[]>): void => {
    midiStore.set({
        probabilitySeed: 12345,
        notesByClipId: notesByClipId as never,
        ccByClipId: {},
        pitchBendByClipId: {},
    });
};

type HookArgs = Parameters<typeof usePianoRollInteractions>[0];
type HarnessArgs = Omit<HookArgs, 'canvasRef' | 'notes'>;

// ── Geometry (chromatic scale, unfolded) ─────────────────────────────────
// getVisiblePitches yields pitches 83 → 24 top-to-bottom, ROW_HEIGHT = 16,
// RULER_HEIGHT = 22. Fixture beatWidth = 40, gridSnap = 1.
const ROW = 16;
const RULER = 22;
const BEAT_W = 40;

const yForPitch = (pitch: number): number => RULER + (83 - pitch) * ROW + 8;

/**
 * The production roll feeds the hook from a live store subscription, so the
 * handlers observe notes created mid-gesture. The harness mirrors that wiring;
 * a static prop list would make the paint gesture's mouse-up snapshot empty.
 */
const Harness = ({ args }: { args: HarnessArgs }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [notes, setNotes] = useState(() => getNotesForClip(args.clipId));
    useEffect(
        () =>
            midiStore.subscribe(() => {
                setNotes(getNotesForClip(args.clipId));
            }),
        [args.clipId]
    );
    const handlers = usePianoRollInteractions({ ...args, canvasRef, notes });
    return (
        <canvas
            ref={canvasRef}
            aria-label="piano-roll-test-surface"
            tabIndex={0}
            onMouseDown={handlers.handleMouseDown}
            onMouseMove={handlers.handleMouseMove}
            onMouseUp={handlers.handleMouseUp}
            onDoubleClick={handlers.handleDoubleClick}
            onKeyDown={handlers.handleKeyDown}
        />
    );
};

/**
 * Undo/redo run outside React's event batching, so the store subscription's
 * re-render must be flushed through act() — the next gesture otherwise reads
 * stale props and misses the restored notes.
 */
const undoSync = async (): Promise<void> => {
    await act(async () => {
        await undo();
    });
};

const redoSync = async (): Promise<void> => {
    await act(async () => {
        await redo();
    });
};

const renderRoll = (overrides: Partial<HarnessArgs> = {}): { canvas: HTMLElement } => {
    const args: HarnessArgs = {
        scrollRef: { current: null },
        clipId: 'clip-1',
        trackId: 'track-1',
        beatWidth: BEAT_W,
        gridSnap: 1,
        scaleType: 'chromatic',
        scaleRoot: 0,
        isFolded: false,
        stepInput: false,
        stepBeat: 4,
        setStepBeat: vi.fn(),
        chordMode: false,
        chordType: 'major',
        paintMode: false,
        lassoMode: false,
        selectedNoteIds: new Set<string>(),
        setSelectedNoteIds: vi.fn(),
        setZoom: vi.fn(),
        draw: vi.fn(),
        constrainToScale: false,
        notePreviewEnabled: false,
        drawPreviewRef: { current: null },
        rubberBandRef: { current: null },
        dragPreviewRef: { current: null },
        ...overrides,
    };
    render(<Harness args={args} />);
    return { canvas: screen.getByLabelText('piano-roll-test-surface') };
};

describe('piano-roll edit undo preserves note identity (issue #3664)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearUndoHistory();
        preferencesStore.set({ ...defaultPreferences, defaultVelocity: PREFERRED_DEFAULT_VELOCITY });
        seedStore({ 'clip-1': [expressiveNote] });
    });

    describe('keyboard delete', () => {
        it('restores the exact note with every expression field on undo and removes it again on redo', async () => {
            const { canvas } = renderRoll({ selectedNoteIds: new Set(['n1']) });

            fireEvent.keyDown(canvas, { key: 'Backspace' });
            expect(getNotesForClip('clip-1')).toEqual([]);

            await undoSync();
            expect(getNotesForClip('clip-1')).toEqual([expressiveNote]);

            await redoSync();
            expect(getNotesForClip('clip-1')).toEqual([]);
        });

        it('accumulates no duplicates over repeated edit/undo/redo cycles', async () => {
            const { canvas } = renderRoll({ selectedNoteIds: new Set(['n1']) });

            for (let cycle = 0; cycle < 3; cycle++) {
                fireEvent.keyDown(canvas, { key: 'Backspace' });
                await undoSync();
                expect(getNotesForClip('clip-1')).toEqual([expressiveNote]);
                await redoSync();
                expect(getNotesForClip('clip-1')).toEqual([]);
            }
        });

        it('restores each cross-clip note into its owning clip with its identity intact', async () => {
            const secondary = { ...expressiveNote, id: 'n2', pitch: 65, startBeat: 4, velocity: 95 };
            seedStore({ 'clip-1': [expressiveNote], 'clip-2': [secondary] });
            const { canvas } = renderRoll({
                selectedNoteIds: new Set(['n1', 'n2']),
                openedClipNotes: { 'clip-2': [secondary] },
            });

            fireEvent.keyDown(canvas, { key: 'Backspace' });
            expect(getNotesForClip('clip-1')).toEqual([]);
            expect(getNotesForClip('clip-2')).toEqual([]);

            await undoSync();
            expect(getNotesForClip('clip-1')).toEqual([expressiveNote]);
            expect(getNotesForClip('clip-2')).toEqual([secondary]);
        });
    });

    describe('double-click delete', () => {
        it('restores the exact note object through undo and redo', async () => {
            const { canvas } = renderRoll();

            // n1 body: beats 2–4 at pitch 60 → x 80–160
            fireEvent.doubleClick(canvas, { clientX: 100, clientY: yForPitch(60) });
            expect(getNotesForClip('clip-1')).toEqual([]);

            await undoSync();
            expect(getNotesForClip('clip-1')).toEqual([expressiveNote]);

            await redoSync();
            expect(getNotesForClip('clip-1')).toEqual([]);
        });
    });

    describe('resize handles', () => {
        it('left-edge resize undoes and redoes in place, keeping the id and every expression field', async () => {
            const { canvas } = renderRoll();

            // Left edge of n1 sits at x = 2·40; the 8px edge zone takes the drag.
            fireEvent.mouseDown(canvas, { clientX: 2 * BEAT_W + 4, clientY: yForPitch(60) });
            fireEvent.mouseMove(canvas, { clientX: BEAT_W + 4, clientY: yForPitch(60) });
            fireEvent.mouseUp(canvas, { clientX: BEAT_W + 4, clientY: yForPitch(60) });
            expect(getNotesForClip('clip-1')).toEqual([{ ...expressiveNote, startBeat: 1, duration: 3 }]);

            await undoSync();
            expect(getNotesForClip('clip-1')).toEqual([expressiveNote]);

            await redoSync();
            expect(getNotesForClip('clip-1')).toEqual([{ ...expressiveNote, startBeat: 1, duration: 3 }]);
        });

        it('right-edge resize undoes and redoes in place, keeping the id and every expression field', async () => {
            const { canvas } = renderRoll();

            // Right edge of n1 sits at x = 4·40.
            fireEvent.mouseDown(canvas, { clientX: 4 * BEAT_W - 4, clientY: yForPitch(60) });
            fireEvent.mouseMove(canvas, { clientX: 5 * BEAT_W - 4, clientY: yForPitch(60) });
            fireEvent.mouseUp(canvas, { clientX: 5 * BEAT_W - 4, clientY: yForPitch(60) });
            expect(getNotesForClip('clip-1')).toEqual([{ ...expressiveNote, duration: 3 }]);

            await undoSync();
            expect(getNotesForClip('clip-1')).toEqual([expressiveNote]);

            await redoSync();
            expect(getNotesForClip('clip-1')).toEqual([{ ...expressiveNote, duration: 3 }]);
        });

        it('keeps exactly one note under one id over repeated resize/undo/redo cycles', async () => {
            const { canvas } = renderRoll();

            for (let cycle = 0; cycle < 3; cycle++) {
                // Each cycle starts from the original geometry (the undo at the
                // end of the previous cycle restored it), so the right edge of
                // n1 is always at x = 4·40.
                fireEvent.mouseDown(canvas, { clientX: 4 * BEAT_W - 4, clientY: yForPitch(60) });
                fireEvent.mouseMove(canvas, { clientX: 5 * BEAT_W - 4, clientY: yForPitch(60) });
                fireEvent.mouseUp(canvas, { clientX: 5 * BEAT_W - 4, clientY: yForPitch(60) });
                expect(getNotesForClip('clip-1')).toEqual([{ ...expressiveNote, duration: 3 }]);

                await undoSync();
                expect(getNotesForClip('clip-1')).toEqual([expressiveNote]);
            }
            await redoSync();
            expect(getNotesForClip('clip-1')).toEqual([{ ...expressiveNote, duration: 3 }]);
        });
    });

    describe('creation, draw, and pencil', () => {
        it('step-input creation redo re-inserts the created note under its original id', async () => {
            seedStore({});
            const { canvas } = renderRoll({ stepInput: true, stepBeat: 4 });

            fireEvent.mouseDown(canvas, { clientX: 45, clientY: yForPitch(70) });
            const createdId = getNotesForClip('clip-1')[0]?.id;
            expect(createdId).toBeDefined();

            await undoSync();
            expect(getNotesForClip('clip-1')).toEqual([]);

            await redoSync();
            expect(getNotesForClip('clip-1')).toEqual([
                {
                    id: createdId,
                    pitch: 70,
                    startBeat: 4,
                    duration: 1,
                    velocity: PREFERRED_DEFAULT_VELOCITY,
                    probability: 100,
                },
            ]);
        });

        it('draw-stamp creation redo re-inserts the created note under its original id', async () => {
            seedStore({});
            const { canvas } = renderRoll({});

            // Click without drag on an empty cell stamps a note.
            fireEvent.mouseDown(canvas, { clientX: 45, clientY: yForPitch(70) });
            fireEvent.mouseUp(canvas, { clientX: 45, clientY: yForPitch(70) });
            const createdId = getNotesForClip('clip-1')[0]?.id;
            expect(createdId).toBeDefined();

            await undoSync();
            expect(getNotesForClip('clip-1')).toEqual([]);

            await redoSync();
            expect(getNotesForClip('clip-1')).toEqual([
                {
                    id: createdId,
                    pitch: 70,
                    startBeat: 1,
                    duration: 1,
                    velocity: PREFERRED_DEFAULT_VELOCITY,
                    probability: 100,
                },
            ]);
        });

        it('paint (pencil) redo re-inserts the painted notes under their original ids', async () => {
            seedStore({});
            const { canvas } = renderRoll({ paintMode: true });

            fireEvent.mouseDown(canvas, { clientX: 45, clientY: yForPitch(70) });
            const painted = getNotesForClip('clip-1');
            expect(painted).toHaveLength(1);
            const paintedId = painted[0]?.id;

            fireEvent.mouseUp(canvas, { clientX: 45, clientY: yForPitch(70) });

            await undoSync();
            expect(getNotesForClip('clip-1')).toEqual([]);

            await redoSync();
            expect(getNotesForClip('clip-1')).toEqual([
                {
                    id: paintedId,
                    pitch: 70,
                    startBeat: 1,
                    duration: 1,
                    velocity: PREFERRED_DEFAULT_VELOCITY,
                    probability: 100,
                },
            ]);
        });

        it('accumulates no duplicates over repeated draw/undo/redo cycles', async () => {
            seedStore({});
            const { canvas } = renderRoll({});

            for (let cycle = 0; cycle < 3; cycle++) {
                fireEvent.mouseDown(canvas, { clientX: 45, clientY: yForPitch(70) });
                fireEvent.mouseUp(canvas, { clientX: 45, clientY: yForPitch(70) });
                expect(getNotesForClip('clip-1')).toHaveLength(1);

                await undoSync();
                expect(getNotesForClip('clip-1')).toEqual([]);
                await redoSync();
            }
            expect(getNotesForClip('clip-1')).toHaveLength(1);
        });
    });
});
