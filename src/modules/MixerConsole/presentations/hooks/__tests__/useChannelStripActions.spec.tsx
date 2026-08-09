import { act, renderHook, waitFor } from '@testing-library/react';
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
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: mocks.logger }));

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

    it('toggleMute mutes an unmuted track through the canonical write path', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', muted: false })));

        result.current.toggleMute();

        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'muteTrack',
            payload: { trackId: 'track-1', muted: true },
        });
        expect(mocks.muteTrack).not.toHaveBeenCalled();
    });

    it('toggleMute unmutes a muted track through the canonical write path', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', muted: true })));

        result.current.toggleMute();

        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'muteTrack',
            payload: { trackId: 'track-1', muted: false },
        });
    });

    it('toggleSolo(additive) toggles solo state without exclusivity', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', soloed: false })));

        result.current.toggleSolo(true);

        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'soloTrack',
            payload: { trackId: 'track-1', soloed: true },
        });
        expect(mocks.soloTrackExclusive).not.toHaveBeenCalled();
    });

    // Exclusive solo has no `AppAction` to dispatch — see the comment on
    // `toggleSolo`. Pinned so the gap is visible rather than assumed converted.
    it('toggleSolo(non-additive) solos exclusively instead of toggling', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        result.current.toggleSolo(false);

        expect(mocks.soloTrackExclusive).toHaveBeenCalledWith('track-1');
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
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

        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'toggleSoloSafe',
            payload: { trackId: 'track-1' },
        });
        expect(mocks.toggleSoloSafe).not.toHaveBeenCalled();
    });

    it('setGain drives only the engine while the gesture is transient', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        act(() => {
            result.current.setGain(0.42, true);
        });

        expect(mocks.setTrackGain).toHaveBeenCalledWith('track-1', 0.42, true);
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        // And the strip draws the gesture rather than the untouched project value.
        expect(result.current.displayGain).toBe(0.42);
    });

    it('setGain commits the settled value as one action and keeps drawing it until the write lands', async () => {
        let settleCommit = (): void => undefined;
        mocks.executeAppAction.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                settleCommit = resolve;
            })
        );
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', gain: 0.8 })));

        act(() => {
            result.current.setGain(0.42, true);
            result.current.setGain(0.31, false);
        });

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'setTrackGain',
            payload: { trackId: 'track-1', gain: 0.31 },
        });
        // While the commit is in flight the strip still draws the settled value.
        // Handing the display straight back to `track.gain` here showed the
        // pre-gesture 0.8 for as long as the action took, so the fader snapped
        // back to where the move started at the end of every gesture.
        expect(result.current.displayGain).toBe(0.31);

        await act(async () => {
            settleCommit();
            // Let the commit continuation's `finally` run before asserting.
            await Promise.resolve();
        });

        // Only once the write has landed does the strip go back to project
        // truth — which is also what makes it clamping-proof, since the stored
        // value need not equal the value that was committed.
        expect(result.current.displayGain).toBe(0.8);
    });

    it('hands the display back to project truth even when the commit rejects', async () => {
        mocks.executeAppAction.mockRejectedValueOnce(new Error('commit failed'));
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', gain: 0.8 })));

        await act(async () => {
            result.current.setGain(0.31, false);
            await Promise.resolve();
        });

        expect(result.current.displayGain).toBe(0.8);
    });

    /**
     * `void` on a rejecting promise is not a handler. Without a `catch` the
     * `finally` still ran and every assertion above still passed, while the
     * rejection escaped to the page — the suite reported it as an unhandled
     * error beside 26 green tests, which is exactly the shape of failure a test
     * count does not show.
     */
    it('logs a rejected commit instead of leaking it as an unhandled rejection', async () => {
        const cause = new Error('commit failed');
        mocks.executeAppAction.mockRejectedValueOnce(cause);
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', gain: 0.8 })));

        await act(async () => {
            result.current.setGain(0.31, false);
            await Promise.resolve();
        });

        expect(mocks.logger.error).toHaveBeenCalledTimes(1);
        const logged = mocks.logger.error.mock.calls[0]![0] as Error;
        expect(logged.message).toBe('Channel strip commit failed for action: setTrackGain');
        expect(logged.cause).toBe(cause);
    });

    it('setPan drives only the engine while the gesture is transient', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        act(() => {
            result.current.setPan(-25, true);
        });

        expect(mocks.setTrackPan).toHaveBeenCalledWith('track-1', -25, true);
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(result.current.displayPan).toBe(-25);
    });

    it('setPan commits the settled value as one action and keeps drawing it until the write lands', async () => {
        let settleCommit = (): void => undefined;
        mocks.executeAppAction.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                settleCommit = resolve;
            })
        );
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', pan: 0 })));

        act(() => {
            result.current.setPan(-25, true);
            result.current.setPan(-30, false);
        });

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'setTrackPan',
            payload: { trackId: 'track-1', pan: -30 },
        });
        expect(result.current.displayPan).toBe(-30);

        await act(async () => {
            settleCommit();
            // Let the commit continuation's `finally` run before asserting.
            await Promise.resolve();
        });

        expect(result.current.displayPan).toBe(0);
    });

    it('releases touch automation after the commit rather than before it', async () => {
        let settleCommit = (): void => undefined;
        mocks.executeAppAction.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                settleCommit = resolve;
            })
        );
        const { result } = renderHook(() =>
            useChannelStripActions(makeTrack({ id: 'track-1', automationMode: 'touch' }))
        );

        act(() => {
            result.current.setGain(0.31, false);
        });

        // The write has not landed, so the lane must still be armed — releasing
        // here would be re-armed by the commit's own automation write.
        expect(mocks.releaseTouchAutomation).not.toHaveBeenCalled();

        await act(async () => {
            settleCommit();
            // Let the commit continuation's `finally` run before asserting.
            await Promise.resolve();
        });

        expect(mocks.releaseTouchAutomation).toHaveBeenCalledWith('track-1', 'gain');
    });

    it('does not release touch automation for a track that is not in touch mode', async () => {
        const { result } = renderHook(() =>
            useChannelStripActions(makeTrack({ id: 'track-1', automationMode: 'write' }))
        );

        await act(async () => {
            result.current.setGain(0.31, false);
            await Promise.resolve();
        });

        expect(mocks.releaseTouchAutomation).not.toHaveBeenCalled();
    });

    it('setColor dispatches setTrackColor through the canonical write path', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        result.current.setColor('#00ff00');

        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'setTrackColor',
            payload: { trackId: 'track-1', color: '#00ff00' },
        });
        expect(mocks.setTrackColor).not.toHaveBeenCalled();
    });

    it('rename dispatches renameTrack through the canonical write path', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        result.current.rename('New Name');

        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'renameTrack',
            payload: { trackId: 'track-1', name: 'New Name' },
        });
        expect(mocks.renameTrack).not.toHaveBeenCalled();
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

    it('removeWithConfirm says what the delete costs rather than that it is permanent', async () => {
        mocks.confirmUser.mockResolvedValue(true);
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', name: 'Lead Vocal' })));

        result.current.removeWithConfirm();

        expect(mocks.confirmUser).toHaveBeenCalledWith({
            title: 'Delete "Lead Vocal"?',
            message: 'The track, its clips and its devices are removed. Undo restores them.',
            confirmLabel: 'Delete',
            variant: 'danger',
        });
        await waitFor(() => {
            expect(mocks.executeAppAction).toHaveBeenCalledWith({
                type: 'removeTrack',
                payload: { trackId: 'track-1' },
            });
        });
        expect(mocks.removeTrack).not.toHaveBeenCalled();
    });

    it('removeWithConfirm does not remove the track when the prompt is declined', async () => {
        mocks.confirmUser.mockResolvedValue(false);
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        result.current.removeWithConfirm();

        await waitFor(() => {
            expect(mocks.confirmUser).toHaveBeenCalledTimes(1);
        });
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.removeTrack).not.toHaveBeenCalled();
    });
});
