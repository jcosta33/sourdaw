import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { trackStore, type Track as ProjectTrack } from '#/modules/Arrangement/stores';
import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { ExpandedChannelStrip } from '../ExpandedChannelStrip';

import type { Track } from '../../../../models/TrackViewTypes';

// `VcaGroup` is a use-case-private shape (not re-exported from the barrel);
// duplicate the fields this suite needs rather than reaching into `vca/getVcaGroups`.
type TestVcaGroup = { id: string; name: string; gain: number; muted: boolean; trackIds: string[] };

const mocks = vi.hoisted(() => ({
    muteTrack: vi.fn(),
    soloTrack: vi.fn(),
    soloTrackExclusive: vi.fn(),
    toggleInputMonitoring: vi.fn(),
    selectTrack: vi.fn(),
    executeAppAction: vi.fn(),
    executeUserAppAction: vi.fn(),
    removeTrack: vi.fn(),
    renameTrack: vi.fn(),
    getVcaGroups: vi.fn<() => TestVcaGroup[]>(() => []),
    confirmUser: vi.fn<() => Promise<boolean>>(),
    releaseTouchAutomation: vi.fn(),
    promptUser: vi.fn<() => Promise<string | null>>(),
    notifyUser: vi.fn(),
    projectEpoch: 0,
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    muteTrack: mocks.muteTrack,
    soloTrack: mocks.soloTrack,
    soloTrackExclusive: mocks.soloTrackExclusive,
    toggleInputMonitoring: mocks.toggleInputMonitoring,
    selectTrack: mocks.selectTrack,
    removeTrack: mocks.removeTrack,
    renameTrack: mocks.renameTrack,
    getVcaGroups: mocks.getVcaGroups,
}));

vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/useCases')>()),
    releaseTouchAutomation: mocks.releaseTouchAutomation,
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeAppAction: mocks.executeAppAction,
    executeUserAppAction: mocks.executeUserAppAction,
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    clearUndoHistory: vi.fn(),
    isAppActionCommittedError: vi.fn(() => false),
    pushUndoEntry: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
}));

vi.mock('#/utils/Notification/confirmUser', () => ({
    confirmUser: mocks.confirmUser,
}));

vi.mock('#/utils/Notification/promptUser', () => ({ promptUser: mocks.promptUser }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));
vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    captureProjectTransitionAuthority: () => {
        const epoch = mocks.projectEpoch;
        return { isCurrent: () => mocks.projectEpoch === epoch };
    },
}));

/**
 * A project-side track, built here rather than borrowed from Arrangement's own
 * test helpers: a spec reaching across a module boundary for a fixture is the
 * same coupling the dependency gate forbids in production code.
 */
function createProjectTrack(overrides: Partial<ProjectTrack> = {}): ProjectTrack {
    return {
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
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
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        ...overrides,
    };
}

const renderWithTooltip = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

const openContextMenu = () =>
    fireEvent.contextMenu(screen.getByRole('group', { name: 'Track 1 channel' }), { clientX: 0, clientY: 0 });

describe('ExpandedChannelStrip', () => {
    const mockTrack: Track = {
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectEpoch = 0;
        mocks.getVcaGroups.mockReturnValue([{ id: 'vca-1', name: 'Drums VCA', gain: 1, muted: false, trackIds: [] }]);
        mocks.confirmUser.mockResolvedValue(true);
        // The pad-child case below seeds the store with a Toaster parent, so
        // each case starts from an empty list rather than inheriting the
        // previous case's fixture.
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    afterEach(() => vi.restoreAllMocks());

    it('renders identity, gain readout, and pan readout', () => {
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);

        expect(screen.getByRole('group', { name: 'Track 1 channel' })).not.toHaveClass('ring-1');
        expect(screen.getByText('Track 1')).toBeInTheDocument();
        expect(screen.getByText('audio')).toBeInTheDocument();
        // The real gain law (`20 * log10(gain)`), not the old hand-rolled
        // `(gain - 0.8) * 40` formula that reported "0.0 dB" for this same
        // 0.8 default. True unity-relative level at 0.8 is about -1.9 dB.
        expect(screen.getByText('-1.9 dB')).toBeInTheDocument();
        expect(screen.getByText('C')).toBeInTheDocument();
    });

    it('renders 0.0 dB at unity gain', () => {
        renderWithTooltip(
            <ExpandedChannelStrip track={{ ...mockTrack, gain: 1 }} isSelected={false} widthClass="w-40" />
        );
        expect(screen.getByText('0.0 dB')).toBeInTheDocument();
    });

    it('renders the -∞ form at zero gain', () => {
        renderWithTooltip(
            <ExpandedChannelStrip track={{ ...mockTrack, gain: 0 }} isSelected={false} widthClass="w-40" />
        );
        expect(screen.getByText('-∞ dB')).toBeInTheDocument();
    });

    it('gives the fader real travel up to the +6 dB ceiling instead of dead space above unity', () => {
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);
        const fader = screen.getByRole('slider', { name: 'Track 1 gain' });
        expect(Number(fader.getAttribute('aria-valuemax'))).toBeCloseTo(FADER_MAX_GAIN, 5);
    });

    /**
     * A Toaster pad child used to be capped at unity because the fader mirrored
     * onto the pad's `volume` and the two gain nodes sit in series (#2458). The
     * mirror is gone — the pad keeps its own level — so the strip gets the same
     * travel as any other, and the writer stores what this control can ask for,
     * which keeps the undo entry's `expectedGain` honest.
     */
    it('gives a Toaster pad child the full fader travel like any other strip', () => {
        trackStore.set({
            tracks: [
                createProjectTrack({
                    id: 'toaster-bus',
                    name: 'Toaster Bus',
                    kind: 'bus',
                    devices: [
                        {
                            id: 'toaster-device',
                            name: 'Toaster',
                            type: 'toaster',
                            bypassed: false,
                            parameterValues: {},
                        },
                    ],
                }),
                createProjectTrack({ id: 'track-1', kind: 'audio', parentId: 'toaster-bus' }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });

        renderWithTooltip(
            <ExpandedChannelStrip
                track={{ ...mockTrack, parentId: 'toaster-bus' }}
                isSelected={false}
                widthClass="w-40"
            />
        );

        const fader = screen.getByRole('slider', { name: 'Track 1 gain' });
        expect(Number(fader.getAttribute('aria-valuemax'))).toBeCloseTo(FADER_MAX_GAIN, 5);
        expect(FADER_MAX_GAIN).toBeGreaterThan(1);
    });

    // audit M-083: the gain fader is keyboard-operable now, and a keyboard write emits
    // no pointerup — the touch-automation release has to be wired to keyup as well or
    // the lane stays latched until transport stop.
    it('releases touch gain automation only once the fader key is released', () => {
        renderWithTooltip(
            <ExpandedChannelStrip
                track={{ ...mockTrack, automationMode: 'touch' }}
                isSelected={false}
                widthClass="w-40"
            />
        );

        const fader = screen.getByRole('slider', { name: 'Track 1 gain' });
        fireEvent.keyDown(fader, { key: 'ArrowUp' });
        expect(mocks.releaseTouchAutomation).not.toHaveBeenCalled();

        fireEvent.keyUp(fader, { key: 'ArrowUp' });
        expect(mocks.releaseTouchAutomation).toHaveBeenCalledWith('track-1', 'gain');
    });

    it('applies the selection ring when isSelected is true', () => {
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected widthClass="w-40" />);
        expect(screen.getByRole('group', { name: 'Track 1 channel' })).toHaveClass('ring-1');
    });

    it('selects the track when the strip background is clicked', () => {
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);
        fireEvent.click(screen.getByRole('group', { name: 'Track 1 channel' }));
        expect(mocks.selectTrack).toHaveBeenCalledWith('track-1');
    });

    it('toggles mute, solo (exclusive and additive), arm, and monitoring without selecting the track', () => {
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);

        fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
        expect(mocks.executeUserAppAction).toHaveBeenCalledWith(
            { type: 'muteTrack', payload: { trackId: 'track-1', muted: true, expectedMuted: false } },
            { skipUndo: true }
        );

        fireEvent.click(screen.getByRole('button', { name: 'Solo' }));
        expect(mocks.soloTrackExclusive).toHaveBeenCalledWith('track-1');

        fireEvent.click(screen.getByRole('button', { name: 'Solo' }), { metaKey: true });
        expect(mocks.executeUserAppAction).toHaveBeenCalledWith(
            { type: 'soloTrack', payload: { trackId: 'track-1', soloed: true } },
            { skipUndo: true }
        );

        fireEvent.click(screen.getByRole('button', { name: 'Arm' }));
        expect(mocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'armTrack',
            payload: { trackId: 'track-1', armed: true },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Enable monitoring' }));
        expect(mocks.toggleInputMonitoring).toHaveBeenCalledWith('track-1');

        expect(mocks.selectTrack).not.toHaveBeenCalled();
    });

    it('renames the track on Enter, and Escape cancels without persisting', () => {
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);

        fireEvent.doubleClick(screen.getByText('Track 1'));
        fireEvent.keyDown(screen.getByDisplayValue('Track 1'), { key: 'Escape' });
        expect(screen.queryByDisplayValue('Track 1')).not.toBeInTheDocument();
        expect(mocks.executeUserAppAction).not.toHaveBeenCalled();

        fireEvent.doubleClick(screen.getByText('Track 1'));
        const input = screen.getByDisplayValue('Track 1');
        fireEvent.change(input, { target: { value: 'Kick In' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(mocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'renameTrack',
            payload: { trackId: 'track-1', name: 'Kick In' },
        });
        expect(screen.queryByDisplayValue('Kick In')).not.toBeInTheDocument();
    });

    it('opens a context menu at the click position and closes it after choosing Mute', () => {
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);

        fireEvent.contextMenu(screen.getByRole('group', { name: 'Track 1 channel' }), { clientX: 42, clientY: 17 });
        expect(screen.getByRole('menu')).toHaveStyle({ left: '42px', top: '17px' });

        fireEvent.click(screen.getByRole('menuitem', { name: 'Mute' }));
        expect(mocks.executeUserAppAction).toHaveBeenCalledWith(
            { type: 'muteTrack', payload: { trackId: 'track-1', muted: true, expectedMuted: false } },
            { skipUndo: true }
        );
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('opens four working gain actions from the slider without opening the channel menu', async () => {
        trackStore.set({ tracks: [createProjectTrack()], selectedTrackId: null, ghostClips: [] });
        const target = trackStore.value?.tracks[0];
        mocks.promptUser.mockResolvedValue('-6 dB');
        const writeText = vi.fn(() => Promise.resolve());
        const readText = vi.fn(() => Promise.resolve('gain:0.25'));
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, readText } });
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);

        const slider = screen.getByRole('slider', { name: 'Track 1 gain' });
        const open = () => fireEvent.contextMenu(slider, { clientX: 42, clientY: 17 });
        open();
        const menu = screen.getByRole('menu', { name: 'Track 1 gain actions' });
        expect(menu).toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: 'Mute' })).not.toBeInTheDocument();
        expect(['Reset to Default', 'Enter Value', 'Copy Value', 'Paste Value']).toEqual(
            Array.from(menu.querySelectorAll('[role="menuitem"]'), (item) => item.textContent)
        );

        fireEvent.click(screen.getByRole('menuitem', { name: 'Reset to Default' }));
        open();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Enter Value' }));
        expect(mocks.promptUser).toHaveBeenCalledTimes(1);
        expect(trackStore.value?.tracks[0]?.gain).toBe(0.8);
        expect(trackStore.value?.tracks[0]).toBe(target);
        await waitFor(() => expect(mocks.executeUserAppAction).toHaveBeenCalledTimes(1));
        expect(mocks.executeUserAppAction).toHaveBeenCalledWith(
            {
                type: 'setTrackGain',
                payload: {
                    trackId: 'track-1',
                    gain: 10 ** (-6 / 20),
                    expectedGain: 0.8,
                    automationRecordingPolicy: 'suppressed',
                },
            },
            expect.objectContaining({ shouldExecute: expect.any(Function), onCommitted: expect.any(Function) })
        );

        open();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Value' }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith('gain:0.8'));
        open();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste Value' }));
        expect(trackStore.value?.tracks[0]?.gain).toBe(0.8);
        await waitFor(() => expect(mocks.executeUserAppAction).toHaveBeenCalledTimes(2));
        expect(mocks.executeUserAppAction).toHaveBeenLastCalledWith(
            {
                type: 'setTrackGain',
                payload: { trackId: 'track-1', gain: 0.25, expectedGain: 0.8, automationRecordingPolicy: 'suppressed' },
            },
            expect.objectContaining({ shouldExecute: expect.any(Function) })
        );
    });

    it('rejects malformed gain clipboard text without dispatch', async () => {
        trackStore.set({ tracks: [createProjectTrack()], selectedTrackId: null, ghostClips: [] });
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText: vi.fn(() => Promise.resolve('gain:1junk')) },
        });
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);
        fireEvent.contextMenu(screen.getByRole('slider', { name: 'Track 1 gain' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste Value' }));
        await waitFor(() =>
            expect(mocks.notifyUser).toHaveBeenCalledWith(
                'Clipboard does not contain a valid track gain value.',
                'error'
            )
        );
        expect(mocks.executeUserAppAction).not.toHaveBeenCalled();
    });

    it.each([0, 1e-7])('copies the exact linear gain %s, including below the displayed fader floor', async (gain) => {
        trackStore.set({ tracks: [createProjectTrack({ gain })], selectedTrackId: null, ghostClips: [] });
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        renderWithTooltip(<ExpandedChannelStrip track={{ ...mockTrack, gain }} isSelected={false} widthClass="w-40" />);
        fireEvent.contextMenu(screen.getByRole('slider', { name: 'Track 1 gain' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Value' }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(`gain:${String(gain)}`));
    });

    it('reports clipboard denial without writing gain', async () => {
        trackStore.set({ tracks: [createProjectTrack()], selectedTrackId: null, ghostClips: [] });
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText: vi.fn(() => Promise.reject(new Error('denied'))) },
        });
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);
        fireEvent.contextMenu(screen.getByRole('slider', { name: 'Track 1 gain' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste Value' }));
        await waitFor(() =>
            expect(mocks.notifyUser).toHaveBeenCalledWith('Could not read track gain from the clipboard.', 'error')
        );
        expect(mocks.executeUserAppAction).not.toHaveBeenCalled();
    });

    it.each([0, 1e-7])('accepts exact linear gain %s from the clipboard', async (gain) => {
        trackStore.set({ tracks: [createProjectTrack()], selectedTrackId: null, ghostClips: [] });
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText: vi.fn(() => Promise.resolve(`gain:${String(gain)}`)) },
        });
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);
        fireEvent.contextMenu(screen.getByRole('slider', { name: 'Track 1 gain' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste Value' }));
        await waitFor(() =>
            expect(mocks.executeUserAppAction).toHaveBeenCalledWith(
                {
                    type: 'setTrackGain',
                    payload: { trackId: 'track-1', gain, expectedGain: 0.8, automationRecordingPolicy: 'suppressed' },
                },
                expect.objectContaining({ shouldExecute: expect.any(Function) })
            )
        );
    });

    it('drops an entered value after a same-ID successor replaces the captured track', async () => {
        trackStore.set({ tracks: [createProjectTrack()], selectedTrackId: null, ghostClips: [] });
        let releasePrompt: (value: string) => void = () => undefined;
        mocks.promptUser.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releasePrompt = resolve;
                })
        );
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);
        fireEvent.contextMenu(screen.getByRole('slider', { name: 'Track 1 gain' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Enter Value' }));
        expect(mocks.promptUser).toHaveBeenCalledTimes(1);
        trackStore.set({ tracks: [createProjectTrack()], selectedTrackId: null, ghostClips: [] });
        await act(async () => releasePrompt('-6 dB'));
        expect(mocks.executeUserAppAction).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('drops a held clipboard value after a newer fader intent', async () => {
        trackStore.set({ tracks: [createProjectTrack()], selectedTrackId: null, ghostClips: [] });
        let releaseRead: (value: string) => void = () => undefined;
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                readText: vi.fn(
                    () =>
                        new Promise<string>((resolve) => {
                            releaseRead = resolve;
                        })
                ),
            },
        });
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);
        const slider = screen.getByRole('slider', { name: 'Track 1 gain' });
        fireEvent.contextMenu(slider);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste Value' }));
        fireEvent.keyDown(slider, { key: 'ArrowUp' });
        await act(async () => releaseRead('gain:0.25'));
        expect(mocks.executeUserAppAction).not.toHaveBeenCalled();
    });

    it('drops a held clipboard value after unmount or project transition', async () => {
        trackStore.set({ tracks: [createProjectTrack()], selectedTrackId: null, ghostClips: [] });
        let releaseRead: (value: string) => void = () => undefined;
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                readText: vi.fn(
                    () =>
                        new Promise<string>((resolve) => {
                            releaseRead = resolve;
                        })
                ),
            },
        });
        const view = renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);
        fireEvent.contextMenu(screen.getByRole('slider', { name: 'Track 1 gain' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste Value' }));
        mocks.projectEpoch += 1;
        view.unmount();
        await act(async () => releaseRead('gain:0.25'));
        expect(mocks.executeUserAppAction).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it.each(['project transition', 'same-ID successor'])(
        'does not restore gain focus after a queued frame loses %s ownership',
        async (lostOwner) => {
            trackStore.set({ tracks: [createProjectTrack()], selectedTrackId: null, ghostClips: [] });
            mocks.promptUser.mockResolvedValue('-1.9 dB');
            let focusFrame: FrameRequestCallback | undefined;
            vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
                focusFrame = callback;
                return 1;
            });
            renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);
            const slider = screen.getByRole('slider', { name: 'Track 1 gain' });
            fireEvent.contextMenu(slider);
            expect(screen.getByRole('menu', { name: 'Track 1 gain actions' })).toBeInTheDocument();
            fireEvent.click(screen.getByRole('menuitem', { name: 'Enter Value' }));
            await waitFor(() => expect(focusFrame).toBeDefined());
            expect(mocks.executeUserAppAction).not.toHaveBeenCalled();
            const restoreFrame = focusFrame;
            slider.blur();
            expect(document.body).toHaveFocus();
            if (lostOwner === 'project transition') {
                mocks.projectEpoch += 1;
            } else {
                trackStore.set({ tracks: [createProjectTrack()], selectedTrackId: null, ghostClips: [] });
            }
            act(() => restoreFrame?.(0));
            expect(document.body).toHaveFocus();
        }
    );

    it.each(['unchanged owner', 'outside focus'])(
        'restores gain focus only when the frame keeps %s',
        async (focusChoice) => {
            trackStore.set({ tracks: [createProjectTrack()], selectedTrackId: null, ghostClips: [] });
            mocks.promptUser.mockResolvedValue('-1.9 dB');
            let focusFrame: FrameRequestCallback | undefined;
            vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
                focusFrame = callback;
                return 1;
            });
            renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);
            const slider = screen.getByRole('slider', { name: 'Track 1 gain' });
            fireEvent.contextMenu(slider);
            expect(screen.getByRole('menu', { name: 'Track 1 gain actions' })).toBeInTheDocument();
            fireEvent.click(screen.getByRole('menuitem', { name: 'Enter Value' }));
            await waitFor(() => expect(focusFrame).toBeDefined());
            expect(mocks.executeUserAppAction).not.toHaveBeenCalled();
            const outside = document.createElement('button');
            document.body.append(outside);
            slider.blur();
            if (focusChoice === 'outside focus') {
                outside.focus();
            }
            act(() => focusFrame?.(0));
            expect(focusChoice === 'outside focus' ? outside : slider).toHaveFocus();
            outside.remove();
        }
    );

    it('restores gain focus after its own successful track replacement', async () => {
        trackStore.set({ tracks: [createProjectTrack()], selectedTrackId: null, ghostClips: [] });
        mocks.promptUser.mockResolvedValue('-6 dB');
        const focusFrames: FrameRequestCallback[] = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            focusFrames.push(callback);
            return focusFrames.length;
        });
        mocks.executeUserAppAction.mockImplementationOnce(async (_action, options) => {
            trackStore.set({
                tracks: [createProjectTrack({ gain: 10 ** (-6 / 20) })],
                selectedTrackId: null,
                ghostClips: [],
            });
            options?.onCommitted?.();
        });
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);
        const slider = screen.getByRole('slider', { name: 'Track 1 gain' });
        fireEvent.contextMenu(slider);
        expect(screen.getByRole('menu', { name: 'Track 1 gain actions' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Enter Value' }));
        await waitFor(() => expect(mocks.executeUserAppAction).toHaveBeenCalledTimes(1));
        expect(focusFrames.length).toBeGreaterThan(0);
        slider.blur();
        expect(document.body).toHaveFocus();
        act(() => {
            for (const frame of focusFrames.slice()) {
                frame(0);
            }
        });
        expect(slider).toHaveFocus();
    });

    it('moves between gain menu actions with wrap, Home, and End', () => {
        trackStore.set({ tracks: [createProjectTrack()], selectedTrackId: null, ghostClips: [] });
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);
        fireEvent.contextMenu(screen.getByRole('slider', { name: 'Track 1 gain' }));
        const menu = screen.getByRole('menu', { name: 'Track 1 gain actions' });
        const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
        expect(items).toHaveLength(4);
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(items[0]).toHaveFocus();
        fireEvent.keyDown(menu, { key: 'ArrowUp' });
        expect(items[3]).toHaveFocus();
        fireEvent.keyDown(menu, { key: 'Home' });
        expect(items[0]).toHaveFocus();
        fireEvent.keyDown(menu, { key: 'End' });
        expect(items[3]).toHaveFocus();
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(items[0]).toHaveFocus();
    });

    it('focuses the first gain action when the keyboard opens the menu', () => {
        trackStore.set({ tracks: [createProjectTrack({ gain: 0.4 })], selectedTrackId: null, ghostClips: [] });
        renderWithTooltip(
            <ExpandedChannelStrip track={{ ...mockTrack, gain: 0.4 }} isSelected={false} widthClass="w-40" />
        );
        const slider = screen.getByRole('slider', { name: 'Track 1 gain' });
        slider.focus();
        fireEvent.keyDown(slider, { key: 'F10', shiftKey: true });
        const menu = screen.getByRole('menu', { name: 'Track 1 gain actions' });
        expect(menu).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Reset to Default' })).toHaveFocus();
    });

    it('keeps an outside focus choice after the gain menu closes', async () => {
        trackStore.set({ tracks: [createProjectTrack()], selectedTrackId: null, ghostClips: [] });
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);
        fireEvent.contextMenu(screen.getByRole('slider', { name: 'Track 1 gain' }));
        const menu = screen.getByRole('menu', { name: 'Track 1 gain actions' });
        const outside = document.createElement('button');
        document.body.append(outside);
        outside.focus();
        fireEvent.blur(menu, { relatedTarget: outside });
        await waitFor(() => expect(outside).toHaveFocus());
        outside.remove();
    });

    // The strip writes through the canonical action path, so these pin the
    // dispatched actions rather than the bare VCA use cases (which the strip
    // no longer calls).
    it('assigns the track to a VCA group and creates a new one from the context menu', () => {
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);

        openContextMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Drums VCA' }));
        expect(mocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'assignToVca',
            payload: { trackId: 'track-1', vcaGroupId: 'vca-1' },
        });

        openContextMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: '+ New VCA Group' }));
        expect(mocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'createVcaGroup',
            payload: { name: 'VCA 1', trackIds: ['track-1'] },
        });
    });

    it('removes the channel only after the user confirms', async () => {
        mocks.confirmUser.mockResolvedValueOnce(false);
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);

        openContextMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Remove Channel' }));
        await waitFor(() => expect(mocks.confirmUser).toHaveBeenCalledTimes(1));
        expect(mocks.executeUserAppAction).not.toHaveBeenCalled();

        openContextMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Remove Channel' }));
        await waitFor(() =>
            expect(mocks.executeUserAppAction).toHaveBeenCalledWith({
                type: 'removeTrack',
                payload: { trackId: 'track-1' },
            })
        );
        expect(mocks.removeTrack).not.toHaveBeenCalled();
    });
});
