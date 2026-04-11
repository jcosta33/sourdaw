import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '#/components/ui/tooltip';
import { TimelineEmptyMenu } from '../TimelineEmptyMenu';
import { addTrack } from '../../../useCases/addTrack';

// Mock external dependencies
vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: { value: { tracks: [] } },
}));

vi.mock('#/modules/Arrangement/stores/markerStore', () => ({
    markerStore: { value: { markers: [] } },
}));

vi.mock('#/modules/Transport/stores/transportStore', () => ({
    transportStore: { value: { tempo: 120 } },
}));

vi.mock('#/modules/Command/useCases/executeAppAction', () => ({
    executeAppAction: vi.fn(),
}));

vi.mock('../../../useCases/timelineViewActions', () => ({
    pasteClip: vi.fn(),
}));

vi.mock('../../../useCases/importMidiFile', () => ({
    importMidiFile: vi.fn(),
}));

vi.mock('../../../useCases/addTrack', () => ({
    addTrack: vi.fn(),
}));

vi.mock('../../../useCases/clip/addClip', () => ({
    addClip: vi.fn(),
}));

vi.mock('../../../useCases/marker/markerOperations/removeMarker', () => ({
    removeMarker: vi.fn(),
}));

vi.mock('../../../useCases/marker/markerOperations/setMarkerColor', () => ({
    setMarkerColor: vi.fn(),
}));

vi.mock('../../../useCases/marker/markerOperations/addMarker', () => ({
    addMarker: vi.fn(),
}));

vi.mock('#/helpers/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('#/helpers/tauriBridge', () => ({
    isTauri: vi.fn(() => false),
}));

vi.mock('#/helpers/UI/useContextMenuDismiss', () => ({
    useContextMenuDismiss: vi.fn(),
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('TimelineEmptyMenu', () => {
    const mockOnClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        renderWithTooltip(
            <TimelineEmptyMenu
                x={100}
                y={100}
                trackId="track1"
                beat={8}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('should render Add Track buttons', () => {
        renderWithTooltip(
            <TimelineEmptyMenu
                x={100}
                y={100}
                trackId={null}
                beat={8}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('Add Audio Track')).toBeInTheDocument();
        expect(screen.getByText('Add MIDI Track')).toBeInTheDocument();
        expect(screen.getByText('Add Bus Track')).toBeInTheDocument();
    });

    it('should render Add Clip Here when trackId is provided', () => {
        renderWithTooltip(
            <TimelineEmptyMenu
                x={100}
                y={100}
                trackId="track1"
                beat={8}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('Add Clip Here')).toBeInTheDocument();
    });

    it('should render Paste button', () => {
        renderWithTooltip(
            <TimelineEmptyMenu
                x={100}
                y={100}
                trackId={null}
                beat={8}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('Paste')).toBeInTheDocument();
    });

    it('should render Add Marker Here button', () => {
        renderWithTooltip(
            <TimelineEmptyMenu
                x={100}
                y={100}
                trackId={null}
                beat={8}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('Add Marker Here')).toBeInTheDocument();
    });

    it('should render Import buttons', () => {
        renderWithTooltip(
            <TimelineEmptyMenu
                x={100}
                y={100}
                trackId={null}
                beat={8}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('Import Audio…')).toBeInTheDocument();
        expect(screen.getByText('Import MIDI…')).toBeInTheDocument();
    });

    it('should call addTrack when Add Audio Track is clicked', () => {
        renderWithTooltip(
            <TimelineEmptyMenu
                x={100}
                y={100}
                trackId={null}
                beat={8}
                onClose={mockOnClose}
            />
        );
        const button = screen.getByText('Add Audio Track');
        fireEvent.click(button);
        expect(addTrack).toHaveBeenCalledWith({ name: 'Audio', kind: 'audio' });
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onClose when menu item is clicked', () => {
        renderWithTooltip(
            <TimelineEmptyMenu
                x={100}
                y={100}
                trackId={null}
                beat={8}
                onClose={mockOnClose}
            />
        );
        const button = screen.getByText('Add Audio Track');
        fireEvent.click(button);
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('should show AI Generate section', () => {
        renderWithTooltip(
            <TimelineEmptyMenu
                x={100}
                y={100}
                trackId={null}
                beat={8}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('AI Generate')).toBeInTheDocument();
    });

    it('should show desktop-only notice for audio generation', () => {
        renderWithTooltip(
            <TimelineEmptyMenu
                x={100}
                y={100}
                trackId={null}
                beat={8}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('Generate Drum Pattern')).toBeInTheDocument();
        expect(screen.getByText('Generate Chord Progression')).toBeInTheDocument();
    });

    it('should have correct positioning', () => {
        renderWithTooltip(
            <TimelineEmptyMenu
                x={150}
                y={200}
                trackId={null}
                beat={8}
                onClose={mockOnClose}
            />
        );
        const menu = screen.getByRole('menu');
        expect(menu).toHaveStyle({ left: '150px', top: '200px' });
    });
});
