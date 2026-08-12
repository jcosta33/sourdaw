import { type ReactElement, type ReactNode } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { normalizeTrack } from '../../../models/Track';
import { setScrollY } from '../../../stores/timelineViewStore';
import { selectTrack } from '../../../useCases/toggleTrackState/selectTrack';
import { useTracks } from '../../hooks/useTracks';
import { TrackListView } from '../TrackListView';

type TrackHeaderMockProps = {
    track: {
        id: string;
        name: string;
    };
    isSelected: boolean;
};

type HeaderBandMockProps = {
    children: ReactNode;
    actions: ReactNode;
};

type EmptyStateMockProps = {
    title: string;
    description: string;
};

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(function useStoreMock<Value>(_store: unknown, defaultValue: Value): Value {
        return defaultValue;
    }),
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
    TrackHeader: ({ track, isSelected }: TrackHeaderMockProps): ReactElement => (
        <div data-testid={`track-${track.id}`} data-selected={isSelected}>
            {track.name}
        </div>
    ),
}));

vi.mock('../MiniMasterSpectrum', () => ({
    MiniMasterSpectrum: () => <div data-testid="master-spectrum">Master</div>,
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ children, actions }: HeaderBandMockProps): ReactElement => (
        <div data-testid="header-band">
            {children}
            {actions}
        </div>
    ),
}));

vi.mock('#/components/daw/DawEmptyState', () => ({
    DawEmptyState: ({ title, description }: EmptyStateMockProps): ReactElement => (
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

vi.mock('#/modules/Preferences/stores', () => ({
    preferencesStore: {},
}));

vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: {
        getSnapshot: () => ({ scrollX: 0, scrollY: 0, pixelsPerBeat: 12, autoScrollEnabled: true }),
        subscribeReact: () => () => {},
    },
    setScrollY: vi.fn(),
    setTimelineViewportHeight: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    injectPromptCommand: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
}));

vi.mock('#/modules/WorkspaceShell/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/WorkspaceShell/useCases')>()),
    setWorkspaceMode: vi.fn(),
}));

vi.mock('#/modules/Preferences/useCases', () => ({
    defaultPreferences: { trackHeight: 'normal' },
    setTrackHeight: vi.fn(),
}));

vi.mock('#/utils/Notification/confirmUser', () => ({
    confirmUser: vi.fn(),
}));

vi.mock('../../../useCases/getTrackTemplates', () => ({
    getTrackTemplates: vi.fn(() => []),
}));

vi.mock('../../../useCases/loadTrackTemplate', () => ({
    loadTrackTemplate: vi.fn(),
}));

vi.mock('../TakeLanesView', () => ({
    TakeLanePanel: () => null,
}));

const renderWithTooltip = (ui: ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('TrackListView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset mock to default state
        const mockedUseTracks = vi.mocked(useTracks);
        mockedUseTracks.mockReturnValue({
            tracks: [
                normalizeTrack({
                    id: 't1',
                    name: 'Track 1',
                    kind: 'audio',
                    parentId: null,
                    collapsed: false,
                    height: 64,
                }),
                normalizeTrack({
                    id: 't2',
                    name: 'Track 2',
                    kind: 'midi',
                    parentId: null,
                    collapsed: false,
                    height: 64,
                }),
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
                normalizeTrack({
                    id: 't1',
                    name: 'Track 1',
                    kind: 'audio',
                    parentId: null,
                    collapsed: false,
                    height: 64,
                }),
                normalizeTrack({
                    id: 't2',
                    name: 'Track 2',
                    kind: 'midi',
                    parentId: null,
                    collapsed: false,
                    height: 64,
                }),
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

    it('coalesces a burst of scroll events to one store write per frame (finding #49)', () => {
        // Capture rAF callbacks so we can flush exactly one frame manually.
        const rafCallbacks: FrameRequestCallback[] = [];
        const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });

        const { container } = renderWithTooltip(<TrackListView />);
        const scrollEl = container.querySelector('.overflow-y-auto') as HTMLElement;

        // Three scroll events before any frame flushes — should schedule once
        // and write nothing until the frame runs.
        fireEvent.scroll(scrollEl);
        fireEvent.scroll(scrollEl);
        fireEvent.scroll(scrollEl);
        expect(setScrollY).not.toHaveBeenCalled();
        expect(rafCallbacks.length).toBe(1);

        // Flushing the scheduled frame writes exactly once.
        rafCallbacks[0]?.(0);
        expect(setScrollY).toHaveBeenCalledTimes(1);

        rafSpy.mockRestore();
    });

    it('selects the first track on ArrowDown when nothing is selected', () => {
        const mockedUseTracks = vi.mocked(useTracks);
        mockedUseTracks.mockReturnValue({
            tracks: [
                normalizeTrack({ id: 't1', name: 'A', kind: 'audio', parentId: null, collapsed: false, height: 64 }),
                normalizeTrack({ id: 't2', name: 'B', kind: 'midi', parentId: null, collapsed: false, height: 64 }),
            ],
            selectedTrackId: null,
        });
        renderWithTooltip(<TrackListView />);
        fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowDown' });
        expect(selectTrack).toHaveBeenCalledWith('t1');
    });

    it('selects the last track on ArrowUp when nothing is selected', () => {
        const mockedUseTracks = vi.mocked(useTracks);
        mockedUseTracks.mockReturnValue({
            tracks: [
                normalizeTrack({ id: 't1', name: 'A', kind: 'audio', parentId: null, collapsed: false, height: 64 }),
                normalizeTrack({ id: 't2', name: 'B', kind: 'midi', parentId: null, collapsed: false, height: 64 }),
            ],
            selectedTrackId: null,
        });
        renderWithTooltip(<TrackListView />);
        fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowUp' });
        expect(selectTrack).toHaveBeenCalledWith('t2');
    });

    it('does nothing on ArrowDown at the last track', () => {
        const mockedUseTracks = vi.mocked(useTracks);
        mockedUseTracks.mockReturnValue({
            tracks: [
                normalizeTrack({ id: 't1', name: 'A', kind: 'audio', parentId: null, collapsed: false, height: 64 }),
                normalizeTrack({ id: 't2', name: 'B', kind: 'midi', parentId: null, collapsed: false, height: 64 }),
            ],
            selectedTrackId: 't2',
        });
        renderWithTooltip(<TrackListView />);
        fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowDown' });
        expect(selectTrack).not.toHaveBeenCalled();
    });

    it('enters clip mode on Enter when a track is selected', async () => {
        const { setWorkspaceMode } = await import('#/modules/WorkspaceShell/useCases');
        renderWithTooltip(<TrackListView />);
        fireEvent.keyDown(screen.getByRole('grid'), { key: 'Enter' });
        expect(setWorkspaceMode).toHaveBeenCalledWith('clip');
    });

    it('removes the selected track on Delete after user confirmation', async () => {
        const { removeTrack } = await import('../../../useCases/removeTrack');
        const { executeAppAction } = await import('#/modules/Command/useCases');
        const { confirmUser } = await import('#/utils/Notification/confirmUser');
        vi.mocked(confirmUser).mockResolvedValue(true);
        renderWithTooltip(<TrackListView />);
        fireEvent.keyDown(screen.getByRole('grid'), { key: 'Delete' });
        // confirmUser is async; flush microtasks.
        await Promise.resolve();
        await Promise.resolve();
        // The Delete key takes the undoable `removeTrack` action, not the bare
        // use case, which captures no inverse (audit M-015). The end-to-end
        // undo is asserted in `trackDeleteUndo.integration.spec.tsx`.
        expect(executeAppAction).toHaveBeenCalledWith({ type: 'removeTrack', payload: { trackId: 't1' } });
        expect(removeTrack).not.toHaveBeenCalled();
    });

    it('keeps the track when the user cancels deletion', async () => {
        const { removeTrack } = await import('../../../useCases/removeTrack');
        const { executeAppAction } = await import('#/modules/Command/useCases');
        const { confirmUser } = await import('#/utils/Notification/confirmUser');
        vi.mocked(confirmUser).mockResolvedValue(false);
        renderWithTooltip(<TrackListView />);
        fireEvent.keyDown(screen.getByRole('grid'), { key: 'Backspace' });
        await Promise.resolve();
        await Promise.resolve();
        expect(removeTrack).not.toHaveBeenCalled();
        expect(executeAppAction).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'removeTrack' }));
    });

    it('reorders a track via drag and drop', async () => {
        const { reorderTrack } = await import('../../../useCases/toggleTrackState/reorderTrack');
        const { container } = renderWithTooltip(<TrackListView />);
        const rows = container.querySelectorAll('[role="row"]');
        const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
        // Drag the second row onto the first.
        fireEvent.dragStart(rows[1]!, { dataTransfer });
        fireEvent.dragOver(rows[0]!, { dataTransfer });
        fireEvent.drop(rows[0]!, { dataTransfer });

        expect(reorderTrack).toHaveBeenCalledWith('t2', 0);
    });

    it('cycles track height on the height button click', async () => {
        const { setTrackHeight } = await import('#/modules/Preferences/useCases');
        renderWithTooltip(<TrackListView />);
        fireEvent.click(screen.getByLabelText(/Track height/));
        // 'normal' -> next in [compact, normal, large] = 'large'.
        expect(setTrackHeight).toHaveBeenCalledWith('large');
    });

    it('creates a folder on the add-folder button click', async () => {
        const { createFolder } = await import('../../../useCases/folder/createFolder');
        renderWithTooltip(<TrackListView />);
        fireEvent.click(screen.getByLabelText('Add folder'));
        expect(createFolder).toHaveBeenCalledWith('Folder 1');
    });

    it('injects the auto-organize prompt on the AI button click', async () => {
        const { injectPromptCommand } = await import('#/modules/AiRuntime/useCases');
        renderWithTooltip(<TrackListView />);
        fireEvent.click(screen.getByLabelText('Auto-organize with AI'));
        expect(injectPromptCommand).toHaveBeenCalledWith(expect.stringContaining('Auto-organize'));
    });

    it('hides children of a collapsed folder from the visible list', () => {
        const mockedUseTracks = vi.mocked(useTracks);
        mockedUseTracks.mockReturnValue({
            tracks: [
                normalizeTrack({
                    id: 'f1',
                    name: 'Folder',
                    kind: 'folder',
                    parentId: null,
                    collapsed: true,
                    height: 26,
                }),
                normalizeTrack({
                    id: 'child',
                    name: 'Child',
                    kind: 'audio',
                    parentId: 'f1',
                    collapsed: false,
                    height: 64,
                }),
            ],
            selectedTrackId: null,
        });
        renderWithTooltip(<TrackListView />);
        expect(screen.getByTestId('track-f1')).toBeInTheDocument();
        expect(screen.queryByTestId('track-child')).not.toBeInTheDocument();
    });

    it('hides the master track from the visible list', () => {
        const mockedUseTracks = vi.mocked(useTracks);
        mockedUseTracks.mockReturnValue({
            tracks: [
                normalizeTrack({ id: 't1', name: 'A', kind: 'audio', parentId: null, collapsed: false, height: 64 }),
                normalizeTrack({
                    id: 'master',
                    name: 'Master',
                    kind: 'master',
                    parentId: null,
                    collapsed: false,
                    height: 64,
                }),
            ],
            selectedTrackId: 't1',
        });
        renderWithTooltip(<TrackListView />);
        expect(screen.getByTestId('track-t1')).toBeInTheDocument();
        expect(screen.queryByTestId('track-master')).not.toBeInTheDocument();
    });
});
