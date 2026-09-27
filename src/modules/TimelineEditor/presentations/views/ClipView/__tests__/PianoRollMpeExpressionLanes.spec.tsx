/**
 * The expression-lane selector offers MPE per-note expression lanes as
 * per-track truth (issue #4679). PianoRoll reads the edited track's device
 * types and passes `getMpeExpressionLanesForDeviceTypes` through the
 * toolbar's documented `mpeExpressionLanes` contract (audit MD-2), so on a
 * Fermenter track the selector lists Velocity plus Pressure, Slide and
 * Pitch Bend, while a track whose instrument sounds none of them lists
 * Velocity alone.
 *
 * This file renders the real PianoRollToolbar (unlike PianoRoll.spec.tsx,
 * which stubs it) so the assertion covers the whole chain — trackStore
 * devices, PianoRoll's derivation, and the rendered selector options —
 * not just the props handed across the boundary.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PianoRoll } from '../PianoRoll';

type ProbeClip = { id: string; type: 'midi'; startBeat: number; endBeat: number };
type ProbeDevice = { type: string };
type ProbeTrack = {
    id: string;
    kind: 'midi';
    color: string;
    clips: ProbeClip[];
    devices: ProbeDevice[];
};

const { midiState, trackState } = vi.hoisted(() => ({
    midiState: {
        notesByClipId: {},
        ccByClipId: {},
        pitchBendByClipId: {},
    },
    trackState: {
        tracks: [] as ProbeTrack[],
        selectedTrackId: null as string | null,
    },
}));

vi.mock('#/utils/Styles/cn', () => ({
    cn: (...inputs: (string | undefined | null | false | Record<string, boolean>)[]) => {
        const classes: string[] = [];
        for (const input of inputs) {
            if (typeof input === 'string') {
                classes.push(input);
            } else if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
                for (const [key, value] of Object.entries(input)) {
                    if (value) {
                        classes.push(key);
                    }
                }
            }
        }
        return classes.join(' ');
    },
}));

vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    midiStore: {
        get value() {
            return midiState;
        },
        getSnapshot: () => midiState,
        subscribe: vi.fn(() => () => {}),
        subscribeReact: vi.fn(() => () => {}),
    },
}));

// The selector's MPE lanes follow the edited track's own instrument, so the
// spec drives the device types the way AutomationLane.spec.tsx does.
vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return trackState;
        },
        getSnapshot: () => trackState,
        subscribe: vi.fn(() => () => {}),
        subscribeReact: vi.fn(() => () => {}),
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

vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    setProjectKeyRoot: vi.fn(),
    setProjectScaleName: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
    pushUndoEntry: vi.fn(),
}));

vi.mock('../../../hooks/usePianoRollRenderer', () => ({
    usePianoRollRenderer: vi.fn(() => vi.fn()),
}));

vi.mock('../../../hooks/usePianoRollInteractions', () => ({
    usePianoRollInteractions: vi.fn(() => ({
        handleMouseDown: vi.fn(),
        handleMouseMove: vi.fn(),
        handleMouseUp: vi.fn(),
        handleDoubleClick: vi.fn(),
        handleKeyDown: vi.fn(),
        handleContextMenu: vi.fn(),
        ctxMenu: null,
        setCtxMenu: vi.fn(),
        hoverCursor: 'crosshair',
    })),
}));

vi.mock('../PianoRollContextMenu', () => ({
    PianoRollContextMenu: () => <div data-testid="context-menu" />,
}));

vi.mock('../../AutomationLane/NotePropertyLane', () => ({
    NotePropertyLane: () => <div data-testid="note-property-lane" />,
}));

// Whole-module mock: the same fake constants PianoRoll.spec.tsx uses for the
// roll's own geometry, plus the toolbar's scale tables (this file renders the
// real toolbar, which PianoRoll.spec.tsx stubs out and therefore never needed).
vi.mock('../../../helpers/pianoRollConstants', () => ({
    NOTE_NAMES: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
    GRID_BEATS: 256,
    ROW_HEIGHT: 24,
    RULER_HEIGHT: 28,
    PITCH_RAIL_WIDTH: 40,
    EMPTY_NOTES: [],
    SCALES: {
        chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        major: [0, 2, 4, 5, 7, 9, 11],
        minor: [0, 2, 3, 5, 7, 8, 10],
    },
    SCALE_ROOT_LABELS: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
    getVisiblePitches: vi.fn(() => [60, 61, 62, 63, 64]),
    getPianoRollExtentBeats: vi.fn(() => 256),
}));

vi.mock('#/components/daw/DawGridHeaderCell', () => ({
    DawGridHeaderCell: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('#/components/daw/DawSideRail', () => ({
    DawSideRail: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// The real toolbar's leaf controls, stubbed to native elements so jsdom can
// render them — the same substitution PianoRollToolbar.spec.tsx uses.
vi.mock('#/components/daw/DawCompactSelect', () => ({
    DawCompactSelect: ({
        value,
        onChange,
        children,
        size,
        'aria-label': ariaLabel,
    }: {
        value: string | number;
        onChange: (e: { target: { value: string } }) => void;
        children: React.ReactNode;
        size: string;
        'aria-label'?: string;
    }) => (
        <select value={value} onChange={onChange} data-size={size} aria-label={ariaLabel}>
            {children}
        </select>
    ),
}));

vi.mock('#/components/daw/DawControlStrip', () => ({
    DawControlStrip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        onClick,
        variant,
        size,
        className,
        'aria-pressed': ariaPressed,
        'aria-label': ariaLabel,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        variant?: string;
        size?: string;
        className?: string;
        'aria-pressed'?: boolean;
        'aria-label'?: string;
    }) => (
        <button
            type="button"
            onClick={onClick}
            className={className}
            data-variant={variant}
            data-size={size}
            aria-pressed={ariaPressed}
            aria-label={ariaLabel}
        >
            {children}
        </button>
    ),
}));

vi.mock('#/components/ui/slider', () => ({
    Slider: ({
        value,
        onValueChange,
        min,
        max,
        step,
        className,
        'aria-label': ariaLabel,
    }: {
        value: number[];
        onValueChange: (v: number[]) => void;
        min: number;
        max: number;
        step: number;
        className?: string;
        'aria-label'?: string;
    }) => (
        <input
            type="range"
            value={value[0]}
            min={min}
            max={max}
            step={step}
            className={className}
            aria-label={ariaLabel}
            onChange={(event) => onValueChange([Number(event.target.value)])}
        />
    ),
}));

describe('PianoRoll MPE expression-lane selector (#4679)', () => {
    const defaultProps = {
        clipId: 'clip-1',
        trackId: 'track-1',
        selectedNoteIds: new Set<string>(),
        onSelectedNoteIdsChange: vi.fn(),
    };

    function renderWithExpressionViewOn(): void {
        render(<PianoRoll {...defaultProps} />);
        // The Button stub drops data-testid, so reach the toggle by its label.
        fireEvent.click(screen.getByLabelText('Toggle Expression View (I4)'));
    }

    function selectorOptionValues(): string[] {
        const selector = screen.getByLabelText('Active expression lane');
        return within(selector)
            .getAllByRole('option')
            .map((option) => (option as HTMLOptionElement).value);
    }

    beforeEach(() => {
        vi.clearAllMocks();
        midiState.notesByClipId = {};
        trackState.tracks = [];
        trackState.selectedTrackId = null;
    });

    it('offers Velocity plus Pressure, Slide and Pitch Bend on a Fermenter track', () => {
        trackState.tracks = [
            {
                id: 'track-1',
                kind: 'midi',
                color: 'oklch(0.5 0.1 200)',
                clips: [{ id: 'clip-1', type: 'midi', startBeat: 0, endBeat: 64 }],
                devices: [{ type: 'fermenter' }],
            },
        ];
        renderWithExpressionViewOn();

        const values = selectorOptionValues();
        expect(values).toContain('velocity');
        expect(values).toContain('pressure');
        expect(values).toContain('slide');
        expect(values).toContain('pitchBend');
    });

    it('offers Velocity only on a track whose instrument sounds no MPE dimension', () => {
        trackState.tracks = [
            {
                id: 'track-1',
                kind: 'midi',
                color: 'oklch(0.5 0.1 200)',
                clips: [{ id: 'clip-1', type: 'midi', startBeat: 0, endBeat: 64 }],
                devices: [{ type: 'toaster' }],
            },
        ];
        renderWithExpressionViewOn();

        const values = selectorOptionValues();
        expect(values).toContain('velocity');
        expect(values).not.toContain('pressure');
        expect(values).not.toContain('slide');
        expect(values).not.toContain('pitchBend');
    });
});
