import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '#/components/ui/tooltip';
import { TrackListView } from '../TrackListView';
import { selectTrack } from '../../../useCases/toggleTrackState/selectTrack';
import { useTracks } from '../../hooks/useTracks';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

vi.mock('../../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({
        tracks: [
            { id: 't1', name: 'Track 1', kind: 'audio', parentId: null, collapsed: false, height: 64 },
            { id: 't2', name: 'Track 2', kind: 'midi', parentId: null, collapsed: false, height: 64 },
        ],
        selectedTrackId: 't1',
    })),
}));

vi.mock('../TrackHeader', () => ({
    TrackHeader: ({ track, isSelected }: any) => (
        <div data-testid={`track-${track.id}`} data-selected={isSelected}>
            {track.name}
        </div>
    ),
}));

vi.mock('../MiniMasterSpectrum', () => ({
    MiniMasterSpectrum: () => <div data-testid="master-spectrum">Master</div>,
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ children, actions }: any) => (
        <div data-testid="header-band">
            {children}
            {actions}
        </div>
    ),
}));

vi.mock('#/components/daw/DawEmptyState', () => ({
    DawEmptyState: ({ title, description }: any) => (
        <div data-testid="empty-state">
            <div>{title}</div>
            <div>{description}</div>
        </div>
    ),
}));

vi.mock('../../../useCases/addTrack', () => ({
    addTrack: vi.fn(),
}));

vi.mock('../../../useCases/folder/createFolder', () => ({
    createFolder: vi.fn(),
}));

vi.mock('../../../useCases/toggleTrackState/reorderTrack', () => ({
    reorderTrack: vi.fn(),
}));

vi.mock('../../../useCases/toggleTrackState/selectTrack', () => ({
    selectTrack: vi.fn(),
}));

vi.mock('../../../useCases/removeTrack', () => ({
    removeTrack: vi.fn(),
}));

vi.mock('../../../useCases/trackViewActions/setWorkspaceMode', () => ({
    setWorkspaceMode: vi.fn(),
}));

vi.mock('#/modules/Workspace/stores/preferencesStore', () => ({
    preferencesStore: {},
}));

vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: {},
    setScrollY: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases/promptInjection', () => ({
    injectPromptCommand: vi.fn(),
}));

vi.mock('#/modules/Workspace/useCases/workspaceQueries/helpers', () => ({
    defaultPreferences: { trackHeight: 'normal' },
}));

vi.mock('#/modules/Workspace/useCases/setTrackHeight', () => ({
    setTrackHeight: vi.fn(),
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('TrackListView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset mock to default state
        const mockedUseTracks = vi.mocked(useTracks);
        mockedUseTracks.mockReturnValue({
            tracks: [
                { id: 't1', name: 'Track 1', kind: 'audio', parentId: null, collapsed: false, height: 64 },
                { id: 't2', name: 'Track 2', kind: 'midi', parentId: null, collapsed: false, height: 64 },
            ],
            selectedTrackId: 't1',
        });
    });

    it('should render without crashing', () => {
        const { container } = renderWithTooltip(<TrackListView />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render track headers', () => {
        renderWithTooltip(<TrackListView />);
        expect(screen.getByTestId('track-t1')).toBeInTheDocument();
        expect(screen.getByTestId('track-t2')).toBeInTheDocument();
    });

    it('should render master spectrum in header', () => {
        renderWithTooltip(<TrackListView />);
        expect(screen.getByTestId('master-spectrum')).toBeInTheDocument();
    });

    it('should have correct track grid role', () => {
        renderWithTooltip(<TrackListView />);
        expect(screen.getByRole('grid')).toHaveAttribute('aria-label', 'Track list');
    });

    it('should render rows with correct aria-selected', () => {
        renderWithTooltip(<TrackListView />);
        expect(screen.getByTestId('track-t1')).toHaveAttribute('data-selected', 'true');
        expect(screen.getByTestId('track-t2')).toHaveAttribute('data-selected', 'false');
    });

    it('should call selectTrack when track is clicked', () => {
        renderWithTooltip(<TrackListView />);
        const track = screen.getByTestId('track-t2');
        fireEvent.click(track);
        expect(selectTrack).toHaveBeenCalledWith('t2');
    });

    it('should handle keyboard navigation with ArrowDown', () => {
        renderWithTooltip(<TrackListView />);
        const grid = screen.getByRole('grid');
        fireEvent.keyDown(grid, { key: 'ArrowDown' });
        expect(selectTrack).toHaveBeenCalled();
    });

    it('should handle keyboard navigation with ArrowUp', () => {
        // Reset mock to verify ArrowUp doesn't throw
        const mockedUseTracks = vi.mocked(useTracks);
        mockedUseTracks.mockReturnValue({
            tracks: [
                { id: 't1', name: 'Track 1', kind: 'audio', parentId: null, collapsed: false, height: 64 },
                { id: 't2', name: 'Track 2', kind: 'midi', parentId: null, collapsed: false, height: 64 },
            ],
            selectedTrackId: 't2', // Start from t2 so ArrowUp can select t1
        });
        renderWithTooltip(<TrackListView />);
        const grid = screen.getByRole('grid');
        fireEvent.keyDown(grid, { key: 'ArrowUp' });
        // ArrowUp from t2 should call selectTrack with t1
        expect(selectTrack).toHaveBeenCalled();
    });

    it('should show empty state when no tracks', () => {
        const mockedUseTracks = vi.mocked(useTracks);
        mockedUseTracks.mockReturnValue({ tracks: [], selectedTrackId: null });
        renderWithTooltip(<TrackListView />);
        expect(screen.getByTestId('empty-state')).toBeInTheDocument();
        expect(screen.getByText('No tracks yet')).toBeInTheDocument();
    });

    it('should apply custom style', () => {
        const customStyle = { width: 200 };
        const { container } = renderWithTooltip(<TrackListView style={customStyle} />);
        expect(container.firstChild).toHaveStyle({ width: '200px' });
    });

    it('should have correct height class', () => {
        const { container } = renderWithTooltip(<TrackListView />);
        expect(container.firstChild).toHaveClass('h-full');
    });

    it('should have border styling', () => {
        const { container } = renderWithTooltip(<TrackListView />);
        expect(container.firstChild).toHaveClass('border-r');
    });
});
