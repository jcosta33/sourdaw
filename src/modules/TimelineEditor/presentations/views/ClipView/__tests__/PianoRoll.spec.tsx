import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    setNoteVelocity,
    setNotePressure,
    setNoteSlide,
    setNotePitchBend,
    toggleStepRecordingForClip,
} from '#/modules/MIDI/useCases';

import { usePianoRollInteractions } from '../../../hooks/usePianoRollInteractions';
import { PianoRoll } from '../PianoRoll';

const { toolbarPropsRef, notePropertyLanePropsRef, contextMenuPropsRef } = vi.hoisted(() => ({
    toolbarPropsRef: { current: null as Record<string, unknown> | null },
    notePropertyLanePropsRef: { current: null as Record<string, unknown> | null },
    contextMenuPropsRef: { current: null as Record<string, unknown> | null },
}));

type NotePropertyLaneCapturedProps = {
    getValue: (note: { velocity?: number; pressure?: number; slide?: number; pitchBend?: number }) => number;
    setValue: (clipId: string, noteId: string, value: number) => void;
};

function invokeToolbarHandler<TArgs extends unknown[]>(name: string, ...args: TArgs): void {
    const handler = toolbarPropsRef.current?.[name];
    if (typeof handler !== 'function') {
        throw new TypeError(`Expected toolbar prop "${name}" to be a function`);
    }
    (handler as (...handlerArgs: TArgs) => void)(...args);
}

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

vi.mock('../PianoRollToolbar', () => ({
    PianoRollToolbar: (props: Record<string, unknown>) => {
        toolbarPropsRef.current = props;
        return <div data-testid="toolbar">Toolbar</div>;
    },
}));

vi.mock('../PianoRollContextMenu', () => ({
    PianoRollContextMenu: (props: Record<string, unknown>) => {
        contextMenuPropsRef.current = props;
        return <div data-testid="context-menu" />;
    },
}));

vi.mock('../../AutomationLane/NotePropertyLane', () => ({
    NotePropertyLane: (props: Record<string, unknown>) => {
        notePropertyLanePropsRef.current = props;
        return <div data-testid="note-property-lane" />;
    },
}));

// Whole-module mock: deliberately fake, test-friendly constants (distinct
// from the real ROW_HEIGHT/RULER_HEIGHT, a fixed visible-pitches list) so the
// bulk of this file's assertions don't depend on real scale/geometry math.
// `getPianoRollExtentBeats` is stubbed only so PianoRoll's render doesn't
// crash calling it — its numeric output is NOT asserted anywhere in this
// file. The real extent rule (rounding, trailing room, the actual
// GRID_BEATS floor) is covered against the real module in the sibling
// PianoRollGridExtent.spec.tsx; duplicating that math here with fake inputs
// would just be a second copy of the same defect risk this issue fixed.
vi.mock('../../../helpers/pianoRollConstants', () => ({
    NOTE_NAMES: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
    GRID_BEATS: 256,
    ROW_HEIGHT: 24,
    RULER_HEIGHT: 28,
    EMPTY_NOTES: [],
    getVisiblePitches: vi.fn(() => [60, 61, 62, 63, 64]),
    getPianoRollExtentBeats: vi.fn(() => 256),
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

    const activateExpressionLane = (lane: 'velocity' | 'pressure' | 'slide' | 'pitchBend'): void => {
        act(() => {
            invokeToolbarHandler('onActiveExpressionLaneChange', lane);
        });
    };

    beforeEach(() => {
        vi.clearAllMocks();
        toolbarPropsRef.current = null;
        notePropertyLanePropsRef.current = null;
        contextMenuPropsRef.current = null;
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

    it('reports the initial beat width to the parent on mount', () => {
        const onBeatWidthChange = vi.fn();
        render(<PianoRoll {...defaultProps} onBeatWidthChange={onBeatWidthChange} />);

        // beatWidth = max(1, 40 * zoom=1) = 40.
        expect(onBeatWidthChange).toHaveBeenCalledWith(40);
    });

    // The reported content width is derived from `getPianoRollExtentBeats`,
    // which this file stubs to a fixed value (see the pianoRollConstants
    // mock above) so it doesn't crash — real width behaviour, including the
    // clip-length/furthest-note/GRID_BEATS-floor rule, is asserted against
    // the real module in PianoRollGridExtent.spec.tsx.
    it('reports a content width derived from beat width and the grid extent', () => {
        const onContentWidthChange = vi.fn();
        render(<PianoRoll {...defaultProps} onContentWidthChange={onContentWidthChange} />);

        // extentBeats is stubbed to 256; totalWidth = max(parentClientWidth=0, 256 * 40).
        expect(onContentWidthChange).toHaveBeenCalledWith(10_240);
    });

    it('recomputes beat width from the toolbar zoom control', () => {
        const onBeatWidthChange = vi.fn();
        render(<PianoRoll {...defaultProps} onBeatWidthChange={onBeatWidthChange} />);
        onBeatWidthChange.mockClear();

        act(() => {
            invokeToolbarHandler('onZoomChange', 2);
        });

        expect(onBeatWidthChange).toHaveBeenCalledWith(80);
    });

    it('forwards horizontal scroll position from the scroll container', () => {
        const onScrollChange = vi.fn();
        render(<PianoRoll {...defaultProps} onScrollChange={onScrollChange} />);

        const scrollContainer = screen.getByLabelText('Piano roll editor').closest('.overflow-auto');
        if (!scrollContainer) {
            throw new Error('Expected the piano roll scroll container');
        }
        Object.defineProperty(scrollContainer, 'scrollLeft', { value: 250, configurable: true });
        fireEvent.scroll(scrollContainer);

        expect(onScrollChange).toHaveBeenCalledWith(250);
    });

    it('shows the expression lane only after the toolbar toggles it on', () => {
        render(<PianoRoll {...defaultProps} />);
        expect(screen.queryByTestId('note-property-lane')).not.toBeInTheDocument();

        act(() => {
            invokeToolbarHandler('onToggleExpressionView');
        });

        expect(screen.getByTestId('note-property-lane')).toBeInTheDocument();
    });

    it('renders the context menu only while an open context-menu position exists, and closes it', () => {
        const setCtxMenu = vi.fn();
        vi.mocked(usePianoRollInteractions).mockReturnValueOnce({
            handleMouseDown: vi.fn(),
            handleMouseMove: vi.fn(),
            handleMouseUp: vi.fn(),
            handleDoubleClick: vi.fn(),
            handleKeyDown: vi.fn(),
            handleContextMenu: vi.fn(),
            ctxMenu: { x: 10, y: 20, beat: 0 },
            setCtxMenu,
            hoverCursor: 'crosshair',
        });

        render(<PianoRoll {...defaultProps} />);
        expect(screen.getByTestId('context-menu')).toBeInTheDocument();

        const { onClose, onSelectAll, onClearSelection } = contextMenuPropsRef.current as {
            onClose: () => void;
            onSelectAll: () => void;
            onClearSelection: () => void;
        };
        onClose();
        expect(setCtxMenu).toHaveBeenCalledWith(null);

        // notes is empty in this mocked store, so both resolve to an empty selection —
        // the point is proving the callbacks are wired to the selection setter at all.
        onSelectAll();
        expect(defaultProps.onSelectedNoteIdsChange).toHaveBeenCalledWith(new Set());

        onClearSelection();
        expect(defaultProps.onSelectedNoteIdsChange).toHaveBeenCalledWith(new Set());
    });

    it('toggles each independent toolbar boolean flag', () => {
        render(<PianoRoll {...defaultProps} />);

        const toggleCases: Array<{ handler: string; prop: string }> = [
            { handler: 'onToggleFolded', prop: 'isFolded' },
            { handler: 'onToggleConstrainToScale', prop: 'constrainToScale' },
            { handler: 'onToggleGhostNotes', prop: 'showGhostNotes' },
            { handler: 'onToggleChordMode', prop: 'chordMode' },
            { handler: 'onTogglePaintMode', prop: 'paintMode' },
            { handler: 'onToggleLassoMode', prop: 'lassoMode' },
            { handler: 'onToggleNotePreview', prop: 'notePreviewEnabled' },
        ];

        for (const { handler, prop } of toggleCases) {
            const before = toolbarPropsRef.current?.[prop];
            act(() => {
                invokeToolbarHandler(handler);
            });
            expect(toolbarPropsRef.current?.[prop]).toBe(!before);
        }
    });

    it('toggles step recording for the currently edited clip', () => {
        render(<PianoRoll {...defaultProps} />);

        act(() => {
            invokeToolbarHandler('onToggleStepInput');
        });

        expect(toggleStepRecordingForClip).toHaveBeenCalledWith({ clipId: 'clip-1' });
    });

    it('maps openedClipIds into toolbar-ready {id, name} entries', () => {
        render(<PianoRoll {...defaultProps} openedClipIds={['clip-2', 'clip-3']} />);

        expect(toolbarPropsRef.current?.openedClips).toEqual([
            { id: 'clip-2', name: 'clip-2' },
            { id: 'clip-3', name: 'clip-3' },
        ]);
    });

    describe('expression lane wiring', () => {
        beforeEach(() => {
            render(<PianoRoll {...defaultProps} />);
            act(() => {
                invokeToolbarHandler('onToggleExpressionView');
            });
        });

        it('reads and writes velocity (0-127, default 100)', () => {
            const { getValue, setValue } = notePropertyLanePropsRef.current as NotePropertyLaneCapturedProps;

            expect(getValue({})).toBe(100);
            expect(getValue({ velocity: 42 })).toBe(42);

            setValue('clip-1', 'note-1', 55);
            expect(setNoteVelocity).toHaveBeenCalledWith('clip-1', 'note-1', 55);
        });

        it('reads and writes pressure (0-127, default 0)', () => {
            activateExpressionLane('pressure');
            const { getValue, setValue } = notePropertyLanePropsRef.current as NotePropertyLaneCapturedProps;

            expect(getValue({})).toBe(0);
            expect(getValue({ pressure: 30 })).toBe(30);

            setValue('clip-1', 'note-2', 30);
            expect(setNotePressure).toHaveBeenCalledWith('clip-1', 'note-2', 30);
        });

        it('reads and writes slide (0-127, default 0)', () => {
            activateExpressionLane('slide');
            const { getValue, setValue } = notePropertyLanePropsRef.current as NotePropertyLaneCapturedProps;

            expect(getValue({})).toBe(0);
            expect(getValue({ slide: 12 })).toBe(12);

            setValue('clip-1', 'note-3', 12);
            expect(setNoteSlide).toHaveBeenCalledWith('clip-1', 'note-3', 12);
        });

        it('reads and writes pitch bend, scaling between the 14-bit MIDI range and 0-127', () => {
            activateExpressionLane('pitchBend');
            const { getValue, setValue } = notePropertyLanePropsRef.current as NotePropertyLaneCapturedProps;

            // Centered pitch bend (0) maps to (0 + 8192) / 16383 * 127.
            expect(getValue({})).toBeCloseTo(((0 + 8192) / 16_383) * 127, 5);

            setValue('clip-1', 'note-4', 127);
            expect(setNotePitchBend).toHaveBeenCalledWith('clip-1', 'note-4', Math.round((127 / 127) * 16_383) - 8192);
        });
    });
});
