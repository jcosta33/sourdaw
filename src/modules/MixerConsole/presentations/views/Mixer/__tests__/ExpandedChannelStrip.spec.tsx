import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    removeTrack: vi.fn(),
    renameTrack: vi.fn(),
    toggleVcaMembership: vi.fn(),
    createAndAssignVcaGroup: vi.fn(),
    getVcaGroups: vi.fn<() => TestVcaGroup[]>(() => []),
    confirmUser: vi.fn<() => Promise<boolean>>(),
    releaseTouchAutomation: vi.fn(),
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
    toggleVcaMembership: mocks.toggleVcaMembership,
    createAndAssignVcaGroup: mocks.createAndAssignVcaGroup,
    getVcaGroups: mocks.getVcaGroups,
}));

vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/useCases')>()),
    releaseTouchAutomation: mocks.releaseTouchAutomation,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('#/utils/Notification/confirmUser', () => ({
    confirmUser: mocks.confirmUser,
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
        mocks.getVcaGroups.mockReturnValue([{ id: 'vca-1', name: 'Drums VCA', gain: 1, muted: false, trackIds: [] }]);
        mocks.confirmUser.mockResolvedValue(true);
        // The strip reads the live track list (the fader's ceiling depends on
        // whether this track mirrors a Toaster pad), so each case starts from
        // an empty one rather than inheriting the previous case's fixture.
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

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
     * A control that can request what the writer refuses does not merely fail
     * to move — it costs the undo. `setTrackGain` holds a pad-mirrored track at
     * `TOASTER_PAD_MAX_GAIN`, while `handleSetTrackGain` builds the inverse
     * entry's `expectedGain` from the *request*. A strip offering travel to
     * `FADER_MAX_GAIN` here would record an inverse expecting a gain the store
     * never held, `execute`'s equality check would return `conflict` on the way
     * back, and the pre-drag value would be unrecoverable.
     */
    it('bounds a Toaster-pad-mirrored strip at the ceiling its own writer enforces', () => {
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
        // `TOASTER_PAD_MAX_GAIN` — unity, what `crates/daw-dsp/src/toaster/pad.rs`
        // accepts, and strictly below the fader law's own ceiling.
        expect(Number(fader.getAttribute('aria-valuemax'))).toBe(1);
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
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'muteTrack', payload: { trackId: 'track-1', muted: true, expectedMuted: false } },
            { skipUndo: true }
        );

        fireEvent.click(screen.getByRole('button', { name: 'Solo' }));
        expect(mocks.soloTrackExclusive).toHaveBeenCalledWith('track-1');

        fireEvent.click(screen.getByRole('button', { name: 'Solo' }), { metaKey: true });
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'soloTrack', payload: { trackId: 'track-1', soloed: true } },
            { skipUndo: true }
        );

        fireEvent.click(screen.getByRole('button', { name: 'Arm' }));
        expect(mocks.executeAppAction).toHaveBeenCalledWith({
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
        expect(mocks.executeAppAction).not.toHaveBeenCalled();

        fireEvent.doubleClick(screen.getByText('Track 1'));
        const input = screen.getByDisplayValue('Track 1');
        fireEvent.change(input, { target: { value: 'Kick In' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(mocks.executeAppAction).toHaveBeenCalledWith({
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
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'muteTrack', payload: { trackId: 'track-1', muted: true, expectedMuted: false } },
            { skipUndo: true }
        );
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('assigns the track to a VCA group and creates a new one from the context menu', () => {
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);

        openContextMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Drums VCA' }));
        expect(mocks.toggleVcaMembership).toHaveBeenCalledWith('track-1', 'vca-1');

        openContextMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: '+ New VCA Group' }));
        expect(mocks.createAndAssignVcaGroup).toHaveBeenCalledWith('track-1');
    });

    it('removes the channel only after the user confirms', async () => {
        mocks.confirmUser.mockResolvedValueOnce(false);
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} isSelected={false} widthClass="w-40" />);

        openContextMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Remove Channel' }));
        await waitFor(() => expect(mocks.confirmUser).toHaveBeenCalledTimes(1));
        expect(mocks.executeAppAction).not.toHaveBeenCalled();

        openContextMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Remove Channel' }));
        await waitFor(() =>
            expect(mocks.executeAppAction).toHaveBeenCalledWith({
                type: 'removeTrack',
                payload: { trackId: 'track-1' },
            })
        );
        expect(mocks.removeTrack).not.toHaveBeenCalled();
    });
});
