import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '#/components/ui/tooltip';
import { TrackHeader } from './TrackHeader';

// Import mocked functions
import { selectTrack } from '../../useCases/toggleTrackState/selectTrack';
import { toggleFolderCollapse } from '../../useCases/folder';
import { setInputMonitoring } from '../../useCases/setTrackGainPan';

// Mock external dependencies
vi.mock('../../useCases/toggleTrackState/muteTrack', () => ({
    muteTrack: vi.fn(),
}));

vi.mock('../../useCases/toggleTrackState/soloTrack', () => ({
    soloTrack: vi.fn(),
}));

vi.mock('../../useCases/toggleTrackState/soloTrackExclusive', () => ({
    soloTrackExclusive: vi.fn(),
}));

vi.mock('../../useCases/toggleTrackState/selectTrack', () => ({
    selectTrack: vi.fn(),
}));

vi.mock('../../useCases/recording', () => ({
    armTrack: vi.fn(),
}));

vi.mock('../../useCases/folder', () => ({
    toggleFolderCollapse: vi.fn(),
}));

vi.mock('../../useCases/setTrackGainPan', () => ({
    setInputMonitoring: vi.fn(),
}));

vi.mock('./TrackContextMenu', () => ({
    TrackContextMenu: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('./TrackHeader/InlineTrackName', () => ({
    InlineTrackName: ({ track }: any) => <span>{track.name}</span>,
}));

vi.mock('./TrackHeader/ResizeHandle', () => ({
    ResizeHandle: () => <div data-testid="resize-handle" />,
}));

vi.mock('./TrackHeader/InputSelector', () => ({
    InputSelector: () => <div data-testid="input-selector" />,
}));

vi.mock('./TrackHeader/TrackLevelIndicator', () => ({
    TrackLevelIndicator: () => <div data-testid="level-indicator" />,
}));

vi.mock('./TrackHeader/LevainLoadingSpinner', () => ({
    LevainLoadingSpinner: () => null,
}));

const mockTrack = {
    id: 'track1',
    name: 'Test Track',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    frozen: false,
    collapsed: false,
    color: '#ff0000',
    inputMonitoring: 'auto',
    inputId: null,
    parentId: null,
    height: 64,
    devices: [],
};

const mockFolderTrack = {
    id: 'folder1',
    name: 'Folder Track',
    kind: 'folder',
    muted: false,
    soloed: false,
    armed: false,
    frozen: false,
    collapsed: false,
    color: '#00ff00',
    inputMonitoring: 'auto',
    inputId: null,
    parentId: null,
    height: 26,
    devices: [],
};

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('TrackHeader', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        const { container } = renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render track name', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        expect(screen.getByText('Test Track')).toBeInTheDocument();
    });

    it('should have correct role and aria attributes', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        const row = screen.getByRole('row');
        expect(row).toHaveAttribute('aria-selected', 'false');
    });

    it('should show aria-selected true when selected', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={true} />);
        const row = screen.getByRole('row');
        expect(row).toHaveAttribute('aria-selected', 'true');
    });

    it('should call selectTrack when clicked', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        const row = screen.getByRole('row');
        fireEvent.click(row);
        expect(selectTrack).toHaveBeenCalledWith('track1');
    });

    it('should render Mute button', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        expect(screen.getByLabelText(/Mute/)).toBeInTheDocument();
    });

    it('should render Solo button', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        expect(screen.getByLabelText(/Solo/)).toBeInTheDocument();
    });

    it('should render Arm button', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        expect(screen.getByLabelText(/Arm/)).toBeInTheDocument();
    });

    it('should render folder track differently', () => {
        renderWithTooltip(<TrackHeader track={mockFolderTrack} isSelected={false} />);
        expect(screen.getByLabelText(/folder/i)).toBeInTheDocument();
    });

    it('should toggle folder collapse', () => {
        renderWithTooltip(<TrackHeader track={mockFolderTrack} isSelected={false} />);
        const collapseButton = screen.getByLabelText(/folder/i);
        fireEvent.click(collapseButton);
        expect(toggleFolderCollapse).toHaveBeenCalledWith('folder1');
    });

    it('should show frozen indicator when frozen', () => {
        const frozenTrack = { ...mockTrack, frozen: true };
        renderWithTooltip(<TrackHeader track={frozenTrack} isSelected={false} />);
        expect(screen.getByText('FRZ')).toBeInTheDocument();
    });

    it('should render InputSelector for selected audio track', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={true} />);
        expect(screen.getByTestId('input-selector')).toBeInTheDocument();
    });

    it('should render level indicator', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        expect(screen.getByTestId('level-indicator')).toBeInTheDocument();
    });

    it('should render resize handle', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        expect(screen.getByTestId('resize-handle')).toBeInTheDocument();
    });

    it('should cycle input monitoring on click', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        const monitorButton = screen.getByLabelText(/Input monitoring/);
        fireEvent.click(monitorButton);
        expect(setInputMonitoring).toHaveBeenCalledWith('track1', 'on');
    });
});
