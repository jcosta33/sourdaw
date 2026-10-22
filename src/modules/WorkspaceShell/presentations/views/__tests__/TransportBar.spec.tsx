import type { ReactNode } from 'react';

import { act, cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { voiceInputAvailabilityStore, voiceStatusStore } from '#/modules/AiRuntime/stores';
import { type Clip, type Track, clipSelectionStore, trackStore } from '#/modules/Arrangement/stores';
import {
    clearClipSelection,
    hydrateTracksForProject,
    setMarqueeSelection,
    setTrackState,
} from '#/modules/Arrangement/useCases';
import { togglePlayback } from '#/modules/Transport/useCases';
import { selectorDeclaring } from '#/styles/testing/mainStylesheetRules';

import { defaultWorkspaceState } from '../../../models/WorkspaceState';
import { workspaceStore } from '../../../stores/workspaceStore';
import { TransportBar } from '../TransportBar';

const voiceRuntimeMocks = vi.hoisted(() => ({
    isVoiceInputAvailable: vi.fn<() => boolean>(),
    toggleVoiceInput: vi.fn<() => void>(),
    downloadWhisperModel: vi.fn<(options?: { downloadConsent?: boolean }) => Promise<void>>(),
}));

// Mock hooks
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn<typeof useStore>(),
}));

vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiRuntime/useCases')>()),
    isVoiceInputAvailable: voiceRuntimeMocks.isVoiceInputAvailable,
    toggleVoiceInput: voiceRuntimeMocks.toggleVoiceInput,
    downloadWhisperModel: voiceRuntimeMocks.downloadWhisperModel,
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
            <button data-testid="panel-toggle-button">
                <svg data-testid="panel-toggle-icon" />
                Toggle
            </button>
        </div>
    ),
}));

vi.mock('../Transport/WindowControls', () => ({
    WindowControls: () => <div data-testid="window-controls" />,
}));

const windowChromeMocks = vi.hoisted(() => ({
    frameless: false,
    windowControlsOverlay: false,
    minimize: vi.fn<() => Promise<void>>(),
    toggleMaximize: vi.fn<() => Promise<boolean>>(),
    close: vi.fn<() => Promise<void>>(),
    isMaximized: vi.fn<() => Promise<boolean>>(),
    listenMaximized: vi.fn<(callback: (maximized: boolean) => void) => () => void>(),
}));

vi.mock('#/modules/WorkspaceShell/useCases/windowChrome', () => ({
    windowChromeControls: () => ({
        frameless: windowChromeMocks.frameless,
        windowControlsOverlay: windowChromeMocks.windowControlsOverlay,
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
    // Shaped like the inline popups this row really hosts: an open surface that
    // announces itself by ARIA role, whose rows and labels are plain divs. That
    // shape is what the row's drag region has to leave clickable.
    ArrangementSelector: () => (
        <div data-testid="arrangement-selector">
            <div role="menu" aria-label="Arrangement menu">
                <div data-testid="arrangement-menu-label">Arrangements</div>
            </div>
        </div>
    ),
    MissingMediaPanel: () => <div data-testid="missing-media-panel" />,
}));

vi.mock('#/modules/PunchRecording/presentations/views', async (importOriginal) => {
    const { Popover, PopoverContent, PopoverTrigger } = await import('#/components/ui/popover');
    return {
        ...(await importOriginal<typeof import('#/modules/PunchRecording/presentations/views')>()),
        PunchRecordingControls: ({ compact = false }: { compact?: boolean }) => (
            <div data-testid="punch-recording" data-compact={compact ? 'true' : 'false'}>
                <Popover>
                    <PopoverTrigger asChild>
                        <button type="button" aria-label="Punch recording settings">
                            Punch recording settings
                        </button>
                    </PopoverTrigger>
                    <PopoverContent
                        aria-label="Punch recording settings"
                        onEscapeKeyDown={(event) => {
                            event.preventDefault();
                        }}
                    >
                        Punch recording settings
                    </PopoverContent>
                </Popover>
            </div>
        ),
    };
});

vi.mock('../PromptBar', () => ({
    PromptBar: () => <div data-testid="prompt-bar" />,
}));

vi.mock('#/components/daw/DawInlineHint', () => ({
    DawInlineHint: ({ children }: { children: ReactNode }) => <div data-testid="inline-hint">{children}</div>,
}));

let voiceStatus = { isListening: false, transcribing: false };
let voiceInputAvailable = false;

/*
 * Taken from `main.css` rather than written out here: the modifier class the row
 * renders is inert in jsdom, so only the shipped selector can say whether the
 * window still hands that row to the drag region and insets it past the
 * platform's own controls.
 */
const DRAG_REGION_SELECTOR = selectorDeclaring('app-region', 'drag');
const TITLEBAR_INSET_SELECTOR = selectorDeclaring('margin-left', 'env(titlebar-area-x, 0px)');
const VIEWPORT_FULL_WIDTH = 1440;
const VIEWPORT_COMPACT_WIDTH = 1024;

const setViewportWidth = (width: number): void => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
};

const makeBrowseTrack = (id: string, name: string, clipId: string, clipName: string): Track => {
    const clip: Clip = {
        id: clipId,
        trackId: id,
        name: clipName,
        type: 'midi',
        startBeat: 0,
        endBeat: 4,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
    return {
        id,
        name,
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [clip],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 64,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: `${id}-alternative`,
        alternatives: [{ id: `${id}-alternative`, name: 'Main', clips: [clip] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
};

describe('TransportBar', () => {
    beforeEach(() => {
        voiceStatus = { isListening: false, transcribing: false };
        voiceInputAvailable = false;
        voiceRuntimeMocks.isVoiceInputAvailable.mockClear();
        voiceRuntimeMocks.toggleVoiceInput.mockClear();
        voiceRuntimeMocks.downloadWhisperModel.mockClear();
        voiceRuntimeMocks.downloadWhisperModel.mockResolvedValue(undefined);
        voiceRuntimeMocks.isVoiceInputAvailable.mockReturnValue(false);
        windowChromeMocks.frameless = false;
        windowChromeMocks.windowControlsOverlay = false;
        windowChromeMocks.toggleMaximize.mockClear();
        windowChromeMocks.toggleMaximize.mockResolvedValue(true);
        // Reset the hoisted hook return-values to defaults after clearAllMocks.
        transportState.isRecording = false;
        transportState.isPlaying = false;
        undoState.canUndo = false;
        undoState.canRedo = false;
        projectState.name = 'Test';
        projectState.dirty = false;
        setViewportWidth(VIEWPORT_FULL_WIDTH);
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
                <TransportBar onReviewRun={() => undefined} />
            </TooltipProvider>
        );

    describe('timeline clip browsing', () => {
        let restoreBrowseFixture: (() => void) | null = null;

        beforeEach(() => {
            const originalTracks = trackStore.value;
            const originalSelection = clipSelectionStore.value;
            const originalWorkspace = workspaceStore.value;
            if (originalTracks === null || originalSelection === null) {
                throw new Error('Browse fixtures require initialized Arrangement stores');
            }
            expect(originalSelection.selectedClipId).toBeNull();
            expect(originalSelection.selectedClipIds).toEqual([]);
            restoreBrowseFixture = () => {
                setTrackState(originalTracks);
                clearClipSelection();
                setMarqueeSelection(originalSelection.marqueeSelection);
                workspaceStore.set(originalWorkspace);
            };
            hydrateTracksForProject({
                tracks: [
                    makeBrowseTrack('voice', 'Voice', 'verse', 'Verse'),
                    makeBrowseTrack('drums', 'Drums', 'fill', 'Fill'),
                ],
            });
            clearClipSelection();
            setMarqueeSelection(null);
            workspaceStore.set({ ...defaultWorkspaceState, mode: 'arrange', trackListOpen: true });
            vi.mocked(useStore).mockImplementation((store, defaultValue) => {
                if (store === trackStore) {
                    return trackStore.value;
                }
                if (store === workspaceStore) {
                    return workspaceStore.value;
                }
                if (store === voiceStatusStore) {
                    return voiceStatus;
                }
                if (store === voiceInputAvailabilityStore) {
                    return { hasVerifiedLocalModel: voiceInputAvailable };
                }
                return defaultValue ?? {};
            });
        });

        afterEach(() => {
            cleanup();
            restoreBrowseFixture?.();
            restoreBrowseFixture = null;
        });

        it.each([VIEWPORT_FULL_WIDTH, VIEWPORT_COMPACT_WIDTH])(
            'opens a real clip listbox for named clips on distinct visible tracks at width %s',
            async (width) => {
                setViewportWidth(width);
                workspaceStore.set({ ...defaultWorkspaceState, trackListOpen: false });
                renderTransportBar();
                const browse = screen.getByRole('button', { name: 'Browse timeline clips' });
                expect(browse).toBeVisible();
                expect(screen.getAllByRole('button', { name: 'Browse timeline clips' })).toHaveLength(1);
                expect(browse.closest('.transport-bar__action-right')).toBeInTheDocument();
                fireEvent.click(browse);

                const listbox = screen.getByRole('listbox', { name: 'Timeline clips' });
                expect(listbox).toBeVisible();
                expect(within(listbox).getByRole('option', { name: /Verse, Voice/ })).toBeInTheDocument();
                expect(within(listbox).getByRole('option', { name: /Fill, Drums/ })).toBeInTheDocument();
                await waitFor(() => expect(listbox).toHaveFocus());
                fireEvent.keyDown(listbox, { key: ' ' });
                expect(clipSelectionStore.value?.selectedClipIds).toEqual(['verse']);
                expect(within(listbox).getByRole('option', { name: /Verse, Voice/ })).toHaveAttribute(
                    'aria-selected',
                    'true'
                );
                expect(screen.getByRole('status')).toHaveTextContent('Selected Verse, Voice');
                fireEvent.keyDown(listbox, { key: 'Escape' });
                await waitFor(() =>
                    expect(screen.queryByRole('listbox', { name: 'Timeline clips' })).not.toBeInTheDocument()
                );
                expect(browse).toHaveFocus();
            }
        );

        it('keeps the same Browse trigger, active option and focused listbox across compact mode changes', async () => {
            renderTransportBar();
            const browse = screen.getByRole('button', { name: 'Browse timeline clips' });
            fireEvent.click(browse);
            const listbox = screen.getByRole('listbox', { name: 'Timeline clips' });
            await waitFor(() => expect(listbox).toHaveFocus());
            fireEvent.keyDown(listbox, { key: 'End' });
            fireEvent.keyDown(listbox, { key: ' ' });
            const activeId = listbox.getAttribute('aria-activedescendant');
            expect(activeId).toBeTruthy();
            expect(clipSelectionStore.value?.selectedClipIds).toEqual(['fill']);

            setViewportWidth(VIEWPORT_COMPACT_WIDTH);
            act(() => window.dispatchEvent(new Event('resize')));
            expect(screen.getByRole('button', { name: 'Browse timeline clips' })).toBe(browse);
            expect(screen.getByRole('listbox', { name: 'Timeline clips' })).toBe(listbox);
            expect(listbox).toHaveAttribute('aria-activedescendant', activeId);
            expect(listbox).toHaveFocus();
            expect(clipSelectionStore.value?.selectedClipIds).toEqual(['fill']);
            expect(screen.getByRole('button', { name: 'More transport controls' })).toHaveAttribute(
                'aria-expanded',
                'false'
            );
            fireEvent.keyDown(listbox, { key: 'Escape' });
            await waitFor(() => expect(browse).toHaveFocus());
            setViewportWidth(VIEWPORT_FULL_WIDTH);
            act(() => window.dispatchEvent(new Event('resize')));
            expect(screen.getByRole('button', { name: 'Browse timeline clips' })).toBe(browse);
            expect(browse).toHaveFocus();
            expect(screen.getAllByRole('button', { name: 'Browse timeline clips' })).toHaveLength(1);
        });

        it('claims Browse activation keys locally while leaving native activation and other keys intact', () => {
            renderTransportBar();
            const browse = screen.getByRole('button', { name: 'Browse timeline clips' });
            const windowKeydown = vi.fn<(event: KeyboardEvent) => void>();
            window.addEventListener('keydown', windowKeydown);
            try {
                expect(fireEvent.keyDown(browse, { key: 'Enter' })).toBe(true);
                expect(fireEvent.keyDown(browse, { key: ' ' })).toBe(true);
                expect(windowKeydown).not.toHaveBeenCalled();
                fireEvent.keyDown(browse, { key: 'Tab' });
                expect(windowKeydown).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key: 'Tab' }));
            } finally {
                window.removeEventListener('keydown', windowKeydown);
            }
        });

        it('keeps Browse and More as sibling disclosures with their own Escape focus return', async () => {
            setViewportWidth(VIEWPORT_COMPACT_WIDTH);
            renderTransportBar();
            const browse = screen.getByRole('button', { name: 'Browse timeline clips' });
            const more = screen.getByRole('button', { name: 'More transport controls' });
            fireEvent.click(more);
            expect(screen.getByRole('dialog', { name: 'More transport controls' })).toBeInTheDocument();
            fireEvent.click(browse);
            const listbox = screen.getByRole('listbox', { name: 'Timeline clips' });
            await waitFor(() => expect(listbox).toHaveFocus());
            expect(more).toHaveAttribute('aria-expanded', 'false');
            expect(screen.queryByRole('dialog', { name: 'More transport controls' })).not.toBeInTheDocument();
            fireEvent.keyDown(listbox, { key: 'Escape' });
            await waitFor(() => expect(browse).toHaveFocus());

            fireEvent.click(browse);
            await waitFor(() => expect(screen.getByRole('listbox', { name: 'Timeline clips' })).toHaveFocus());
            fireEvent.click(more);
            expect(screen.queryByRole('listbox', { name: 'Timeline clips' })).not.toBeInTheDocument();
            const moreDialog = screen.getByRole('dialog', { name: 'More transport controls' });
            await waitFor(() => expect(moreDialog.contains(document.activeElement)).toBe(true));
            fireEvent.keyDown(moreDialog, { key: 'Escape' });
            await waitFor(() => expect(more).toHaveFocus());
            expect(browse).toHaveAttribute('aria-expanded', 'false');
        });

        it('preserves outside focus when the Browse disclosure dismisses', async () => {
            renderTransportBar();
            fireEvent.click(screen.getByRole('button', { name: 'Browse timeline clips' }));
            await waitFor(() => expect(screen.getByRole('listbox', { name: 'Timeline clips' })).toHaveFocus());
            const outside = document.createElement('button');
            outside.textContent = 'Outside action';
            document.body.appendChild(outside);
            try {
                act(() => outside.focus());
                await waitFor(() =>
                    expect(screen.queryByRole('listbox', { name: 'Timeline clips' })).not.toBeInTheDocument()
                );
                expect(outside).toHaveFocus();
            } finally {
                outside.remove();
            }
        });

        it('disposes Browse when the actual timeline becomes unavailable rather than reopening stale state', async () => {
            const rendered = renderTransportBar();
            fireEvent.click(screen.getByRole('button', { name: 'Browse timeline clips' }));
            await waitFor(() => expect(screen.getByRole('listbox', { name: 'Timeline clips' })).toHaveFocus());
            workspaceStore.set({ ...defaultWorkspaceState, mode: 'automation' });
            rendered.rerender(
                <TooltipProvider>
                    <TransportBar onReviewRun={() => undefined} />
                </TooltipProvider>
            );
            expect(screen.queryByRole('button', { name: 'Browse timeline clips' })).not.toBeInTheDocument();
            expect(screen.queryByRole('listbox', { name: 'Timeline clips' })).not.toBeInTheDocument();
            workspaceStore.set({ ...defaultWorkspaceState, mode: 'clip' });
            rendered.rerender(
                <TooltipProvider>
                    <TransportBar onReviewRun={() => undefined} />
                </TooltipProvider>
            );
            expect(screen.getByRole('button', { name: 'Browse timeline clips' })).toHaveAttribute(
                'aria-expanded',
                'false'
            );
            hydrateTracksForProject({ tracks: [] });
            rendered.rerender(
                <TooltipProvider>
                    <TransportBar onReviewRun={() => undefined} />
                </TooltipProvider>
            );
            expect(screen.queryByRole('button', { name: 'Browse timeline clips' })).not.toBeInTheDocument();
        });
    });

    it('should render correctly', () => {
        const { container } = render(<TransportBar onReviewRun={() => undefined} />);
        expect(container.firstChild).toBeTruthy();
    });

    it('provides the integrated desktop title-bar drag region', () => {
        renderTransportBar();

        expect(screen.getByTestId('window-titlebar-region')).toHaveClass('desktop-titlebar-region');
    });

    it('leaves the titlebar row draggable by nothing when the shell runs neither desktop chrome', () => {
        renderTransportBar();

        const region = screen.getByTestId('window-titlebar-region');
        expect(region.matches(DRAG_REGION_SELECTOR)).toBe(false);
        expect(region.matches(TITLEBAR_INSET_SELECTOR)).toBe(false);
    });

    it('marks the titlebar row as the frameless drag region and mounts the window controls', () => {
        windowChromeMocks.frameless = true;
        renderTransportBar();

        const region = screen.getByTestId('window-titlebar-region');
        expect(region).toHaveClass('desktop-titlebar-region--frameless');
        expect(region.matches(DRAG_REGION_SELECTOR)).toBe(true);
        // Linux draws its own controls inside the row, so nothing insets it.
        expect(region.matches(TITLEBAR_INSET_SELECTOR)).toBe(false);
        expect(screen.getByTestId('window-controls')).toBeInTheDocument();
    });

    it('insets the titlebar row past the overlaid native controls and mounts none of its own', () => {
        windowChromeMocks.windowControlsOverlay = true;
        renderTransportBar();

        const region = screen.getByTestId('window-titlebar-region');
        expect(region.matches(TITLEBAR_INSET_SELECTOR)).toBe(true);
        expect(region.matches(DRAG_REGION_SELECTOR)).toBe(true);
        // The traffic lights are the platform's own; the app draws none.
        expect(screen.queryByTestId('window-controls')).not.toBeInTheDocument();
    });

    it('leaves a double-click on the overlaid titlebar row to the operating system', () => {
        windowChromeMocks.windowControlsOverlay = true;
        renderTransportBar();

        fireEvent.doubleClick(screen.getByTestId('window-titlebar-region'));

        expect(windowChromeMocks.toggleMaximize).not.toHaveBeenCalled();
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

    it('does not toggle maximize when the double-click lands on an interactive SVG child', () => {
        windowChromeMocks.frameless = true;
        renderTransportBar();

        fireEvent.doubleClick(screen.getByTestId('panel-toggle-icon'));

        expect(windowChromeMocks.toggleMaximize).not.toHaveBeenCalled();
    });

    it('does not toggle maximize when the double-click lands inside an open popup in the row', () => {
        windowChromeMocks.frameless = true;
        renderTransportBar();

        // A menu label is a plain div: only the surface around it marks the
        // click as the menu's rather than the window's, so resizing the window
        // out from under an open menu is the regression this pins.
        fireEvent.doubleClick(screen.getByTestId('arrangement-menu-label'));

        expect(windowChromeMocks.toggleMaximize).not.toHaveBeenCalled();
    });

    it('should show play button', () => {
        render(<TransportBar onReviewRun={() => undefined} />);
        expect(screen.getByRole('button', { name: /Play/i })).toBeInTheDocument();
    });

    it('should call togglePlay when play button is clicked', () => {
        render(<TransportBar onReviewRun={() => undefined} />);
        const playButton = screen.getByRole('button', { name: /Play/i });
        fireEvent.click(playButton);
        expect(togglePlayback).toHaveBeenCalled();
    });

    it('hides VoiceButton before AiRuntime verifies a local model', () => {
        renderTransportBar();

        expect(screen.queryByRole('button', { name: /Voice command/ })).not.toBeInTheDocument();
    });

    it('offers the enable-voice setup on the desktop runtime and turns its confirmation into consent', async () => {
        // The desktop marker the preload publishes; the affordance exists only there.
        Reflect.set(window, 'sourdaw', {});
        try {
            renderTransportBar();

            fireEvent.click(screen.getByTestId('voice-setup-button'));
            fireEvent.click(await screen.findByTestId('voice-setup-download-button'));

            expect(voiceRuntimeMocks.downloadWhisperModel).toHaveBeenCalledWith({ downloadConsent: true });
        } finally {
            Reflect.deleteProperty(window, 'sourdaw');
        }
    });

    it('offers no enable-voice setup off the desktop runtime', () => {
        renderTransportBar();

        expect(screen.queryByTestId('voice-setup-button')).not.toBeInTheDocument();
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
        fireEvent.click(screen.getByRole('button', { name: 'Transport settings' }));
        expect(screen.queryByRole('button', { name: /overdub/i })).not.toBeInTheDocument();
    });

    it('hides the overdub control when no tracks are armed', () => {
        renderTransportBar();

        fireEvent.click(screen.getByRole('button', { name: 'Transport settings' }));
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

    it('keeps the project name and menu trigger in one gapless control', () => {
        renderTransportBar();

        const splitControl = screen.getByTestId('project-menu-control');
        const projectName = screen.getByTestId('project-name');
        const menuTrigger = screen.getByTestId('recent-projects');

        expect(splitControl).toHaveClass('gap-0', 'shrink-0');
        expect(Array.from(splitControl.children)).toEqual([projectName, menuTrigger]);
        expect(screen.queryByRole('button', { name: 'Project controls' })).not.toBeInTheDocument();
    });

    it('admits compact controls from the viewport width rather than the header contents', () => {
        setViewportWidth(VIEWPORT_COMPACT_WIDTH);
        renderTransportBar();

        expect(screen.getByRole('button', { name: 'Project controls' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'More transport controls' })).toBeInTheDocument();
        expect(screen.queryByTestId('arrangement-selector')).not.toBeInTheDocument();
    });

    it('switches into compact mode when the viewport shrinks across the compact boundary', () => {
        renderTransportBar();

        expect(screen.queryByRole('button', { name: 'More transport controls' })).not.toBeInTheDocument();

        setViewportWidth(VIEWPORT_COMPACT_WIDTH);
        act(() => {
            window.dispatchEvent(new Event('resize'));
        });

        expect(screen.getByRole('button', { name: 'More transport controls' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Project controls' })).toBeInTheDocument();
    });

    it('restores focus when the focused transport control unmounts during a mode change', () => {
        renderTransportBar();
        screen.getByRole('menu', { name: 'Arrangement menu' }).remove();
        screen.getByTestId('transport-metronome').focus();

        setViewportWidth(VIEWPORT_COMPACT_WIDTH);
        act(() => {
            window.dispatchEvent(new Event('resize'));
        });

        expect(screen.getByRole('button', { name: 'Stop' })).toHaveFocus();
    });

    it('does not steal focus to Stop when an external control was focused and unmounts during a mode change', () => {
        renderTransportBar();
        const externalButton = document.createElement('button');
        externalButton.setAttribute('aria-label', 'External footer action');
        document.body.appendChild(externalButton);
        externalButton.focus();

        setViewportWidth(VIEWPORT_COMPACT_WIDTH);
        act(() => {
            externalButton.remove();
            window.dispatchEvent(new Event('resize'));
        });

        expect(screen.getByRole('button', { name: 'Stop' })).not.toHaveFocus();
    });

    it('keeps focus on a transport control that remains mounted during a mode change', () => {
        renderTransportBar();
        screen.getByRole('button', { name: 'Play' }).focus();

        setViewportWidth(VIEWPORT_COMPACT_WIDTH);
        act(() => {
            window.dispatchEvent(new Event('resize'));
        });

        expect(screen.getByRole('button', { name: 'Play' })).toHaveFocus();
    });

    it('keeps focus in portaled transport settings during a mode change', () => {
        renderTransportBar();
        screen.getByRole('menu', { name: 'Arrangement menu' }).remove();
        fireEvent.click(screen.getByRole('button', { name: 'Transport settings' }));

        const settingsDialog = screen.getByRole('dialog', { name: 'Transport settings' });
        expect(settingsDialog).toBeInTheDocument();

        setViewportWidth(VIEWPORT_COMPACT_WIDTH);
        act(() => {
            window.dispatchEvent(new Event('resize'));
        });

        expect(settingsDialog).toBeInTheDocument();
        expect(settingsDialog.contains(document.activeElement)).toBe(true);
        expect(screen.getByRole('button', { name: 'Stop' })).not.toHaveFocus();
    });

    it('mounts punch as a compact cluster on the expanded action row', () => {
        renderTransportBar();

        expect(screen.queryByRole('button', { name: 'More transport controls' })).not.toBeInTheDocument();
        expect(screen.getByTestId('punch-recording')).toHaveAttribute('data-compact', 'true');
    });

    it('closes nested punch settings on the first Escape and More on the second', async () => {
        setViewportWidth(VIEWPORT_COMPACT_WIDTH);
        renderTransportBar();

        const moreTrigger = screen.getByRole('button', { name: 'More transport controls' });
        fireEvent.click(moreTrigger);
        expect(moreTrigger).toHaveAttribute('aria-expanded', 'true');

        const punchTrigger = screen.getByRole('button', { name: 'Punch recording settings' });
        fireEvent.click(punchTrigger);
        const punchDialog = screen.getByRole('dialog', { name: 'Punch recording settings' });
        expect(punchDialog).toBeInTheDocument();
        expect(moreTrigger).toHaveAttribute('aria-expanded', 'true');

        // Playwright sends Escape to the focused portaled surface, not the trigger.
        // The Punch mock blocks Radix dismiss, so only the window-capture handler can close it.
        punchDialog.focus();
        fireEvent.keyDown(punchDialog, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Punch recording settings' })).not.toBeInTheDocument();
        expect(moreTrigger).toHaveAttribute('aria-expanded', 'true');

        await act(async () => {
            fireEvent.keyDown(punchTrigger, { key: 'Escape' });
            await new Promise<void>((resolve) => {
                requestAnimationFrame(() => resolve());
            });
        });
        expect(moreTrigger).toHaveAttribute('aria-expanded', 'false');
        expect(moreTrigger).toHaveFocus();
    });

    it('closes nested punch settings on Escape when a capture listener preventDefaults', () => {
        setViewportWidth(VIEWPORT_COMPACT_WIDTH);
        renderTransportBar();

        const addEventListener = vi.spyOn(window, 'addEventListener');
        try {
            const moreTrigger = screen.getByRole('button', { name: 'More transport controls' });
            fireEvent.click(moreTrigger);
            expect(addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);

            const punchTrigger = screen.getByRole('button', { name: 'Punch recording settings' });
            fireEvent.click(punchTrigger);
            const punchDialog = screen.getByRole('dialog', { name: 'Punch recording settings' });

            const swallowEscape = (event: KeyboardEvent): void => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                }
            };
            window.addEventListener('keydown', swallowEscape, true);
            try {
                punchDialog.focus();
                fireEvent.keyDown(punchDialog, { key: 'Escape' });
            } finally {
                window.removeEventListener('keydown', swallowEscape, true);
            }

            expect(screen.queryByRole('dialog', { name: 'Punch recording settings' })).not.toBeInTheDocument();
            expect(moreTrigger).toHaveAttribute('aria-expanded', 'true');
        } finally {
            addEventListener.mockRestore();
        }
    });
});
