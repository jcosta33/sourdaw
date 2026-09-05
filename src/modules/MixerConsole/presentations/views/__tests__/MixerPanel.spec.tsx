import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MixerPanel } from '../MixerPanel';

// Mock hooks
type MockMixerTrack = { id: string; kind: string; name: string };

const trackMocks = vi.hoisted(() => ({
    useTracks: vi.fn<() => { tracks: MockMixerTrack[]; selectedTrackId: string | null }>(() => ({
        tracks: [
            { id: 'track-1', kind: 'audio', name: 'Audio 1' },
            { id: 'track-2', kind: 'midi', name: 'Midi 1' },
        ],
        selectedTrackId: 'track-1',
    })),
}));

vi.mock('../../hooks/useTracks', () => ({
    useTracks: trackMocks.useTracks,
}));

vi.mock('../../hooks/useWorkspaceState', () => ({
    useWorkspaceState: vi.fn(() => ({
        channelStripWidth: 'normal',
    })),
}));

// Mock useCases
vi.mock('#/modules/WorkspaceShell/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/WorkspaceShell/useCases')>()),
    cycleChannelStripWidth: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    restoreMixerChannels: vi.fn(),
    renameMixerSnapshot: vi.fn(),
    deleteMixerSnapshot: vi.fn(),
    getMixerSnapshots: vi.fn(() => [{ id: 'snap-1', name: 'Snapshot 1' }]),
    recallMixerSnapshot: vi.fn(),
    saveMixerSnapshot: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
    pushUndoEntry: vi.fn(),
}));

// Mock child components
vi.mock('../Mixer/ExpandedChannelStrip', () => ({
    ExpandedChannelStrip: ({ track }: { track: { id: string; name: string } }) => (
        <div data-testid={`channel-strip-${track.id}`}>{track.name}</div>
    ),
}));

vi.mock('../Mixer/MasterChannelStrip', () => ({
    MasterChannelStrip: () => <div data-testid="master-channel-strip">Master</div>,
}));

vi.mock('../Mixer/MixHealthDialog', () => ({
    MixHealthDialog: ({ open }: { open: boolean }) => <div data-testid="mix-health-dialog" data-open={open} />,
}));

describe('MixerPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render all channel strips and master', () => {
        render(<MixerPanel />);
        expect(screen.getByTestId('channel-strip-track-1')).toBeInTheDocument();
        expect(screen.getByTestId('channel-strip-track-2')).toBeInTheDocument();
        expect(screen.getByTestId('master-channel-strip')).toBeInTheDocument();
    });

    it('should call cycleChannelStripWidth on width button click', async () => {
        render(<MixerPanel />);
        const widthButton = screen.getByLabelText(/Channel width:/);
        fireEvent.click(widthButton);

        const { cycleChannelStripWidth } = await import('#/modules/WorkspaceShell/useCases');
        expect(cycleChannelStripWidth).toHaveBeenCalled();
    });

    it('should show and hide snapshots panel', async () => {
        render(<MixerPanel />);
        const snapshotsButton = screen.getByLabelText('Recall mixer snapshot');

        fireEvent.click(snapshotsButton);
        expect(screen.getByText('Snapshot 1')).toBeInTheDocument();

        // Click save snapshot
        const saveButton = screen.getByLabelText('Save mixer snapshot');
        fireEvent.click(saveButton);

        const { saveMixerSnapshot } = await import('#/modules/Arrangement/useCases');
        expect(saveMixerSnapshot).toHaveBeenCalled();
    });

    // The global shortcut layer gates Delete / Backspace on
    // closest('[role="menu"]') (#3618): without a menu-role ancestor a Delete
    // from inside the open dropdown deletes the arrangement clips behind it.
    it('snapshot options sit inside a [role="menu"] surface', () => {
        render(<MixerPanel />);
        fireEvent.click(screen.getByLabelText('Recall mixer snapshot'));

        expect(screen.getByText('Snapshot 1').closest('[role="menu"]')).not.toBeNull();
    });

    it('should render correct title based on track count', () => {
        render(<MixerPanel />);
        expect(screen.getByText(/Mixer - 2 channels/i)).toBeInTheDocument();
    });

    it('should push an undo entry that restores prior state and redoes the recall', async () => {
        const { recallMixerSnapshot, restoreMixerChannels } = await import('#/modules/Arrangement/useCases');
        const { pushUndoEntry } = await import('#/modules/Command/useCases');
        const previousState = [{ trackId: 'track-1', gain: 0.8, pan: 0, muted: false, soloed: false }];
        let capturedUndo: (() => void) | undefined;
        let capturedRedo: (() => unknown) | undefined;
        vi.mocked(recallMixerSnapshot).mockReturnValueOnce(previousState);
        vi.mocked(pushUndoEntry).mockImplementationOnce((_label, undoFn, redoFn) => {
            capturedUndo = undoFn;
            capturedRedo = redoFn;
        });

        render(<MixerPanel />);
        fireEvent.click(screen.getByLabelText('Recall mixer snapshot'));
        fireEvent.click(screen.getByText('Snapshot 1'));

        expect(pushUndoEntry).toHaveBeenCalledWith('Recall mixer snapshot', expect.any(Function), expect.any(Function));
        expect(screen.queryByText('Snapshot 1')).not.toBeInTheDocument();

        capturedUndo?.();
        expect(restoreMixerChannels).toHaveBeenCalledWith(previousState);

        capturedRedo?.();
        expect(recallMixerSnapshot).toHaveBeenCalledWith('snap-1');
    });

    it('should delete a snapshot and refresh the snapshot list', async () => {
        const { deleteMixerSnapshot, getMixerSnapshots } = await import('#/modules/Arrangement/useCases');

        render(<MixerPanel />);
        fireEvent.click(screen.getByLabelText('Recall mixer snapshot'));
        fireEvent.click(screen.getByLabelText('Delete Snapshot 1'));

        expect(deleteMixerSnapshot).toHaveBeenCalledWith('snap-1');
        expect(getMixerSnapshots).toHaveBeenCalledTimes(2);
    });

    it('should commit a trimmed rename on blur and exit edit mode', async () => {
        const { renameMixerSnapshot, getMixerSnapshots } = await import('#/modules/Arrangement/useCases');

        render(<MixerPanel />);
        fireEvent.click(screen.getByLabelText('Recall mixer snapshot'));
        fireEvent.click(screen.getByLabelText('Rename Snapshot 1'));

        const input = screen.getByDisplayValue('Snapshot 1');
        fireEvent.blur(input, { target: { value: '  Drum bus  ' } });

        expect(renameMixerSnapshot).toHaveBeenCalledWith('snap-1', 'Drum bus');
        expect(getMixerSnapshots).toHaveBeenCalledTimes(2);
        expect(screen.queryByDisplayValue('Snapshot 1')).not.toBeInTheDocument();
    });

    it('should discard a rename when the trimmed name is blank', async () => {
        const { renameMixerSnapshot } = await import('#/modules/Arrangement/useCases');

        render(<MixerPanel />);
        fireEvent.click(screen.getByLabelText('Recall mixer snapshot'));
        fireEvent.click(screen.getByLabelText('Rename Snapshot 1'));

        const input = screen.getByDisplayValue('Snapshot 1');
        fireEvent.blur(input, { target: { value: '   ' } });

        expect(renameMixerSnapshot).not.toHaveBeenCalled();
        expect(screen.getByText('Snapshot 1')).toBeInTheDocument();
    });

    it('should commit rename when Enter is pressed', async () => {
        const { renameMixerSnapshot } = await import('#/modules/Arrangement/useCases');

        render(<MixerPanel />);
        fireEvent.click(screen.getByLabelText('Recall mixer snapshot'));
        fireEvent.click(screen.getByLabelText('Rename Snapshot 1'));

        const input = screen.getByDisplayValue('Snapshot 1');
        fireEvent.change(input, { target: { value: 'Vocal bus' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(renameMixerSnapshot).toHaveBeenCalledWith('snap-1', 'Vocal bus');
    });

    it('should cancel rename without committing when Escape is pressed', async () => {
        const { renameMixerSnapshot } = await import('#/modules/Arrangement/useCases');

        render(<MixerPanel />);
        fireEvent.click(screen.getByLabelText('Recall mixer snapshot'));
        fireEvent.click(screen.getByLabelText('Rename Snapshot 1'));

        const input = screen.getByDisplayValue('Snapshot 1');
        fireEvent.change(input, { target: { value: 'Vocal bus' } });
        fireEvent.keyDown(input, { key: 'Escape' });

        expect(renameMixerSnapshot).not.toHaveBeenCalled();
        // Escape also bubbles to the document-level dismiss listener, which closes the whole panel.
        expect(screen.queryByText('Snapshot 1')).not.toBeInTheDocument();
    });

    it('should open the mix health dialog when the AI button is clicked', () => {
        render(<MixerPanel />);
        expect(screen.getByTestId('mix-health-dialog')).toHaveAttribute('data-open', 'false');

        fireEvent.click(screen.getByLabelText('AI Mix Health Analysis'));

        expect(screen.getByTestId('mix-health-dialog')).toHaveAttribute('data-open', 'true');
    });

    it('should exclude folder tracks from channel strips and the header count', () => {
        trackMocks.useTracks.mockReturnValueOnce({
            tracks: [
                { id: 'track-1', kind: 'audio', name: 'Audio 1' },
                { id: 'folder-1', kind: 'folder', name: 'Folder 1' },
            ],
            selectedTrackId: 'track-1',
        });

        render(<MixerPanel />);

        expect(screen.getByTestId('channel-strip-track-1')).toBeInTheDocument();
        expect(screen.queryByTestId('channel-strip-folder-1')).not.toBeInTheDocument();
        expect(screen.getByText(/Mixer - 1 channels/i)).toBeInTheDocument();
    });

    it('should render the blocked state when there are no tracks', () => {
        trackMocks.useTracks.mockReturnValueOnce({ tracks: [], selectedTrackId: null });

        render(<MixerPanel />);

        expect(screen.getByText('No tracks in the oven yet')).toBeInTheDocument();
    });

    it('should close the snapshots panel when clicking outside it', () => {
        render(<MixerPanel />);
        fireEvent.click(screen.getByLabelText('Recall mixer snapshot'));
        expect(screen.getByText('Snapshot 1')).toBeInTheDocument();

        fireEvent.mouseDown(document.body);

        expect(screen.queryByText('Snapshot 1')).not.toBeInTheDocument();
    });
});
