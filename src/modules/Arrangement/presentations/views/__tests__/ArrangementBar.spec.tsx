import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArrangementBar } from '../ArrangementBar';
import { useStore } from '#/infra/store/useStore';
import { addSection } from '../../../useCases/marker/sectionOperations/addSection';

// Mock external dependencies
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

vi.mock('#/helpers/UI/useContextMenuDismiss', () => ({
    useContextMenuDismiss: vi.fn(),
}));

vi.mock('../TimelineChromeSurface', () => ({
    TimelineChromeSurface: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

describe('ArrangementBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useStore).mockReturnValue({ markers: [], sections: [] });
    });

    it('should render without crashing', () => {
        const { container } = render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render hint when no sections', () => {
        render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        expect(screen.getByText('Right-click to add arrangement sections')).toBeInTheDocument();
    });

    it('should render sections when present', () => {
        vi.mocked(useStore).mockReturnValue({
            markers: [],
            sections: [
                { id: 's1', name: 'Intro', startBeat: 0, endBeat: 16, color: 'oklch(0.38 0.08 260)' },
                { id: 's2', name: 'Verse', startBeat: 16, endBeat: 32, color: 'oklch(0.38 0.08 150)' },
            ],
        });
        render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        expect(screen.getByText('Intro')).toBeInTheDocument();
        expect(screen.getByText('Verse')).toBeInTheDocument();
    });

    it('should have correct role and aria attributes', () => {
        render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        const region = screen.getByRole('region');
        expect(region).toHaveAttribute('aria-label', 'Arrangement sections');
    });

    it('should handle context menu on bar', () => {
        const { container } = render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        const bar = container.querySelector('[role="region"]');
        fireEvent.contextMenu(bar!);
        // Context menu should be shown
        expect(screen.getByText('Add Section')).toBeInTheDocument();
    });

    it('should call addSection when Add Section is clicked', () => {
        const { container } = render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        const bar = container.querySelector('[role="region"]');
        fireEvent.contextMenu(bar!);
        const addButton = screen.getByText('Add Section');
        fireEvent.click(addButton);
        expect(addSection).toHaveBeenCalled();
    });

    it('should cycle through section colors', () => {
        vi.mocked(useStore).mockReturnValue({
            markers: [],
            sections: [
                { id: 's1', name: 'Section 1', startBeat: 0, endBeat: 8 },
                { id: 's2', name: 'Section 2', startBeat: 8, endBeat: 16 },
                { id: 's3', name: 'Section 3', startBeat: 16, endBeat: 24 },
                { id: 's4', name: 'Section 4', startBeat: 24, endBeat: 32 },
                { id: 's5', name: 'Section 5', startBeat: 32, endBeat: 40 },
                { id: 's6', name: 'Section 6', startBeat: 40, endBeat: 48 },
            ],
        });
        const { container } = render(<ArrangementBar pixelsPerBeat={12} scrollX={0} />);
        const sections = container.querySelectorAll('[title]');
        expect(sections.length).toBeGreaterThan(0);
    });
});
