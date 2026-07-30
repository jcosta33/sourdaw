import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useChannelStripActions } from '../useChannelStripActions';

import type { Track } from '../../../models/TrackViewTypes';

const mocks = vi.hoisted(() => ({
    muteTrack: vi.fn(),
    soloTrack: vi.fn(),
    soloTrackExclusive: vi.fn(),
    toggleInputMonitoring: vi.fn(),
    toggleSoloSafe: vi.fn(),
    selectTrack: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackColor: vi.fn(),
    executeAppAction: vi.fn(),
    removeTrack: vi.fn(),
    renameTrack: vi.fn(),
    toggleVcaMembership: vi.fn(),
    createAndAssignVcaGroup: vi.fn(),
    removeFromVca: vi.fn(),
    releaseTouchAutomation: vi.fn(),
    confirmUser: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    muteTrack: mocks.muteTrack,
    soloTrack: mocks.soloTrack,
    soloTrackExclusive: mocks.soloTrackExclusive,
    toggleInputMonitoring: mocks.toggleInputMonitoring,
    toggleSoloSafe: mocks.toggleSoloSafe,
    selectTrack: mocks.selectTrack,
    setTrackGain: mocks.setTrackGain,
    setTrackPan: mocks.setTrackPan,
    setTrackColor: mocks.setTrackColor,
    removeTrack: mocks.removeTrack,
    renameTrack: mocks.renameTrack,
    toggleVcaMembership: mocks.toggleVcaMembership,
    createAndAssignVcaGroup: mocks.createAndAssignVcaGroup,
    removeFromVca: mocks.removeFromVca,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('#/modules/Automation/useCases', () => ({
    releaseTouchAutomation: mocks.releaseTouchAutomation,
}));

vi.mock('#/utils/Notification/confirmUser', () => ({
    confirmUser: mocks.confirmUser,
}));

const baseTrack: Track = {
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
    midiFx: [],
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
};

const makeTrack = (overrides: Partial<Track> = {}): Track => ({ ...baseTrack, ...overrides });

describe('useChannelStripActions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('select dispatches selectTrack with the bound track id', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-42' })));

        result.current.select();

        expect(mocks.selectTrack).toHaveBeenCalledWith('track-42');
    });

    it('toggleMute mutes an unmuted track', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', muted: false })));

        result.current.toggleMute();

        expect(mocks.muteTrack).toHaveBeenCalledWith('track-1', true);
    });

    it('toggleMute unmutes a muted track', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', muted: true })));

        result.current.toggleMute();

        expect(mocks.muteTrack).toHaveBeenCalledWith('track-1', false);
    });

    it('toggleSolo(additive) toggles solo state without exclusivity', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', soloed: false })));

        result.current.toggleSolo(true);

        expect(mocks.soloTrack).toHaveBeenCalledWith('track-1', true);
        expect(mocks.soloTrackExclusive).not.toHaveBeenCalled();
    });

    it('toggleSolo(non-additive) solos exclusively instead of toggling', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        result.current.toggleSolo(false);

        expect(mocks.soloTrackExclusive).toHaveBeenCalledWith('track-1');
        expect(mocks.soloTrack).not.toHaveBeenCalled();
    });

    it('toggleArm routes the inverse armed flag through the canonical AppAction write path', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', armed: true })));

        result.current.toggleArm();

        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'armTrack',
            payload: { trackId: 'track-1', armed: false },
        });
    });

    it('toggleMonitoring dispatches toggleInputMonitoring for the track', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        result.current.toggleMonitoring();

        expect(mocks.toggleInputMonitoring).toHaveBeenCalledWith('track-1');
    });

    it('toggleSoloSafeFlag dispatches toggleSoloSafe for the track', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        result.current.toggleSoloSafeFlag();

        expect(mocks.toggleSoloSafe).toHaveBeenCalledWith('track-1');
    });

    it('setGain forwards the raw value to setTrackGain', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        result.current.setGain(0.42);

        expect(mocks.setTrackGain).toHaveBeenCalledWith('track-1', 0.42);
    });

    it('setPan forwards the raw value to setTrackPan', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        result.current.setPan(-0.5);

        expect(mocks.setTrackPan).toHaveBeenCalledWith('track-1', -0.5);
    });

    it('setColor forwards the raw color to setTrackColor', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        result.current.setColor('#00ff00');

        expect(mocks.setTrackColor).toHaveBeenCalledWith('track-1', '#00ff00');
    });

    it('rename forwards the raw name to renameTrack', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        result.current.rename('New Name');

        expect(mocks.renameTrack).toHaveBeenCalledWith('track-1', 'New Name');
    });

    it('toggleVca forwards the group id to toggleVcaMembership', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        result.current.toggleVca('vca-group-1');

        expect(mocks.toggleVcaMembership).toHaveBeenCalledWith('track-1', 'vca-group-1');
    });

    it('createVcaAndAssign dispatches createAndAssignVcaGroup for the track', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        result.current.createVcaAndAssign();

        expect(mocks.createAndAssignVcaGroup).toHaveBeenCalledWith('track-1');
    });

    it('removeFromVca dispatches the removeFromVca use case for the track', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        result.current.removeFromVca();

        expect(mocks.removeFromVca).toHaveBeenCalledWith('track-1');
    });

    it('releaseGainAutomation releases touch automation when the track is in touch mode', () => {
        const { result } = renderHook(() =>
            useChannelStripActions(makeTrack({ id: 'track-1', automationMode: 'touch' }))
        );

        result.current.releaseGainAutomation();

        expect(mocks.releaseTouchAutomation).toHaveBeenCalledWith('track-1', 'gain');
    });

    it('releaseGainAutomation is a no-op outside touch mode', () => {
        const { result } = renderHook(() =>
            useChannelStripActions(makeTrack({ id: 'track-1', automationMode: 'read' }))
        );

        result.current.releaseGainAutomation();

        expect(mocks.releaseTouchAutomation).not.toHaveBeenCalled();
    });

    it('releasePanAutomation releases touch automation when the track is in touch mode', () => {
        const { result } = renderHook(() =>
            useChannelStripActions(makeTrack({ id: 'track-1', automationMode: 'touch' }))
        );

        result.current.releasePanAutomation();

        expect(mocks.releaseTouchAutomation).toHaveBeenCalledWith('track-1', 'pan');
    });

    it('releasePanAutomation is a no-op outside touch mode', () => {
        const { result } = renderHook(() =>
            useChannelStripActions(makeTrack({ id: 'track-1', automationMode: 'latch' }))
        );

        result.current.releasePanAutomation();

        expect(mocks.releaseTouchAutomation).not.toHaveBeenCalled();
    });

    it('removeWithConfirm prompts with the track name and removes the track once confirmed', async () => {
        mocks.confirmUser.mockResolvedValue(true);
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', name: 'Lead Vocal' })));

        result.current.removeWithConfirm();

        expect(mocks.confirmUser).toHaveBeenCalledWith({
            title: 'Delete "Lead Vocal"?',
            message: 'This action cannot be undone.',
            confirmLabel: 'Delete',
            variant: 'danger',
        });
        await waitFor(() => {
            expect(mocks.removeTrack).toHaveBeenCalledWith('track-1');
        });
    });

    it('removeWithConfirm does not remove the track when the prompt is declined', async () => {
        mocks.confirmUser.mockResolvedValue(false);
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        result.current.removeWithConfirm();

        await waitFor(() => {
            expect(mocks.confirmUser).toHaveBeenCalledTimes(1);
        });
        expect(mocks.removeTrack).not.toHaveBeenCalled();
    });
});
