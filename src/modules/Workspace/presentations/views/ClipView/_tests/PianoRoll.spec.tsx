import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PianoRoll } from '../PianoRoll';

vi.mock('#/helpers/Styles/cn', () => ({
    cn: (...inputs: (string | undefined | null | false | Record<string, boolean>)[]) => {
        const classes: string[] = [];
        for (const input of inputs) {
            if (typeof input === 'string') {
                classes.push(input);
            } else if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
                for (const [key, value] of Object.entries(input)) {
                    if (value) classes.push(key);
                }
            }
        }
        return classes.join(' ');
    },
}));

vi.mock('#/modules/MIDI/stores/midiStore', () => ({
    midiStore: { value: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} } },
}));

vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: { value: { tracks: [], selectedTrackId: null } },
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, fallback) => fallback || store.value),
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
    DawGridHeaderCell: ({ children, className, style }: { children?: React.ReactNode; className?: string; style?: React.CSSProperties }) => (
        <div className={className} style={style}>{children}</div>
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
});
