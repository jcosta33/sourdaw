import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PianoRoll } from '../PianoRoll';

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

vi.mock('#/modules/MIDI/stores', async (importOriginal) => {
    const midiState = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };
    return {
        ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
        midiStore: {
            get value() {
                return midiState;
            },
            getSnapshot: () => midiState,
            subscribe: vi.fn(() => () => {}),
            subscribeReact: vi.fn(() => () => {}),
        },
    };
});

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const trackState = { tracks: [], selectedTrackId: null };
    return {
        ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
        trackStore: {
            get value() {
                return trackState;
            },
            getSnapshot: () => trackState,
            subscribe: vi.fn(() => () => {}),
            subscribeReact: vi.fn(() => () => {}),
        },
    };
});

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(<TData,>(store: { value: TData | null }, fallback?: TData) => fallback ?? store.value),
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
        handleWheel: vi.fn(),
        handleKeyDown: vi.fn(),
        handleContextMenu: vi.fn(),
        ctxMenu: null,
        setCtxMenu: vi.fn(),
        hoverCursor: 'crosshair',
    })),
}));

vi.mock('../PianoRollToolbar', () => ({
    PianoRollToolbar: () => <div data-testid="toolbar">Toolbar</div>,
}));

vi.mock('../PianoRollContextMenu', () => ({
    PianoRollContextMenu: () => null,
}));

vi.mock('../../../helpers/pianoRollConstants', () => ({
    NOTE_NAMES: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
    GRID_BEATS: 256,
    ROW_HEIGHT: 24,
    RULER_HEIGHT: 28,
    getVisiblePitches: vi.fn(() => [60, 61, 62, 63, 64]),
}));

vi.mock('#/components/daw/DawGridHeaderCell', () => ({
    DawGridHeaderCell: ({
        children,
        className,
        style,
    }: {
        children?: React.ReactNode;
        className?: string;
        style?: React.CSSProperties;
    }) => (
        <div className={className} style={style}>
            {children}
        </div>
    ),
}));

vi.mock('#/components/daw/DawSideRail', () => ({
    DawSideRail: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
    ),
}));

describe('PianoRoll', () => {
    const defaultProps = {
        clipId: 'clip-1',
        trackId: 'track-1',
        selectedNoteIds: new Set<string>(),
        onSelectedNoteIdsChange: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<PianoRoll {...defaultProps} />);
        expect(screen.getByTestId('toolbar')).toBeInTheDocument();
    });

    it('should render toolbar', () => {
        render(<PianoRoll {...defaultProps} />);
        expect(screen.getByTestId('toolbar')).toBeInTheDocument();
    });

    it('should render canvas element', () => {
        render(<PianoRoll {...defaultProps} />);
        expect(screen.getByLabelText('Piano roll editor')).toBeInTheDocument();
    });

    it('should render piano keys sidebar', () => {
        render(<PianoRoll {...defaultProps} />);
        const noteNames = screen.getAllByText(/^[CDEFGAB]#?\d$/);
        expect(noteNames.length).toBeGreaterThan(0);
    });

    it('should have correct aria-label', () => {
        render(<PianoRoll {...defaultProps} />);
        expect(screen.getByLabelText('Piano roll editor')).toBeInTheDocument();
    });

    // Regression (#21): the focused canvas must advertise itself as a canvas
    // editor so the global keyboard contract's `closest('[data-canvas-editor]')`
    // gate goes live and suppresses the arrangement clip-delete while the piano
    // roll (which owns Delete via `handleKeyDown`) is focused. Without this
    // attribute the gate is always-false and Delete double-fires.
    it('marks its focusable canvas with data-canvas-editor so the global delete gate is live', () => {
        render(<PianoRoll {...defaultProps} />);
        const canvas = screen.getByLabelText('Piano roll editor');
        expect(canvas.hasAttribute('data-canvas-editor')).toBe(true);
        // The marked surface must be the focusable one — the gate keys off the
        // focused `event.target`, so a non-focusable marker would be inert.
        expect(canvas).toHaveAttribute('tabindex', '0');
    });
});
