import type { ReactNode } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { voiceInputAvailabilityStore, voiceStatusStore } from '#/modules/AiRuntime/stores';
import { trackStore } from '#/modules/Arrangement/stores';
import { togglePlayback } from '#/modules/Transport/useCases';

import { TransportBar } from '../TransportBar';

const voiceRuntimeMocks = vi.hoisted(() => ({
    isVoiceInputAvailable: vi.fn<() => boolean>(),
    toggleVoiceInput: vi.fn<() => void>(),
}));

// Mock hooks
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn<typeof useStore>(),
}));

vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiRuntime/useCases')>()),
    isVoiceInputAvailable: voiceRuntimeMocks.isVoiceInputAvailable,
    toggleVoiceInput: voiceRuntimeMocks.toggleVoiceInput,
}));

const transportState = vi.hoisted(() => ({
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    overdubEnabled: false,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    punchInEnabled: false,
    countInEnabled: false,
    countInBars: 1,
    tempo: 120,
    timeSignatureNumerator: 4,
    playheadPosition: 0,
}));
const transportMock = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/useTransportState', () => ({
    useTransportState: transportMock.mockReturnValue(transportState),
}));

const audioState = vi.hoisted(() => ({ isRecording: false }));
const audioMock = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useAudioRecordingState', () => ({
    useAudioRecordingState: audioMock.mockReturnValue(audioState),
}));

const undoState = vi.hoisted(() => ({ canUndo: false, canRedo: false }));
const undoMock = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useUndoState', () => ({
    useUndoState: undoMock.mockReturnValue(undoState),
}));

const projectState = vi.hoisted(() => ({ name: 'Test', dirty: false }));
const projectMock = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useProjectState', () => ({
    useProjectState: projectMock.mockReturnValue(projectState),
}));

vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    togglePlayback: vi.fn<typeof togglePlayback>(),
}));

// Mock child components
vi.mock('../Transport/PlayheadDisplay', () => ({
    PlayheadDisplay: () => <div data-testid="playhead-display">0:0:0</div>,
}));

vi.mock('../Transport/AutoScrollToggle', () => ({
    AutoScrollToggle: () => <button data-testid="autoscroll-toggle">AutoScroll</button>,
}));

vi.mock('../Transport/PanelToggles', () => ({
    PanelToggles: () => (
        <div data-testid="panel-toggles">
            <button data-testid="panel-toggle-button">Toggle</button>
        </div>
    ),
}));

vi.mock('../Transport/WindowControls', () => ({
    WindowControls: () => <div data-testid="window-controls" />,
}));

const windowChromeMocks = vi.hoisted(() => ({
    frameless: false,
    minimize: vi.fn<() => Promise<void>>(),
    toggleMaximize: vi.fn<() => Promise<boolean>>(),
    close: vi.fn<() => Promise<void>>(),
    isMaximized: vi.fn<() => Promise<boolean>>(),
    listenMaximized: vi.fn<(callback: (maximized: boolean) => void) => () => void>(),
}));

vi.mock('#/modules/WorkspaceShell/useCases/windowChrome', () => ({
    windowChromeControls: () => ({
        frameless: windowChromeMocks.frameless,
        minimize: windowChromeMocks.minimize,
        toggleMaximize: windowChromeMocks.toggleMaximize,
        close: windowChromeMocks.close,
        isMaximized: windowChromeMocks.isMaximized,
        listenMaximized: windowChromeMocks.listenMaximized,
    }),
}));

vi.mock('#/modules/TimelineEditor/presentations/views', () => ({
    TempoEditor: () => <div data-testid="tempo-editor">Tempo</div>,
}));

// Spread `importOriginal` first: an exhaustive factory resolves any export added
// to the barrel later to `undefined`, and the transport bar renders these, so the
// whole file reds. That is exactly what #1392 did to this spec when Project
// gained `MissingMediaPanel` — a WorkspaceShell red for a Project-only diff.
vi.mock('#/modules/Project/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/presentations/views')>()),
    RecentProjectsMenu: () => <div data-testid="recent-projects" />,
    ArrangementSelector: () => <div data-testid="arrangement-selector" />,
    MissingMediaPanel: () => <div data-testid="missing-media-panel" />,
}));

vi.mock('#/modules/PunchRecording/presentations/views', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/PunchRecording/presentations/views')>()),
    PunchRecordingControls: () => <div data-testid="punch-recording" />,
}));

vi.mock('../PromptBar', () => ({
    PromptBar: () => <div data-testid="prompt-bar" />,
}));

vi.mock('#/components/daw/DawInlineHint', () => ({
    DawInlineHint: ({ children }: { children: ReactNode }) => <div data-testid="inline-hint">{children}</div>,
}));

let voiceStatus = { isListening: false, transcribing: false };
let voiceInputAvailable = false;

describe('TransportBar', () => {
    beforeEach(() => {
        voiceStatus = { isListening: false, transcribing: false };
        voiceInputAvailable = false;
        voiceRuntimeMocks.isVoiceInputAvailable.mockClear();
        voiceRuntimeMocks.toggleVoiceInput.mockClear();
        voiceRuntimeMocks.isVoiceInputAvailable.mockReturnValue(false);
        windowChromeMocks.frameless = false;
        windowChromeMocks.toggleMaximize.mockClear();
        windowChromeMocks.toggleMaximize.mockResolvedValue(true);
        // Reset the hoisted hook return-values to defaults after clearAllMocks.
        transportState.isRecording = false;
        transportState.isPlaying = false;
        undoState.canUndo = false;
        undoState.canRedo = false;
        projectState.name = 'Test';
        projectState.dirty = false;
        vi.mocked(useStore).mockImplementation((store, defaultValue) => {
            if (store === voiceStatusStore) {
                return voiceStatus;
            }
            if (store === voiceInputAvailabilityStore) {
                return { hasVerifiedLocalModel: voiceInputAvailable };
            }
            // Return the caller's defaultValue so workspaceState/undo/etc. get
            // their proper defaults; override per-test via the trackStore check.
            return defaultValue ?? {};
        });
    });

    const renderTransportBar = () =>
        render(
            <TooltipProvider delayDuration={0}>
                <TransportBar />
            </TooltipProvider>
        );

    it('should render correctly', () => {
        const { container } = render(<TransportBar />);
        expect(container.firstChild).toBeTruthy();
    });

    it('provides the integrated desktop title-bar drag region', () => {
        renderTransportBar();

        expect(screen.getByTestId('window-titlebar-region')).toHaveClass('desktop-titlebar-region');
    });

    it('marks the titlebar row as the frameless drag region and mounts the window controls', () => {
        windowChromeMocks.frameless = true;
        renderTransportBar();

        expect(screen.getByTestId('window-titlebar-region')).toHaveClass('desktop-titlebar-region--frameless');
        expect(screen.getByTestId('window-controls')).toBeInTheDocument();
    });

    it('toggles maximize on a double-click on the titlebar row itself', () => {
        windowChromeMocks.frameless = true;
        renderTransportBar();

        fireEvent.doubleClick(screen.getByTestId('window-titlebar-region'));

        expect(windowChromeMocks.toggleMaximize).toHaveBeenCalledTimes(1);
    });

    it('does not toggle maximize when the double-click lands on an interactive element', () => {
        windowChromeMocks.frameless = true;
        renderTransportBar();

        fireEvent.doubleClick(screen.getByTestId('panel-toggle-button'));

        expect(windowChromeMocks.toggleMaximize).not.toHaveBeenCalled();
    });

    it('should show play button', () => {
        render(<TransportBar />);
        expect(screen.getByRole('button', { name: /Play/i })).toBeInTheDocument();
    });

    it('should call togglePlay when play button is clicked', () => {
        render(<TransportBar />);
        const playButton = screen.getByRole('button', { name: /Play/i });
        fireEvent.click(playButton);
        expect(togglePlayback).toHaveBeenCalled();
    });

    it('hides VoiceButton before AiRuntime verifies a local model', () => {
        renderTransportBar();

        expect(screen.queryByRole('button', { name: /Voice command/ })).not.toBeInTheDocument();
    });

    it('passes the native browser event through the voice-button admission seam', () => {
        voiceInputAvailable = true;
        voiceStatus = { isListening: false, transcribing: true };

        renderTransportBar();

        const voiceButton = screen.getByRole('button', { name: 'Stop voice command' });
        expect(voiceButton).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(voiceButton);

        expect(voiceRuntimeMocks.toggleVoiceInput).toHaveBeenCalledWith(expect.any(Event));
    });

    it('applies the recording background styling when transport is recording', () => {
        transportState.isRecording = true;
        renderTransportBar();

        const header = screen.getByRole('toolbar', { name: 'Transport controls' });
        // Recording header uses a red-tinted gradient (the load-bearing styling branch).
        expect(header.style.background).toContain('255, 64, 50');
        expect(header.style.borderTop).toContain('255, 64, 50');
    });

    it('applies the neutral background styling when not recording', () => {
        transportState.isRecording = false;
        renderTransportBar();

        const header = screen.getByRole('toolbar', { name: 'Transport controls' });
        // Non-recording header uses a neutral white-tinted gradient.
        expect(header.style.background).toContain('255, 255, 255');
        expect(header.style.borderTop).toContain('255, 255, 255');
    });

    it('derives showOverdub from armed midi tracks and surfaces the overdub control', () => {
        // An armed MIDI track must make the overdub control visible (showOverdub=true).
        vi.mocked(useStore).mockImplementation((store, defaultValue) => {
            if (store === voiceStatusStore) {
                return voiceStatus;
            }
            if (store === trackStore) {
                return {
                    tracks: [{ id: 't1', armed: true, kind: 'midi' }],
                    selectedTrackId: null,
                };
            }
            return defaultValue ?? {};
        });

        renderTransportBar();

        expect(screen.getByRole('button', { name: /overdub/i })).toBeInTheDocument();
    });

    it('hides the overdub control when only audio tracks are armed', () => {
        vi.mocked(useStore).mockImplementation((store, defaultValue) => {
            if (store === voiceStatusStore) {
                return voiceStatus;
            }
            if (store === trackStore) {
                return {
                    tracks: [{ id: 't1', armed: true, kind: 'audio' }],
                    selectedTrackId: null,
                };
            }
            return defaultValue ?? {};
        });

        renderTransportBar();

        // showOverdub requires an armed MIDI track; audio-only → no overdub control.
        expect(screen.queryByRole('button', { name: /overdub/i })).not.toBeInTheDocument();
    });

    it('hides the overdub control when no tracks are armed', () => {
        renderTransportBar();

        expect(screen.queryByRole('button', { name: /overdub/i })).not.toBeInTheDocument();
    });

    it('forwards undo availability into the undo button (disabled when nothing to undo)', () => {
        undoState.canUndo = false;

        renderTransportBar();

        // The undo button is present but disabled when canUndo is false.
        const undoButton = screen.getByRole('button', { name: /undo/i });
        expect(undoButton).toBeDisabled();
    });

    it('enables the undo button when canUndo is true', () => {
        undoState.canUndo = true;

        renderTransportBar();

        const undoButton = screen.getByRole('button', { name: /undo/i });
        expect(undoButton).not.toBeDisabled();
    });

    it('forwards project name and dirty state into ProjectName', () => {
        projectState.name = 'Custom Song';
        projectState.dirty = true;

        renderTransportBar();

        expect(screen.getByText('Custom Song')).toBeInTheDocument();
        expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument();
    });
});
