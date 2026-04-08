import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClipContextMenu } from './ClipContextMenu';

// Mock external dependencies
vi.mock('#/modules/Workspace/stores/workspaceStore', () => ({
    workspaceStore: { value: { selectedClipIds: [] } },
}));

vi.mock('#/modules/Workspace/useCases/togglePanel/panelToggles', () => ({
    selectClip: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: { value: { tracks: [] } },
}));

vi.mock('../../useCases/timelineViewActions', () => ({
    setWorkspaceMode: vi.fn(),
    splitClipWithUndo: vi.fn(),
    normalizeClip: vi.fn(),
    reverseClip: vi.fn(),
    lockClip: vi.fn(),
    setClipColor: vi.fn(),
    renameClip: vi.fn(),
    muteClip: vi.fn(),
    removeClip: vi.fn(),
    duplicateClip: vi.fn(),
    duplicateClipToNextBar: vi.fn(),
    copySelectedClip: vi.fn(),
    cutSelectedClip: vi.fn(),
    pasteClip: vi.fn(),
    detectTempo: vi.fn(),
    detectKey: vi.fn(),
    stripSilence: vi.fn(),
    exportMidiClip: vi.fn(),
    executeAppAction: vi.fn(),
}));

vi.mock('#/helpers/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases/runAiActionWithToast', () => ({
    runAiActionWithToast: vi.fn(),
}));

vi.mock('#/helpers/UI/useContextMenuDismiss', () => ({
    useContextMenuDismiss: vi.fn(),
}));

const mockClip = {
    id: 'clip1',
    name: 'Test Clip',
    type: 'audio',
    muted: false,
    locked: false,
    color: '',
    audioBufferId: 'buffer1',
};

vi.mocked(vi.importMock('#/modules/Arrangement/stores/trackStore').trackStore).value = {
    tracks: [{ id: 'track1', clips: [mockClip] }],
};

describe('ClipContextMenu', () => {
    const mockOnClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(
            <ClipContextMenu
                x={100}
                y={100}
                clipId="clip1"
                splitBeat={8}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('should render menu buttons', () => {
        render(
            <ClipContextMenu
                x={100}
                y={100}
                clipId="clip1"
                splitBeat={8}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('Edit Clip')).toBeInTheDocument();
        expect(screen.getByText('Rename Clip')).toBeInTheDocument();
        expect(screen.getByText('Split at Cursor')).toBeInTheDocument();
    });

    it('should call onClose when menu item is clicked', () => {
        const { setWorkspaceMode } = vi.importMock('#/modules/Arrangement/useCases/timelineViewActions');
        render(
            <ClipContextMenu
                x={100}
                y={100}
                clipId="clip1"
                splitBeat={8}
                onClose={mockOnClose}
            />
        );
        const editButton = screen.getByText('Edit Clip');
        fireEvent.click(editButton);
        expect(mockOnClose).toHaveBeenCalled();
        expect(setWorkspaceMode).toHaveBeenCalledWith('clip');
    });

    it('should render audio-specific actions for audio clips', () => {
        render(
            <ClipContextMenu
                x={100}
                y={100}
                clipId="clip1"
                splitBeat={8}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('Normalize')).toBeInTheDocument();
        expect(screen.getByText('Reverse')).toBeInTheDocument();
        expect(screen.getByText('Strip Silence')).toBeInTheDocument();
        expect(screen.getByText('Detect Tempo')).toBeInTheDocument();
        expect(screen.getByText('Detect Key')).toBeInTheDocument();
    });

    it('should render mute/unmute button', () => {
        render(
            <ClipContextMenu
                x={100}
                y={100}
                clipId="clip1"
                splitBeat={8}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('Mute Clip')).toBeInTheDocument();
    });

    it('should render lock/unlock button', () => {
        render(
            <ClipContextMenu
                x={100}
                y={100}
                clipId="clip1"
                splitBeat={8}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('Lock Clip')).toBeInTheDocument();
    });

    it('should render color picker', () => {
        render(
            <ClipContextMenu
                x={100}
                y={100}
                clipId="clip1"
                splitBeat={8}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('Color')).toBeInTheDocument();
    });

    it('should render delete button', () => {
        render(
            <ClipContextMenu
                x={100}
                y={100}
                clipId="clip1"
                splitBeat={8}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('should have correct positioning style', () => {
        const { container } = render(
            <ClipContextMenu
                x={150}
                y={200}
                clipId="clip1"
                splitBeat={8}
                onClose={mockOnClose}
            />
        );
        const menu = container.firstChild as HTMLElement;
        expect(menu).toHaveStyle({ left: '150px', top: '200px' });
    });

    it('should show multi-select info when multiple clips selected', () => {
        vi.mocked(vi.importMock('#/modules/Workspace/stores/workspaceStore').workspaceStore).value = {
            selectedClipIds: ['clip1', 'clip2', 'clip3'],
        };
        render(
            <ClipContextMenu
                x={100}
                y={100}
                clipId="clip1"
                splitBeat={8}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('3 clips selected')).toBeInTheDocument();
    });
});
