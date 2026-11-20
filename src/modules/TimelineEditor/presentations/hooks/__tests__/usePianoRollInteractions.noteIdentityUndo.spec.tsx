import { type ReactElement, useRef, useState } from 'react';

import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useStore } from '#/infra/store/useStore';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, redo, undo } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { getNotesForClip } from '#/modules/MIDI/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences } from '#/modules/Preferences/useCases';
import { playheadPositionRef } from '#/modules/Transport/stores';

import { ROW_HEIGHT } from '../../helpers/pianoRollConstants';
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

const gestureClock = vi.hoisted(() => ({ captureGestureBeat: vi.fn(() => 0) }));

// The split stamps its beat with the gesture clock; the rest of the barrel stays real.
vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    captureGestureBeat: gestureClock.captureGestureBeat,
}));

// Only the audition seam is stubbed; the rest of the barrel stays real because
// the real MIDI use-case graph imports names from it (WebMIDI dispatch).
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    playAuditionNote: vi.fn(() => () => undefined),
}));

vi.mock('#/modules/Transport/useCases', () => ({
    getTransportState: vi.fn(() => ({ playheadPosition: 2.5 })),
    // The real Project persistence helpers this spec's graph imports read the
    // Transport barrel too; this spec never loads or saves a project, so the
    // seam names only need to exist (barrel-mock coverage).
    addTempoChange: vi.fn(),
    addTimeSignatureChange: vi.fn(),
    defaultTransportState: {},
    ensureTrackStrips: vi.fn(),
    isTransportIdle: vi.fn(),
    preferencesSeededTransportState: vi.fn(),
    repairRuntimeGraphFromProject: vi.fn(),
    replaceTempoMap: vi.fn(),
    replaceTimeSignatureMap: vi.fn(),
    restoreTimelineMapSnapshot: vi.fn(),
    restoreTransportSnapshot: vi.fn(),
    stopPlayback: vi.fn(),
    countSettledTakes: vi.fn(),
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

const seedStore = (notesByClipId: Record<string, ReturnType<typeof getNotesForClip>>): void => {
    midiStore.set({
        probabilitySeed: 12345,
        notesByClipId,
        ccByClipId: {},
        pitchBendByClipId: {},
    });
};

const changePeerCurve = (clipId: string, value: number): void => {
    const current = midiStore.value!;
    act(() => {
        midiStore.set({
            ...current,
            notesByClipId: {
                ...current.notesByClipId,
                [clipId]: current.notesByClipId[clipId]!.map((note) =>
                    note.id === 'peer' ? { ...note, expression: { pressure: [{ offsetBeats: 0.5, value }] } } : note
                ),
            },
        });
    });
};

type HookArgs = Parameters<typeof usePianoRollInteractions>[0];
type HarnessArgs = Omit<HookArgs, 'canvasRef' | 'notes' | 'openedClipNotes' | 'setSelectedNoteIds'> & {
    openedClipIds?: string[];
};

// ── Geometry (chromatic scale, unfolded) ─────────────────────────────────
// getVisiblePitches yields pitches 127 → 0 top-to-bottom, ROW_HEIGHT = 16,
// RULER_HEIGHT = 22. Fixture beatWidth = 40, gridSnap = 1.
const ROW = 16;
const RULER = 22;
const BEAT_W = 40;

const yForPitch = (pitch: number): number => RULER + (127 - pitch) * ROW + 8;

const toggleNoteSelection = (canvas: HTMLElement, beat: number, pitch: number): void => {
    const pointer = { clientX: beat * BEAT_W, clientY: yForPitch(pitch), shiftKey: true };
    fireEvent.mouseDown(canvas, pointer);
    fireEvent.mouseUp(canvas, pointer);
};

/**
 * The production roll feeds the hook from a live store subscription, so the
 * handlers observe notes created mid-gesture. The harness mirrors that wiring;
 * a static prop list would make the paint gesture's mouse-up snapshot empty.
 */
const Harness = ({ args: { openedClipIds, ...args } }: { args: HarnessArgs }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const midi = useStore(midiStore);
    const [selectedNoteIds, setSelectedNoteIds] = useState(args.selectedNoteIds);
    const notes = midi.notesByClipId[args.clipId] ?? [];
    const openedClipNotes =
        openedClipIds && Object.fromEntries(openedClipIds.map((id) => [id, midi.notesByClipId[id] ?? []]));
    const handlers = usePianoRollInteractions({
        ...args,
        canvasRef,
        notes,
        openedClipNotes,
        selectedNoteIds,
        setSelectedNoteIds,
    });
    return (
        <canvas
            ref={canvasRef}
            aria-label="piano-roll-test-surface"
            data-selected-note-ids={[...selectedNoteIds].sort().join(',')}
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
        rowHeight: ROW_HEIGHT,
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

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('undoes a join without reverting a peer expression edit', async () => {
        const first = { id: 'n1', pitch: 60, startBeat: 2, duration: 1, velocity: 80, pressure: 90 };
        const second = { id: 'n2', pitch: 60, startBeat: 3, duration: 1, velocity: 80, pressure: 20 };
        const peer = {
            id: 'peer',
            pitch: 67,
            startBeat: 5,
            duration: 2,
            velocity: 80,
            expression: { pressure: [{ offsetBeats: 0.5, value: 20 }] },
        };
        seedStore({ 'clip-1': [first, second, peer] });
        const { canvas } = renderRoll({ selectedNoteIds: new Set(['n1', 'n2']) });
        fireEvent.keyDown(canvas, { key: 'j' });
        expect(getNotesForClip('clip-1').find((note) => note.id === 'n1')?.duration).toBe(2);
        changePeerCurve('clip-1', 91);
        await undoSync();
        expect(getNotesForClip('clip-1').find((note) => note.id === 'n2')).toEqual(second);
        expect(getNotesForClip('clip-1').find((note) => note.id === 'peer')?.expression?.pressure?.[0]?.value).toBe(91);
        await redoSync();
        expect(getNotesForClip('clip-1').find((note) => note.id === 'n2')).toBeUndefined();
        expect(getNotesForClip('clip-1').find((note) => note.id === 'peer')?.expression?.pressure?.[0]?.value).toBe(91);
    });

    it('refuses to join a cross-clip selection and joins it once confined to the secondary clip', async () => {
        const primaryFirst = { id: 'n1', pitch: 60, startBeat: 2, duration: 1, velocity: 80 };
        const primarySecond = { ...primaryFirst, id: 'n2', startBeat: 3 };
        const secondaryFirst = { ...primaryFirst, id: 'n3', startBeat: 4, velocity: 65 };
        const secondarySecond = { ...secondaryFirst, id: 'n4', startBeat: 5, velocity: 95 };
        seedStore(
            structuredClone({ 'clip-1': [primaryFirst, primarySecond], 'clip-2': [secondaryFirst, secondarySecond] })
        );
        const { canvas } = renderRoll({ openedClipIds: ['clip-2'] });

        toggleNoteSelection(canvas, 2.5, 60);
        toggleNoteSelection(canvas, 3.5, 60);
        toggleNoteSelection(canvas, 4.5, 60);
        toggleNoteSelection(canvas, 5.5, 60);
        expect(canvas.getAttribute('data-selected-note-ids')).toBe('n1,n2,n3,n4');

        fireEvent.keyDown(canvas, { key: 'j' });
        expect(getNotesForClip('clip-1')).toStrictEqual([primaryFirst, primarySecond]);
        expect(getNotesForClip('clip-2')).toStrictEqual([secondaryFirst, secondarySecond]);
        expect(canvas.getAttribute('data-selected-note-ids')).toBe('n1,n2,n3,n4');
        expect(undoStore.value?.past).toHaveLength(0);

        toggleNoteSelection(canvas, 2.5, 60);
        toggleNoteSelection(canvas, 3.5, 60);
        expect(canvas.getAttribute('data-selected-note-ids')).toBe('n3,n4');

        fireEvent.keyDown(canvas, { key: 'j' });
        expect(getNotesForClip('clip-1')).toStrictEqual([primaryFirst, primarySecond]);
        expect(getNotesForClip('clip-2')).toStrictEqual([{ ...secondaryFirst, duration: 2 }]);
        expect(canvas.getAttribute('data-selected-note-ids')).toBe('');
        expect(undoStore.value?.past).toHaveLength(1);

        await undoSync();
        expect(getNotesForClip('clip-1')).toStrictEqual([primaryFirst, primarySecond]);
        expect(getNotesForClip('clip-2')).toStrictEqual([secondaryFirst, secondarySecond]);
    });

    it('duplicates selected notes by their shared span in each owning clip and replays both copies together', async () => {
        const primary = {
            ...expressiveNote,
            pressure: 72,
            slide: 41,
            expression: { pressure: [{ offsetBeats: 1, value: 83 }] },
        };
        const secondary = {
            ...primary,
            id: 'n2',
            startBeat: 5,
            duration: 1.5,
            pitch: 64,
            velocity: 95,
            expression: { pitchBend: [{ offsetBeats: 0.5, value: -256 }] },
        };
        const unselected = { id: 'peer', startBeat: 1, duration: 12, pitch: 67, velocity: 60 };
        seedStore(structuredClone({ 'clip-1': [primary], 'clip-2': [secondary, unselected] }));
        const { canvas } = renderRoll({ openedClipIds: ['clip-2'] });

        toggleNoteSelection(canvas, 2.5, 60);
        toggleNoteSelection(canvas, 5.5, 64);
        expect(canvas.getAttribute('data-selected-note-ids')).toBe('n1,n2');

        fireEvent.keyDown(canvas, { key: 'd', ctrlKey: true });
        const primaryAfter = structuredClone(getNotesForClip('clip-1'));
        const secondaryAfter = structuredClone(getNotesForClip('clip-2'));
        expect(primaryAfter).toStrictEqual([primary, { ...primary, id: expect.any(String), startBeat: 6.5 }]);
        expect(secondaryAfter).toStrictEqual([
            secondary,
            unselected,
            { ...secondary, id: expect.any(String), startBeat: 9.5 },
        ]);
        const copyIds = [...primaryAfter.slice(1), ...secondaryAfter.slice(2)].map((note) => note.id);
        expect(new Set([primary.id, secondary.id, unselected.id, ...copyIds]).size).toBe(5);
        expect(canvas.getAttribute('data-selected-note-ids')).toBe(copyIds.sort().join(','));
        expect(undoStore.value?.past).toHaveLength(1);

        await undoSync();
        expect(getNotesForClip('clip-1')).toStrictEqual([primary]);
        expect(getNotesForClip('clip-2')).toStrictEqual([secondary, unselected]);

        await redoSync();
        expect(getNotesForClip('clip-1')).toStrictEqual(primaryAfter);
        expect(getNotesForClip('clip-2')).toStrictEqual(secondaryAfter);
    });

    it('undoes a split without reverting a peer expression edit', async () => {
        const peer = {
            id: 'peer',
            pitch: 67,
            startBeat: 5,
            duration: 2,
            velocity: 80,
            expression: { pressure: [{ offsetBeats: 0.5, value: 20 }] },
        };
        seedStore({
            'clip-1': [{ ...expressiveNote, expression: { pressure: [{ offsetBeats: 1, value: 90 }] } }, peer],
        });
        const track = createTrack({ id: 'track-1', name: 'MIDI', kind: 'midi' });
        track.clips.push({
            id: 'clip-1',
            trackId: 'track-1',
            name: 'Clip',
            startBeat: 0,
            endBeat: 8,
            type: 'midi',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#fff',
            locked: false,
            muted: false,
        });
        trackStore.set({ tracks: [track], selectedTrackId: 'track-1' });
        // The split reads the gesture clock, not the latest-value channel.
        playheadPositionRef.current = 6;
        gestureClock.captureGestureBeat.mockReturnValue(2.5);
        const { canvas } = renderRoll({ selectedNoteIds: new Set(['n1']) });
        fireEvent.keyDown(canvas, { key: 'S', shiftKey: true });
        expect(getNotesForClip('clip-1').filter((note) => note.pitch === 60)).toHaveLength(2);
        changePeerCurve('clip-1', 91);
        await undoSync();
        expect(getNotesForClip('clip-1').filter((note) => note.pitch === 60)).toHaveLength(1);
        expect(getNotesForClip('clip-1').find((note) => note.id === 'peer')?.expression?.pressure?.[0]?.value).toBe(91);
        await redoSync();
        expect(getNotesForClip('clip-1').filter((note) => note.pitch === 60)).toHaveLength(2);
        expect(getNotesForClip('clip-1').find((note) => note.id === 'peer')?.expression?.pressure?.[0]?.value).toBe(91);
    });

    describe('keyboard delete', () => {
        it('keeps another clip’s peer curve when undoing a selected multi-clip delete', async () => {
            const secondary = { ...expressiveNote, id: 'n2', pitch: 65 };
            const peer = {
                ...expressiveNote,
                id: 'peer',
                pitch: 67,
                expression: { pressure: [{ offsetBeats: 0.5, value: 20 }] },
            };
            seedStore({ 'clip-1': [expressiveNote], 'clip-2': [secondary, peer] });
            const { canvas } = renderRoll({
                selectedNoteIds: new Set(['n1', 'n2']),
                openedClipIds: ['clip-2'],
            });
            fireEvent.keyDown(canvas, { key: 'Backspace' });
            changePeerCurve('clip-2', 91);
            await undoSync();
            expect(getNotesForClip('clip-1')).toEqual([expressiveNote]);
            expect(getNotesForClip('clip-2').find((note) => note.id === 'peer')?.expression?.pressure?.[0]?.value).toBe(
                91
            );
            await redoSync();
            expect(getNotesForClip('clip-2').map((note) => note.id)).toEqual(['peer']);
        });
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
                openedClipIds: ['clip-2'],
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
        it('restores the clicked note while preserving a peer curve edited afterward', async () => {
            const peer = {
                ...expressiveNote,
                id: 'peer',
                pitch: 67,
                expression: { pressure: [{ offsetBeats: 0.5, value: 20 }] },
            };
            seedStore({ 'clip-1': [expressiveNote, peer] });
            const { canvas } = renderRoll();
            fireEvent.doubleClick(canvas, { clientX: 100, clientY: yForPitch(60) });
            changePeerCurve('clip-1', 91);
            await undoSync();
            expect(getNotesForClip('clip-1').find((note) => note.id === 'n1')).toEqual(expressiveNote);
            expect(getNotesForClip('clip-1').find((note) => note.id === 'peer')?.expression?.pressure?.[0]?.value).toBe(
                91
            );
        });
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
        it.each(['clip-1', 'clip-2'])(
            'moves and resizes a short expressive note in %s through undo and redo',
            async (owner) => {
                const note = { ...expressiveNote, duration: 0.375 };
                const peer = { ...expressiveNote, id: 'peer', pitch: 65, startBeat: 4 };
                seedStore({
                    'clip-1': owner === 'clip-1' ? [note, peer] : [peer],
                    'clip-2': owner === 'clip-2' ? [note] : [],
                });
                const { canvas } = renderRoll({ gridSnap: 0.25, openedClipIds: ['clip-2'] });
                const expectOwners = (edited: typeof note): void => {
                    expect(getNotesForClip('clip-1')).toEqual(owner === 'clip-1' ? [edited, peer] : [peer]);
                    expect(getNotesForClip('clip-2')).toEqual(owner === 'clip-2' ? [edited] : []);
                };
                const gestures = [
                    { x: 87, dx: 10, dy: -16, edited: { ...note, startBeat: 2.25, pitch: 61 } },
                    { x: 81.5, dx: -10, dy: 0, edited: { ...note, startBeat: 1.75, duration: 0.625 } },
                    { x: 93.5, dx: 10, dy: 0, edited: { ...note, duration: 0.625 } },
                ];
                for (const { x, dx, dy, edited } of gestures) {
                    fireEvent.mouseDown(canvas, { clientX: x, clientY: yForPitch(60) });
                    fireEvent.mouseMove(canvas, { clientX: x + dx, clientY: yForPitch(60) + dy });
                    fireEvent.mouseUp(canvas, { clientX: x + dx, clientY: yForPitch(60) + dy });
                    expectOwners(edited);
                    await undoSync();
                    expectOwners(note);
                    await redoSync();
                    expectOwners(edited);
                    await undoSync();
                }
            }
        );

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
