/**
 * PianoRoll's primary-clip `notes` selector falls back to `?? []` when the
 * focused clip has no entry in `notesByClipId`. A bare `[]` literal mints a
 * fresh array on every selector invocation, so `useStoreSelector`'s default
 * `Object.is` equality never holds for an empty clip: every unrelated
 * midiStore notification looks like a change and re-renders the piano roll.
 * These tests pin the value `usePianoRollInteractions` receives — the same
 * observation point `PianoRollOpenedClipNotes.spec.tsx` uses for its sibling
 * `openedClipNotes` selector's equality guard (landed via #1299).
 */
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PianoRoll } from '../PianoRoll';

type ProbeNote = Record<string, unknown>;
type ProbeMidiState = {
    probabilitySeed: number;
    notesByClipId: Record<string, ProbeNote[]>;
    ccByClipId: Record<string, unknown[]>;
    pitchBendByClipId: Record<string, unknown[]>;
};

const { midiSnapshotRef, midiListeners, capturedNotes } = vi.hoisted(() => ({
    midiSnapshotRef: { current: null as ProbeMidiState | null },
    midiListeners: new Set<() => void>(),
    capturedNotes: [] as (ProbeNote[] | undefined)[],
}));

vi.mock('#/utils/Styles/cn', () => ({
    cn: (...inputs: unknown[]) => inputs.filter((input) => typeof input === 'string').join(' '),
}));

vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    midiStore: {
        get value() {
            return midiSnapshotRef.current;
        },
        getSnapshot: () => midiSnapshotRef.current,
        subscribe: (listener: () => void) => {
            midiListeners.add(listener);
            return () => {
                midiListeners.delete(listener);
            };
        },
        subscribeReact: (listener: () => void) => {
            midiListeners.add(listener);
            return () => {
                midiListeners.delete(listener);
            };
        },
    },
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(<TData,>(store: { value: TData | null }, fallback?: TData) => fallback ?? store.value),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    setNoteVelocity: vi.fn(),
    setNotePressure: vi.fn(),
    setNoteSlide: vi.fn(),
    setNotePitchBend: vi.fn(),
    setStepRecordBeat: vi.fn(),
    toggleStepRecordingForClip: vi.fn(),
}));

vi.mock('../../../hooks/usePianoRollRenderer', () => ({
    usePianoRollRenderer: vi.fn(() => vi.fn()),
}));

vi.mock('../../../hooks/usePianoRollInteractions', () => ({
    usePianoRollInteractions: vi.fn((args: { notes?: ProbeNote[] }) => {
        capturedNotes.push(args.notes);
        return {
            handleMouseDown: vi.fn(),
            handleMouseMove: vi.fn(),
            handleMouseUp: vi.fn(),
            handleDoubleClick: vi.fn(),
            handleKeyDown: vi.fn(),
            handleContextMenu: vi.fn(),
            ctxMenu: null,
            setCtxMenu: vi.fn(),
            hoverCursor: 'crosshair',
        };
    }),
}));

vi.mock('../PianoRollToolbar', () => ({
    PianoRollToolbar: () => <div data-testid="toolbar" />,
}));

vi.mock('../PianoRollContextMenu', () => ({
    PianoRollContextMenu: () => <div data-testid="context-menu" />,
}));

vi.mock('../../AutomationLane/NotePropertyLane', () => ({
    NotePropertyLane: () => <div data-testid="note-property-lane" />,
}));

vi.mock('#/components/daw/DawGridHeaderCell', () => ({
    DawGridHeaderCell: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('#/components/daw/DawSideRail', () => ({
    DawSideRail: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

/** clip-2 always has notes so its selector is a stable-reference control, unaffected by this bug. */
const OTHER_CLIP_NOTE: ProbeNote = { id: 'other-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 };

function buildState(overrides: { focusedClipNotes?: ProbeNote[]; otherClipNote?: ProbeNote }): ProbeMidiState {
    const notesByClipId: Record<string, ProbeNote[]> = {
        'clip-2': overrides.otherClipNote ? [overrides.otherClipNote] : [OTHER_CLIP_NOTE],
    };
    if (overrides.focusedClipNotes) {
        notesByClipId['clip-1'] = overrides.focusedClipNotes;
    }
    return {
        probabilitySeed: 1,
        notesByClipId,
        ccByClipId: {},
        pitchBendByClipId: {},
    };
}

function publishMidiState(next: ProbeMidiState): void {
    act(() => {
        midiSnapshotRef.current = next;
        for (const listener of [...midiListeners]) {
            listener();
        }
    });
}

function renderPianoRoll(): ProbeNote[] | undefined {
    render(
        <PianoRoll
            clipId="clip-1"
            trackId="track-1"
            selectedNoteIds={new Set<string>()}
            onSelectedNoteIdsChange={vi.fn()}
        />
    );
    return capturedNotes.at(-1);
}

describe('PianoRoll empty focused-clip notes identity', () => {
    beforeEach(() => {
        midiListeners.clear();
        capturedNotes.length = 0;
        // clip-1 (the focused clip) has no entry in notesByClipId at all — an
        // empty, just-created or just-emptied clip.
        midiSnapshotRef.current = buildState({});
    });

    it('holds the focused clip notes selection steady across an unrelated store write', () => {
        const first = renderPianoRoll();
        expect(first).toEqual([]);

        // An unrelated write: a different clip (clip-2) gets a new note.
        // clip-1 is still absent from notesByClipId — the `?? []` fallback
        // fires again on every notification.
        publishMidiState(buildState({ otherClipNote: { ...OTHER_CLIP_NOTE, startBeat: 4 } }));

        expect(capturedNotes.at(-1)).toBe(first);
    });

    it('publishes a new selection when a note is actually added to the focused clip', () => {
        const first = renderPianoRoll();
        expect(first).toEqual([]);

        const addedNote: ProbeNote = { id: 'n1', pitch: 62, startBeat: 0, duration: 1, velocity: 90 };
        publishMidiState(buildState({ focusedClipNotes: [addedNote] }));

        const latest = capturedNotes.at(-1);
        expect(latest).toEqual([addedNote]);
    });
});
