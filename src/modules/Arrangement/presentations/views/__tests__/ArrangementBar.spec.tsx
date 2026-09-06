import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useStore } from '#/infra/store/useStore';

import { type ArrangementSection } from '../../../models/Marker';
import { addSection } from '../../../useCases/marker/sectionOperations/addSection';
import { moveSection } from '../../../useCases/marker/sectionOperations/moveSection';
import { removeSection } from '../../../useCases/marker/sectionOperations/removeSection';
import { renameSection } from '../../../useCases/marker/sectionOperations/renameSection';
import { reorderSection } from '../../../useCases/marker/sectionOperations/reorderSection';
import { resizeSection } from '../../../useCases/marker/sectionOperations/resizeSection';
import { setSectionColor } from '../../../useCases/marker/sectionOperations/setSectionColor';
import { ArrangementBar } from '../ArrangementBar';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(),
}));

vi.mock('../../../stores/markerStore', () => ({
    markerStore: {},
}));

vi.mock('../../../useCases/marker/sectionOperations/reorderSection', () => ({
    reorderSection: vi.fn(),
}));
vi.mock('../../../useCases/marker/sectionOperations/resizeSection', () => ({
    resizeSection: vi.fn(),
}));
vi.mock('../../../useCases/marker/sectionOperations/moveSection', () => ({
    moveSection: vi.fn(),
}));
vi.mock('../../../useCases/marker/sectionOperations/setSectionColor', () => ({
    setSectionColor: vi.fn(),
}));
vi.mock('../../../useCases/marker/sectionOperations/renameSection', () => ({
    renameSection: vi.fn(),
}));
vi.mock('../../../useCases/marker/sectionOperations/removeSection', () => ({
    removeSection: vi.fn(),
}));
vi.mock('../../../useCases/marker/sectionOperations/addSection', () => ({
    addSection: vi.fn(),
}));

vi.mock('#/utils/UI/useContextMenuDismiss', () => ({
    useContextMenuDismiss: vi.fn(),
}));

vi.mock('../TimelineChromeSurface', () => ({
    TimelineChromeSurface: ({ children, ...props }: import('react').ComponentProps<'div'>) => (
        <div {...props}>{children}</div>
    ),
}));

const section = (overrides: Partial<ArrangementSection> & Pick<ArrangementSection, 'id'>): ArrangementSection => ({
    name: 'Section',
    startBeat: 0,
    endBeat: 8,
    color: '',
    ...overrides,
});

const setSections = (sections: ArrangementSection[]) => {
    vi.mocked(useStore).mockReturnValue({ markers: [], sections });
};

// Capture the window mousemove/mouseup listeners a drag attaches, so we can
// drive the drag-commit math. ArrangementBar adds listeners on mousedown.
const captureWindowListeners = () => {
    const moves: Array<(e: { clientX: number }) => void> = [];
    const ups: Array<() => void> = [];
    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation(((
        type: string,
        listener: (...args: never[]) => void
    ) => {
        if (type === 'mousemove') {
            moves.push(listener as unknown as (e: { clientX: number }) => void);
        } else if (type === 'mouseup') {
            ups.push(listener);
        }
    }) as typeof window.addEventListener);
    const removeSpy = vi.spyOn(window, 'removeEventListener').mockImplementation((() => {}) as never);
    return {
        move: (clientX: number) => {
            for (const m of moves) {
                m({ clientX });
            }
        },
        up: () => {
            for (const u of ups) {
                u();
            }
        },
        restore: () => {
            addSpy.mockRestore();
            removeSpy.mockRestore();
        },
    };
};

describe('ArrangementBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useStore).mockReturnValue({ markers: [], sections: [] });
    });

    it('renders the hint when there are no sections', () => {
        render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        expect(screen.getByText('Right-click to add arrangement sections')).toBeInTheDocument();
    });

    it('renders each section name', () => {
        setSections([
            section({ id: 's1', name: 'Intro', startBeat: 0, endBeat: 16 }),
            section({ id: 's2', name: 'Verse', startBeat: 16, endBeat: 32 }),
        ]);
        render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        expect(screen.getByText('Intro')).toBeInTheDocument();
        expect(screen.getByText('Verse')).toBeInTheDocument();
    });

    it('uses the section color when present, else the palette colour for its index', () => {
        setSections([
            section({ id: 's1', name: 'Intro', startBeat: 0, endBeat: 8, color: '#ff0000' }),
            section({ id: 's2', name: 'Verse', startBeat: 8, endBeat: 16, color: '' }),
        ]);
        const { container } = render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        const named = container.querySelectorAll('[title]');
        const intro = Array.from(named).find((el) => el.getAttribute('title') === 'Intro') as HTMLElement;
        const verse = Array.from(named).find((el) => el.getAttribute('title') === 'Verse') as HTMLElement;
        // The section's explicit color (#ff0000) is applied directly (browsers
        // normalize the hex to rgb for the computed style).
        expect(intro.style.backgroundColor).toBe('rgb(255, 0, 0)');
        // Palette fallback is a non-empty, non-red colour.
        expect(verse.style.backgroundColor).toBeTruthy();
        expect(verse.style.backgroundColor).not.toBe('rgb(255, 0, 0)');
    });

    it('adds a section when the empty-bar context menu Add Section is clicked', () => {
        const { container } = render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        const bar = container.querySelector('[role="region"]')!;
        fireEvent.contextMenu(bar, { clientX: 50, clientY: 10 });
        fireEvent.click(screen.getByText('Add Section'));
        // beat = (localX + scrollX) / pixelsPerBeat; localX derived from rect left 0.
        // addSection(startBeat=floor(beat), endBeat=startBeat+16, name).
        expect(addSection).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), 'New Section');
        const [startBeat, endBeat] = vi.mocked(addSection).mock.calls[0]!;
        expect(endBeat - startBeat).toBe(16);
    });

    it('opens a section context menu when right-clicking over a section', () => {
        setSections([section({ id: 's1', name: 'Intro', startBeat: 0, endBeat: 16 })]);
        const { container } = render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        const bar = container.querySelector('[role="region"]')!;
        fireEvent.contextMenu(bar, { clientX: 50, clientY: 10 });
        // Section menu exposes Rename / Move Left / Move Right / Delete.
        expect(screen.getByText('Rename')).toBeInTheDocument();
        expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    // The global shortcut layer gates Delete / Backspace on
    // closest('[role="menu"]') (#3618): without a menu-role ancestor a Delete
    // from inside the open menu deletes the arrangement clips behind it.
    it('section context menu items sit inside a [role="menu"] surface', () => {
        setSections([section({ id: 's1', name: 'Intro', startBeat: 0, endBeat: 16 })]);
        const { container } = render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        const bar = container.querySelector('[role="region"]')!;
        fireEvent.contextMenu(bar, { clientX: 50, clientY: 10 });

        expect(screen.getByText('Rename').closest('[role="menu"]')).not.toBeNull();
    });

    it('starts rename, commits the trimmed name on blur, and clears editing', () => {
        setSections([section({ id: 's1', name: 'Intro', startBeat: 0, endBeat: 16 })]);
        const { container } = render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        const bar = container.querySelector('[role="region"]')!;
        fireEvent.contextMenu(bar, { clientX: 50, clientY: 10 });
        fireEvent.click(screen.getByText('Rename'));

        const input = screen.getByDisplayValue('Intro') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '  Chorus  ' } });
        fireEvent.blur(input);
        expect(renameSection).toHaveBeenCalledWith('s1', 'Chorus');
    });

    it('does not rename when the committed value is empty/whitespace', () => {
        setSections([section({ id: 's1', name: 'Intro', startBeat: 0, endBeat: 16 })]);
        const { container } = render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        const bar = container.querySelector('[role="region"]')!;
        fireEvent.contextMenu(bar, { clientX: 50, clientY: 10 });
        fireEvent.click(screen.getByText('Rename'));
        const input = screen.getByDisplayValue('Intro') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '   ' } });
        fireEvent.blur(input);
        expect(renameSection).not.toHaveBeenCalled();
    });

    it('commits the rename on Enter and cancels on Escape', () => {
        setSections([section({ id: 's1', name: 'Intro', startBeat: 0, endBeat: 16 })]);
        const { container } = render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        const bar = container.querySelector('[role="region"]')!;
        fireEvent.contextMenu(bar, { clientX: 50, clientY: 10 });
        fireEvent.click(screen.getByText('Rename'));

        const input = screen.getByDisplayValue('Intro') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Verse' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(renameSection).toHaveBeenCalledWith('s1', 'Verse');

        // Re-open rename then Escape must not commit a change.
        fireEvent.contextMenu(bar, { clientX: 50, clientY: 10 });
        fireEvent.click(screen.getByText('Rename'));
        const input2 = screen.getByDisplayValue('Intro') as HTMLInputElement;
        fireEvent.change(input2, { target: { value: 'Ignore' } });
        fireEvent.keyDown(input2, { key: 'Escape' });
        // Still only the single Enter-driven rename call.
        expect(renameSection).toHaveBeenCalledTimes(1);
    });

    it('enters editing on section double-click', () => {
        setSections([section({ id: 's1', name: 'Intro', startBeat: 0, endBeat: 16 })]);
        const { container } = render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        const named = container.querySelectorAll('[title]');
        const intro = Array.from(named).find((el) => el.getAttribute('title') === 'Intro') as HTMLElement;
        fireEvent.doubleClick(intro);
        expect(screen.getByDisplayValue('Intro')).toBeInTheDocument();
    });

    it('deletes the section from the section context menu', () => {
        setSections([section({ id: 's1', name: 'Intro', startBeat: 0, endBeat: 16 })]);
        const { container } = render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        const bar = container.querySelector('[role="region"]')!;
        fireEvent.contextMenu(bar, { clientX: 50, clientY: 10 });
        fireEvent.click(screen.getByText('Delete'));
        expect(removeSection).toHaveBeenCalledWith('s1');
    });

    it('reorders left/right and disables Move Left for the first section', () => {
        setSections([
            section({ id: 's1', name: 'Intro', startBeat: 0, endBeat: 16 }),
            section({ id: 's2', name: 'Verse', startBeat: 16, endBeat: 32 }),
        ]);
        const { container } = render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        const bar = container.querySelector('[role="region"]')!;

        // Context-menu the first section: Move Left is disabled.
        fireEvent.contextMenu(bar, { clientX: 50, clientY: 10 });
        const moveLeft = screen.getByText('Move Left').closest('button')!;
        expect(moveLeft).toBeDisabled();
        fireEvent.click(screen.getByText('Move Right'));
        expect(reorderSection).toHaveBeenCalledWith('s1', 'right');

        // Context-menu the second section: Move Right disabled, Move Left enabled.
        vi.clearAllMocks();
        fireEvent.contextMenu(bar, { clientX: 200, clientY: 10 });
        const moveRight = screen.getByText('Move Right').closest('button')!;
        expect(moveRight).toBeDisabled();
        fireEvent.click(screen.getByText('Move Left'));
        expect(reorderSection).toHaveBeenCalledWith('s2', 'left');
    });

    it('sets the section colour from a swatch and closes the menu', () => {
        setSections([section({ id: 's1', name: 'Intro', startBeat: 0, endBeat: 16 })]);
        const { container } = render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        const bar = container.querySelector('[role="region"]')!;
        fireEvent.contextMenu(bar, { clientX: 50, clientY: 10 });
        const swatches = screen
            .getAllByRole('button')
            .filter((b) => b.hasAttribute('aria-label') && b.getAttribute('aria-label')!.startsWith('Set color'));
        expect(swatches.length).toBeGreaterThan(0);
        const firstColor = swatches[0]!.getAttribute('aria-label')!.replace('Set color ', '');
        fireEvent.click(swatches[0]!);
        expect(setSectionColor).toHaveBeenCalledWith('s1', firstColor);
    });

    describe('ArrangementBar — section drag', () => {
        it('moves a section on drag-commit (body mousedown + move + up)', () => {
            setSections([section({ id: 's1', name: 'Intro', startBeat: 0, endBeat: 16 })]);
            const listeners = captureWindowListeners();
            try {
                const { container } = render(<ArrangementBar pixelsPerBeat={10} scrollX={0} />);
                const named = container.querySelectorAll('[title]');
                const intro = Array.from(named).find((el) => el.getAttribute('title') === 'Intro') as HTMLElement;
                // Body click (clientX within section, away from edges).
                act(() => {
                    fireEvent.mouseDown(intro, { button: 0, clientX: 50 });
                });
                act(() => {
                    listeners.move(90); // +40px at 10px/beat = +4 beats
                });
                act(() => {
                    listeners.up();
                });
                expect(moveSection).toHaveBeenCalledWith('s1', 4);
            } finally {
                listeners.restore();
            }
        });

        it('does not commit a move when the section did not move', () => {
            setSections([section({ id: 's1', name: 'Intro', startBeat: 0, endBeat: 16 })]);
            const listeners = captureWindowListeners();
            try {
                const { container } = render(<ArrangementBar pixelsPerBeat={10} scrollX={0} />);
                const named = container.querySelectorAll('[title]');
                const intro = Array.from(named).find((el) => el.getAttribute('title') === 'Intro') as HTMLElement;
                act(() => {
                    fireEvent.mouseDown(intro, { button: 0, clientX: 50 });
                });
                act(() => {
                    listeners.move(50); // no net movement
                });
                act(() => {
                    listeners.up();
                });
                expect(moveSection).not.toHaveBeenCalled();
                expect(resizeSection).not.toHaveBeenCalled();
            } finally {
                listeners.restore();
            }
        });

        it('resizes the right edge on drag-commit', () => {
            setSections([section({ id: 's1', name: 'Intro', startBeat: 0, endBeat: 16 })]);
            const listeners = captureWindowListeners();
            try {
                const { container } = render(<ArrangementBar pixelsPerBeat={10} scrollX={0} />);
                const named = container.querySelectorAll('[title]');
                const intro = Array.from(named).find((el) => el.getAttribute('title') === 'Intro') as HTMLElement;
                // Click exactly at the right edge (endBeat 16 * 10ppb = 160px).
                act(() => {
                    fireEvent.mouseDown(intro, { button: 0, clientX: 160 });
                });
                act(() => {
                    listeners.move(210); // +50px = +5 beats → end 21
                });
                act(() => {
                    listeners.up();
                });
                expect(resizeSection).toHaveBeenCalledWith('s1', 0, 21);
            } finally {
                listeners.restore();
            }
        });

        it('resizes the left edge and enforces a 4-beat minimum duration', () => {
            setSections([section({ id: 's1', name: 'Intro', startBeat: 0, endBeat: 16 })]);
            const listeners = captureWindowListeners();
            try {
                const { container } = render(<ArrangementBar pixelsPerBeat={10} scrollX={0} />);
                const named = container.querySelectorAll('[title]');
                const intro = Array.from(named).find((el) => el.getAttribute('title') === 'Intro') as HTMLElement;
                // Click at the left edge (0px).
                act(() => {
                    fireEvent.mouseDown(intro, { button: 0, clientX: 0 });
                });
                // Drag right by 130px (+13 beats): naive start=13, end=16.
                // 16-13 = 3 < 4-beat minimum, so clamp lastStart = end-4 = 12.
                act(() => {
                    listeners.move(130);
                });
                act(() => {
                    listeners.up();
                });
                // lastStart = end-4 = 12, lastEnd = 16.
                expect(resizeSection).toHaveBeenCalledWith('s1', 12, 16);
            } finally {
                listeners.restore();
            }
        });

        it('ignores a non-primary-button mousedown on a section', () => {
            setSections([section({ id: 's1', name: 'Intro', startBeat: 0, endBeat: 16 })]);
            const listeners = captureWindowListeners();
            try {
                const { container } = render(<ArrangementBar pixelsPerBeat={10} scrollX={0} />);
                const named = container.querySelectorAll('[title]');
                const intro = Array.from(named).find((el) => el.getAttribute('title') === 'Intro') as HTMLElement;
                act(() => {
                    fireEvent.mouseDown(intro, { button: 2, clientX: 50 });
                });
                act(() => {
                    listeners.move(90);
                });
                act(() => {
                    listeners.up();
                });
                expect(moveSection).not.toHaveBeenCalled();
            } finally {
                listeners.restore();
            }
        });
    });

    describe('ArrangementBar — hover edge & resize observer', () => {
        it('sets a col-resize cursor when hovering near a section edge, and clears it on leave', () => {
            setSections([section({ id: 's1', name: 'Intro', startBeat: 0, endBeat: 16 })]);
            const { container } = render(<ArrangementBar pixelsPerBeat={10} scrollX={0} />);
            const named = container.querySelectorAll('[title]');
            const intro = Array.from(named).find((el) => el.getAttribute('title') === 'Intro') as HTMLElement;
            // Hover over the right edge (endBeat 16 * 10ppb = 160px local).
            fireEvent.mouseMove(intro, { clientX: 160 });
            expect(intro.style.cursor).toBe('col-resize');
            // Mouse leave clears the hover for this section.
            fireEvent.mouseLeave(intro);
            expect(intro.style.cursor).toBe('grab');
        });

        it('keeps the grab cursor while hovering over the section body', () => {
            setSections([section({ id: 's1', name: 'Intro', startBeat: 0, endBeat: 16 })]);
            const { container } = render(<ArrangementBar pixelsPerBeat={10} scrollX={0} />);
            const named = container.querySelectorAll('[title]');
            const intro = Array.from(named).find((el) => el.getAttribute('title') === 'Intro') as HTMLElement;
            fireEvent.mouseMove(intro, { clientX: 80 });
            expect(intro.style.cursor).toBe('grab');
        });

        it('ignores section mouse-move while a drag is in progress', () => {
            setSections([section({ id: 's1', name: 'Intro', startBeat: 0, endBeat: 16 })]);
            const listeners = captureWindowListeners();
            try {
                const { container } = render(<ArrangementBar pixelsPerBeat={10} scrollX={0} />);
                const named = container.querySelectorAll('[title]');
                const intro = Array.from(named).find((el) => el.getAttribute('title') === 'Intro') as HTMLElement;
                // Start a move drag and advance it via the window mousemove so the
                // dragPreview state updates (cursor flips to grabbing).
                act(() => {
                    fireEvent.mouseDown(intro, { button: 0, clientX: 50 });
                });
                act(() => {
                    listeners.move(90);
                });
                expect(intro.style.cursor).toBe('grabbing');
                // While the drag is active, a section-level mouse-move over the
                // edge must NOT switch the cursor to col-resize (the hover handler
                // early-returns when a drag is in progress).
                act(() => {
                    fireEvent.mouseMove(intro, { clientX: 160 });
                });
                expect(intro.style.cursor).toBe('grabbing');
                act(() => {
                    listeners.up();
                });
            } finally {
                listeners.restore();
            }
        });
    });
});
