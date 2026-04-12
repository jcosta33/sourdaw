import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '#/components/ui/tooltip';
import { TrackContextMenu } from '../TrackContextMenu';

// Mock external dependencies
vi.mock('../../../useCases/removeTrack', () => ({
    removeTrack: vi.fn(),
}));

vi.mock('../../../useCases/toggleTrackState/toggleSoloSafe', () => ({
    toggleSoloSafe: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/clip/addClip', () => ({
    addClip: vi.fn(),
}));

vi.mock('../../../useCases/renameTrack', () => ({
    renameTrack: vi.fn(),
}));

vi.mock('../../../useCases/freezeBounce/freezeTrack/unfreezeTrack', () => ({
    unfreezeTrack: vi.fn(),
}));

vi.mock('../../../useCases/freezeBounce/freezeTrack/freezeTrack', () => ({
    freezeTrack: vi.fn(),
}));

vi.mock('../../../useCases/freezeBounce/bounceOperations', () => ({
    bounceInPlace: vi.fn(),
    bounceToNewTrack: vi.fn(),
}));

vi.mock('../../../useCases/recording/armTrack', () => ({
    armTrack: vi.fn(),
}));

vi.mock('../../../useCases/duplicateTrack', () => ({
    duplicateTrack: vi.fn(),
}));

vi.mock('../../../useCases/importAudioClipToTrack', () => ({
    importAudioClipToTrack: vi.fn(),
}));

vi.mock('../../../useCases/trackTemplate', () => ({
    saveTrackAsTemplate: vi.fn(),
}));

vi.mock('../../../useCases/setTrackGainPan/setInputMonitoring', () => ({
    setInputMonitoring: vi.fn(),
}));

vi.mock('../../../useCases/setTrackGainPan/setTrackColor', () => ({
    setTrackColor: vi.fn(),
}));

vi.mock('../../../useCases/importMidiFile', () => ({
    importMidiFile: vi.fn(),
}));

vi.mock('#/helpers/UI/useContextMenuDismiss', () => ({
    useContextMenuDismiss: vi.fn(),
}));

const mockTrack = {
    id: 'track1',
    name: 'Test Track',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    frozen: false,
    soloSafe: false,
    color: '#ff0000',
    inputMonitoring: 'auto',
    inputId: null,
    parentId: null,
    height: 64,
};

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('TrackContextMenu', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div>Track Content</div>
            </TrackContextMenu>
        );
        expect(screen.getByText('Track Content')).toBeInTheDocument();
    });

    it('should render context menu on right click', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('should render Add Clip menu item', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.getByText('Add Clip')).toBeInTheDocument();
    });

    it('should render Import menu items', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.getByText('Import Audio...')).toBeInTheDocument();
        expect(screen.getByText('Import MIDI...')).toBeInTheDocument();
    });

    it('should render Arm for Recording menu item', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.getByText('Arm for Recording')).toBeInTheDocument();
    });

    it('should render Freeze menu item', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.getByText('Freeze')).toBeInTheDocument();
    });

    it('should render Bounce menu items', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.getByText('Bounce in Place')).toBeInTheDocument();
        expect(screen.getByText('Bounce to New Track')).toBeInTheDocument();
    });

    it('should render Delete Track menu item', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.getByText('Delete Track')).toBeInTheDocument();
    });

    it('should show color picker when Track Color is clicked', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        const colorButton = screen.getByText('Track Color...');
        fireEvent.click(colorButton);
        expect(screen.getByText('Track Color')).toBeInTheDocument();
    });

    it('should show input monitoring options for audio/midi tracks', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);
        expect(screen.getByText(/Input Monitor:/)).toBeInTheDocument();
    });
});
