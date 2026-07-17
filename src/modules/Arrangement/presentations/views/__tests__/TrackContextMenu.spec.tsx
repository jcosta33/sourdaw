import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { bounceTrack } from '../../../useCases/freezeBounce/bounceTrack';
import { saveTrackAsTemplate } from '../../../useCases/saveTrackAsTemplate';
import { TrackContextMenu } from '../TrackContextMenu';

// Mock external dependencies
vi.mock('../../../useCases/removeTrack', () => ({
    removeTrack: vi.fn(),
}));

vi.mock('../../../useCases/toggleTrackState/toggleSoloSafe', () => ({
    toggleSoloSafe: vi.fn(),
}));

vi.mock('../../../useCases/clip/addClip', () => ({
    addClip: vi.fn(),
}));

vi.mock('../../../useCases/renameTrack', () => ({
    renameTrack: vi.fn(),
}));

vi.mock('../../../useCases/freezeBounce/unfreezeTrack', () => ({
    unfreezeTrack: vi.fn(),
}));

vi.mock('../../../useCases/freezeBounce/freezeTrack', () => ({
    freezeTrack: vi.fn(),
}));

vi.mock('../../../useCases/freezeBounce/bounceTrack', () => ({
    bounceTrack: vi.fn(),
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

vi.mock('../../../useCases/saveTrackAsTemplate', () => ({
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

vi.mock('#/utils/UI/useContextMenuDismiss', () => ({
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
    freezeState: { status: 'unfrozen' as const },
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
        expect(screen.getByText('Bounce...')).toBeInTheDocument();
    });

    it('should submit the default bounce options for the current track', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div>Track Content</div>
            </TrackContextMenu>
        );

        fireEvent.contextMenu(screen.getByText('Track Content'));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Bounce...' }));

        const dialog = screen.getByRole('dialog', { name: 'Bounce Test Track' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Render' }));

        expect(vi.mocked(bounceTrack)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(bounceTrack)).toHaveBeenCalledWith('track1', {
            includeInserts: true,
            includeSends: false,
            includeAutomation: true,
            normalization: 'protection',
            tailHandling: 'auto',
            destination: 'new-track',
        });
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

    it('should save the current track as a template', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        const track = screen.getByTestId('track');
        fireEvent.contextMenu(track);

        fireEvent.click(screen.getByText('Save as Template'));

        expect(vi.mocked(saveTrackAsTemplate)).toHaveBeenCalledWith('track1', 'Test Track');
    });
});
