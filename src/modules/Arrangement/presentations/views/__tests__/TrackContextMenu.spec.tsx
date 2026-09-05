import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectTransitionAuthority } from '#/modules/Project/useCases';
import { confirmUser } from '#/utils/Notification/confirmUser';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { addClip } from '../../../useCases/clip/addClip';
import { duplicateTrack } from '../../../useCases/duplicateTrack';
import { bounceTrack } from '../../../useCases/freezeBounce/bounceTrack';
import { flattenTrack } from '../../../useCases/freezeBounce/flattenTrack';
import { freezeTrack } from '../../../useCases/freezeBounce/freezeTrack';
import { unfreezeTrack } from '../../../useCases/freezeBounce/unfreezeTrack';
import { importAudioClipToTrack } from '../../../useCases/importAudioClipToTrack';
import { importMidiFile } from '../../../useCases/importMidiFile';
import { removeTrack } from '../../../useCases/removeTrack';
import { renameTrack } from '../../../useCases/renameTrack';
import { saveTrackAsTemplate } from '../../../useCases/saveTrackAsTemplate';
import { setInputMonitoring } from '../../../useCases/setTrackGainPan/setInputMonitoring';
import { setTrackColor } from '../../../useCases/setTrackGainPan/setTrackColor';
import { TrackContextMenu } from '../TrackContextMenu';

// Mock external dependencies
vi.mock('../../../useCases/removeTrack', () => ({
    removeTrack: vi.fn(),
}));

vi.mock('../../../useCases/freezeBounce/flattenTrack', () => ({
    flattenTrack: vi.fn(),
}));

vi.mock('#/utils/Notification/confirmUser', () => ({
    confirmUser: vi.fn(),
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

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
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

const transition = vi.hoisted(() => ({ current: true }));
vi.mock('#/modules/Project/useCases', () => ({
    captureProjectTransitionAuthority: vi.fn(() => ({ isCurrent: () => transition.current })),
}));

vi.mock('#/utils/UI/useContextMenuDismiss', () => ({
    useContextMenuDismiss: vi.fn(),
}));

const mockTrack = TrackDummy.create({
    id: 'track1',
    name: 'Test Track',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    frozen: false,
    freezeState: { status: 'unfrozen' },
    soloSafe: false,
    color: '#ff0000',
    inputMonitoring: 'auto',
    inputId: null,
    parentId: null,
    height: 64,
});

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('TrackContextMenu', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        transition.current = true;
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

    it('adds a midi clip when the track kind is midi', () => {
        const midiTrack = TrackDummy.create({ id: 'midi1', kind: 'midi' });
        renderWithTooltip(
            <TrackContextMenu track={midiTrack}>
                <div data-testid="track">MIDI</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Add Clip'));
        expect(vi.mocked(addClip)).toHaveBeenCalledTimes(1);
        const arg = vi.mocked(addClip).mock.calls[0]![0];
        expect(arg.type).toBe('midi');
        expect(arg.trackId).toBe('midi1');
    });

    it('unfreezes a frozen track and offers Flatten Track', () => {
        const frozenTrack = TrackDummy.create({
            id: 'fz1',
            frozen: true,
            freezeState: { status: 'frozen' },
        });
        renderWithTooltip(
            <TrackContextMenu track={frozenTrack}>
                <div data-testid="track">Frozen</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        // Frozen → label is "Unfreeze".
        fireEvent.click(screen.getByText('Unfreeze'));
        expect(vi.mocked(unfreezeTrack)).toHaveBeenCalledWith('fz1');
    });

    it('shows Update Freeze label when the freeze state is stale', () => {
        const staleTrack = TrackDummy.create({
            id: 'stale1',
            frozen: true,
            freezeState: { status: 'stale' },
        });
        renderWithTooltip(
            <TrackContextMenu track={staleTrack}>
                <div data-testid="track">Stale</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        expect(screen.getByText('Update Freeze')).toBeInTheDocument();
    });

    it('flattens a frozen track via the Flatten Track item', () => {
        const frozenTrack = TrackDummy.create({
            id: 'fz2',
            frozen: true,
            freezeState: { status: 'frozen' },
        });
        renderWithTooltip(
            <TrackContextMenu track={frozenTrack}>
                <div data-testid="track">Frozen</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Flatten Track'));
        expect(vi.mocked(flattenTrack)).toHaveBeenCalledWith('fz2');
    });

    it('deletes the track after confirming', async () => {
        vi.mocked(confirmUser).mockResolvedValue(true);
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Delete Track'));
        // confirmUser is awaited inside an async IIFE. The delete goes through
        // the undoable `removeTrack` action, not the bare use case: the use
        // case captures no inverse, so the menu's delete was unrecoverable
        // (audit M-015). `trackDeleteUndo.integration.spec.tsx` asserts the
        // resulting undo end-to-end.
        await vi.waitFor(() => {
            expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledWith({
                type: 'removeTrack',
                payload: { trackId: 'track1' },
            });
        });
        expect(vi.mocked(removeTrack)).not.toHaveBeenCalled();
    });

    it('does not delete the track when the confirm dialog is cancelled', async () => {
        vi.mocked(confirmUser).mockResolvedValue(false);
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Delete Track'));
        await vi.waitFor(() => {
            expect(vi.mocked(confirmUser)).toHaveBeenCalled();
        });
        expect(vi.mocked(removeTrack)).not.toHaveBeenCalled();
        expect(vi.mocked(executeUserAppAction)).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'removeTrack' })
        );
    });

    it('commits a rename with the trimmed name', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Rename'));
        const input = screen.getByDisplayValue('Test Track');
        fireEvent.change(input, { target: { value: '  Renamed  ' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(vi.mocked(renameTrack)).toHaveBeenCalledWith('track1', 'Renamed');
    });

    it('does not rename when the submitted value is blank', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Rename'));
        const input = screen.getByDisplayValue('Test Track');
        fireEvent.change(input, { target: { value: '   ' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(vi.mocked(renameTrack)).not.toHaveBeenCalled();
    });

    it('applies the selected input monitoring value', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText(/Input Monitor:/));
        // Pick the "On" option (mockTrack defaults to 'auto').
        fireEvent.click(screen.getByRole('menuitem', { name: 'On' }));
        expect(vi.mocked(setInputMonitoring)).toHaveBeenCalledWith('track1', 'on');
    });

    it('imports a selected audio file into the track', async () => {
        vi.mocked(importAudioClipToTrack).mockResolvedValue('completed');
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Import Audio...'));
        const fileInputs = Array.from(document.querySelectorAll('input[type=file]')) as HTMLInputElement[];
        const audioInput = fileInputs.find((i) => i.accept === 'audio/*')!;
        const file = new File(['data'], 'clip.wav', { type: 'audio/wav' });
        Object.defineProperty(audioInput, 'files', { value: [file], configurable: true });
        fireEvent.change(audioInput);
        await vi.waitFor(() => {
            expect(vi.mocked(importAudioClipToTrack)).toHaveBeenCalledWith('track1', file, {
                shouldContinue: expect.any(Function),
            });
        });
    });

    it('imports a selected MIDI file', async () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Import MIDI...'));
        const fileInputs = Array.from(document.querySelectorAll('input[type=file]')) as HTMLInputElement[];
        const midiInput = fileInputs.find((i) => i.accept.includes('.mid'))!;
        const file = new File(['data'], 'song.mid', { type: 'audio/midi' });
        Object.defineProperty(midiInput, 'files', { value: [file], configurable: true });
        fireEvent.change(midiInput);
        await vi.waitFor(() => {
            expect(vi.mocked(importMidiFile)).toHaveBeenCalledWith(file, { shouldContinue: expect.any(Function) });
        });
    });

    it('does not decode a selected audio file after the initiating project changes', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Import Audio...'));
        transition.current = false;
        const audioInput = Array.from(document.querySelectorAll('input[type=file]')).find(
            (input) => (input as HTMLInputElement).accept === 'audio/*'
        ) as HTMLInputElement;
        Object.defineProperty(audioInput, 'files', {
            value: [new File(['data'], 'stale.wav', { type: 'audio/wav' })],
            configurable: true,
        });

        fireEvent.change(audioInput);

        expect(importAudioClipToTrack).not.toHaveBeenCalled();
        expect(captureProjectTransitionAuthority).toHaveBeenCalledTimes(1);
    });

    it('applies a color from the color picker', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Track Color...'));
        const swatches = screen.getAllByRole('button', { name: 'Set color' });
        fireEvent.click(swatches[0]!);
        expect(vi.mocked(setTrackColor)).toHaveBeenCalledWith('track1', expect.any(String));
    });

    it('routes disarming through the canonical AppAction write path', () => {
        const armedTrack = TrackDummy.create({ id: 'arm1', armed: true });
        renderWithTooltip(
            <TrackContextMenu track={armedTrack}>
                <div data-testid="track">Armed</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Disarm'));
        expect(vi.mocked(executeUserAppAction)).toHaveBeenCalledWith({
            type: 'armTrack',
            payload: { trackId: 'arm1', armed: false },
        });
    });

    it('freezes an unfrozen track', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Freeze'));
        expect(vi.mocked(freezeTrack)).toHaveBeenCalledWith('track1');
    });

    it('duplicates the track', () => {
        renderWithTooltip(
            <TrackContextMenu track={mockTrack}>
                <div data-testid="track">Track Content</div>
            </TrackContextMenu>
        );
        fireEvent.contextMenu(screen.getByTestId('track'));
        fireEvent.click(screen.getByText('Duplicate Track'));
        expect(vi.mocked(duplicateTrack)).toHaveBeenCalledWith('track1');
    });
});
