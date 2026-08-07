/**
 * PianoRoll's `openedClipNotes` selector rebuilds its record on every midiStore
 * notification, so `useStoreSelector` needs an equality predicate to decide
 * whether the rebuild carried a real change. These tests pin what that
 * predicate must and must not treat as a change, observed where it matters:
 * the value `usePianoRollInteractions` receives.
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

const { midiSnapshotRef, midiListeners, capturedOpenedClipNotes } = vi.hoisted(() => ({
    midiSnapshotRef: { current: null as ProbeMidiState | null },
    midiListeners: new Set<() => void>(),
    capturedOpenedClipNotes: [] as (Record<string, ProbeNote[]> | undefined)[],
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
    usePianoRollInteractions: vi.fn((args: { openedClipNotes?: Record<string, ProbeNote[]> }) => {
        capturedOpenedClipNotes.push(args.openedClipNotes);
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

/** Stable across states so the primary-clip selector never forces a render on its own. */
const PRIMARY_NOTES: ProbeNote[] = [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }];

/**
 * The key order `createMidiNote` and `normalize_midi_note` emit.
 */
const SECONDARY_NOTE_AUTHOR_ORDER: ProbeNote = {
    id: 'n2',
    pitch: 62,
    startBeat: 1,
    duration: 1,
    velocity: 100,
    probability: 100,
};

/**
 * Byte-identical content in the lexicographic key order Automerge materialises
 * a map in, which is what the same note looks like after a project round trip
 * or when it arrives from a collaborator.
 */
const SECONDARY_NOTE_CRDT_ORDER: ProbeNote = {
    duration: 1,
    id: 'n2',
    pitch: 62,
    probability: 100,
    startBeat: 1,
    velocity: 100,
};

function buildState(secondaryNotes: ProbeNote[]): ProbeMidiState {
    return {
        probabilitySeed: 1,
        notesByClipId: { 'clip-1': PRIMARY_NOTES, 'clip-2': secondaryNotes },
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

function renderPianoRoll(): Record<string, ProbeNote[]> | undefined {
    render(
        <PianoRoll
            clipId="clip-1"
            trackId="track-1"
            openedClipIds={['clip-1', 'clip-2']}
            selectedNoteIds={new Set<string>()}
            onSelectedNoteIdsChange={vi.fn()}
        />
    );
    return capturedOpenedClipNotes.at(-1);
}

describe('PianoRoll openedClipNotes equality', () => {
    beforeEach(() => {
        midiListeners.clear();
        capturedOpenedClipNotes.length = 0;
        midiSnapshotRef.current = buildState([SECONDARY_NOTE_AUTHOR_ORDER]);
    });

    it('holds the secondary-clip notes steady when only their key order is rewritten', () => {
        const first = renderPianoRoll();
        expect(first?.['clip-2']?.[0]?.startBeat).toBe(1);

        const before = midiSnapshotRef.current?.notesByClipId['clip-2'];
        publishMidiState(buildState([SECONDARY_NOTE_CRDT_ORDER]));
        const after = midiSnapshotRef.current?.notesByClipId['clip-2'];

        // Precondition: these two states are exactly the pair JSON.stringify disagrees on.
        expect(JSON.stringify(before)).not.toBe(JSON.stringify(after));

        expect(capturedOpenedClipNotes.at(-1)).toBe(first);
    });

    it('publishes a moved note in a secondary clip', () => {
        const first = renderPianoRoll();
        expect(first?.['clip-2']?.[0]?.startBeat).toBe(1);

        publishMidiState(buildState([{ ...SECONDARY_NOTE_AUTHOR_ORDER, startBeat: 3 }]));

        const latest = capturedOpenedClipNotes.at(-1);
        expect(latest).not.toBe(first);
        expect(latest?.['clip-2']?.[0]?.startBeat).toBe(3);
    });

    it('publishes a note added to a secondary clip', () => {
        const first = renderPianoRoll();
        expect(first?.['clip-2']).toHaveLength(1);

        publishMidiState(
            buildState([
                SECONDARY_NOTE_AUTHOR_ORDER,
                { id: 'n3', pitch: 64, startBeat: 2, duration: 1, velocity: 90, probability: 100 },
            ])
        );

        const latest = capturedOpenedClipNotes.at(-1);
        expect(latest?.['clip-2']).toHaveLength(2);
        expect(latest?.['clip-2']?.[1]?.id).toBe('n3');
    });

    it('publishes a change to a note field the local view type does not model', () => {
        const first = renderPianoRoll();
        expect(first?.['clip-2']?.[0]?.channel).toBeUndefined();

        publishMidiState(buildState([{ ...SECONDARY_NOTE_AUTHOR_ORDER, channel: 3 }]));

        const latest = capturedOpenedClipNotes.at(-1);
        expect(latest).not.toBe(first);
        expect(latest?.['clip-2']?.[0]?.channel).toBe(3);
    });
});
