import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimelineEmptyMenu } from './TimelineEmptyMenu';

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

vi.mock('../../useCases/timelineViewActions', () => ({
    addClip: vi.fn(),
    addTrack: vi.fn(),
    decodeAudioFile: vi.fn(),
    importMidiFile: vi.fn(),
    pasteClip: vi.fn(),
}));

vi.mock('../../useCases/marker/markerOperations', () => ({
    addMarker: vi.fn(),
    setMarkerColor: vi.fn(),
    removeMarker: vi.fn(),
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

describe('TimelineEmptyMenu', () => {
    const mockOnClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(
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
        render(
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
        render(
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
        render(
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
        render(
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
        render(
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
        const { addTrack } = vi.importMock('../../useCases/timelineViewActions');
        render(
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
        render(
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
        render(
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
        render(
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
        const { container } = render(
            <TimelineEmptyMenu
                x={150}
                y={200}
                trackId={null}
                beat={8}
                onClose={mockOnClose}
            />
        );
        const menu = container.firstChild as HTMLElement;
        expect(menu).toHaveStyle({ left: '150px', top: '200px' });
    });
});
