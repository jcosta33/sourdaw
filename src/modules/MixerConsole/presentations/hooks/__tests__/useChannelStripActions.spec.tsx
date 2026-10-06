import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { trackStore, vcaGroupStore } from '#/modules/Arrangement/stores';

import { useChannelStripActions } from '../useChannelStripActions';

import type { AppAction } from '#/utils/handlerContract';
import type { Track } from '../../../models/TrackViewTypes';

/**
 * The action entry the fake stack pushes when a write "records": shaped like
 * `ActionUndoEntry` where it matters, since the hook reads it through the
 * union's `kind` discriminant and compares its `action` against the dispatched
 * object by reference — which is how `createUndoEntry` stores it.
 */
type RecordedActionEntry = { kind: 'action'; action: AppAction };

const makeRecordedEntry = (action: AppAction): RecordedActionEntry => ({
    kind: 'action',
    action,
});

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
    executeAppAction: vi.fn((_action: AppAction) => Promise.resolve()),
    executeUserAppAction: vi.fn((_action: AppAction) => Promise.resolve()),
    removeTrack: vi.fn(),
    renameTrack: vi.fn(),
    releaseTouchAutomation: vi.fn(),
    confirmUser: vi.fn(),
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    // The undo stack top the strip's record gate reads. A stable sentinel is
    // what makes "nothing recorded" observable: the gate arms only when the top
    // is the action entry THIS dispatch recorded — the same object the dispatch
    // mock received — so the sentinel must hold its identity while the stack
    // stands still, and a recording write must replace it with an action entry
    // whose `action` is that object.
    undoStackTop: undefined as { readonly marker: string } | RecordedActionEntry | undefined,
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
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
    executeUserAppAction: mocks.executeUserAppAction,
}));

vi.mock('#/modules/Command/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/stores')>()),
    undoHistoryStore: {
        get value() {
            return {
                past: mocks.undoStackTop === undefined ? [] : [mocks.undoStackTop],
                future: [],
            };
        },
    },
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

/**
 * Put a track into project truth. The strip's rejection path reads the store
 * rather than its bound prop, because a commit can fail after it wrote.
 * MixerConsole's `Track` is a structural mirror of Arrangement's, so the same
 * literal serves both.
 */
const seedProjectTruth = (overrides: Partial<Track> = {}): void => {
    trackStore.set({ tracks: [makeTrack(overrides)], selectedTrackId: null, ghostClips: [] });
};

describe('useChannelStripActions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.undoStackTop = undefined;
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    it('select dispatches selectTrack with the bound track id', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-42' })));

        result.current.select();

        expect(mocks.selectTrack).toHaveBeenCalledWith('track-42');
    });

    it('toggleMute mutes an unmuted track through the canonical write path', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', muted: false })));

        result.current.toggleMute();

        expect(mocks.executeUserAppAction).toHaveBeenCalledWith(
            { type: 'muteTrack', payload: { trackId: 'track-1', muted: true, expectedMuted: false } },
            { skipUndo: true }
        );
        expect(mocks.muteTrack).not.toHaveBeenCalled();
    });

    it('toggleMute unmutes a muted track through the canonical write path', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', muted: true })));

        result.current.toggleMute();

        expect(mocks.executeUserAppAction).toHaveBeenCalledWith(
            { type: 'muteTrack', payload: { trackId: 'track-1', muted: false, expectedMuted: true } },
            { skipUndo: true }
        );
    });

    it('toggleSolo(additive) toggles solo state without exclusivity', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', soloed: false })));

        result.current.toggleSolo(true);

        expect(mocks.executeUserAppAction).toHaveBeenCalledWith(
            { type: 'soloTrack', payload: { trackId: 'track-1', soloed: true } },
            { skipUndo: true }
        );
        expect(mocks.soloTrackExclusive).not.toHaveBeenCalled();
    });

    // Exclusive solo has no `AppAction` to dispatch — see the comment on
    // `toggleSolo`. Pinned so the gap is visible rather than assumed converted.
    it('toggleSolo(non-additive) solos exclusively instead of toggling', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        result.current.toggleSolo(false);

        expect(mocks.soloTrackExclusive).toHaveBeenCalledWith('track-1');
        expect(mocks.executeUserAppAction).not.toHaveBeenCalled();
    });

    it('toggleArm routes the inverse armed flag through the canonical AppAction write path', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', armed: true })));

        result.current.toggleArm();

        expect(mocks.executeUserAppAction).toHaveBeenCalledWith({
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

        expect(mocks.executeUserAppAction).toHaveBeenCalledWith(
            { type: 'toggleSoloSafe', payload: { trackId: 'track-1' } },
            { skipUndo: true }
        );
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

        await act(async () => {
            result.current.setGain(0.42, true);
            result.current.setGain(0.31, false);
        });

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'setTrackGain',
            payload: { trackId: 'track-1', gain: 0.31, expectedGain: 0.8 },
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

    /**
     * The gesture drives the engine and nothing else, so a rejected commit that
     * only restores the *display* leaves the engine on the abandoned value: the
     * fader reads project truth, the project agrees, every peer hears project
     * truth, and this user alone hears the value that never landed — silently,
     * until the next write to that track.
     */
    it('re-drives the engine from project truth when the commit rejects', async () => {
        seedProjectTruth({ id: 'track-1', gain: 0.8 });
        mocks.executeAppAction.mockRejectedValueOnce(new Error('commit failed'));
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', gain: 0.8 })));

        act(() => {
            result.current.setGain(0.35, true);
        });
        expect(mocks.setTrackGain).toHaveBeenLastCalledWith('track-1', 0.35, true);

        await act(async () => {
            result.current.setGain(0.35, false);
            await Promise.resolve();
        });

        expect(mocks.setTrackGain).toHaveBeenLastCalledWith('track-1', 0.8, true);
        expect(result.current.displayGain).toBe(0.8);
    });

    /**
     * `AppActionCommittedError` — the write landed and a post-commit effect
     * failed. Project truth is the *committed* value, while the `track` prop
     * inside the dispatch closure is still the render from before it. Re-driving
     * from the prop would put the engine on a value the project has already
     * moved off.
     */
    it('re-drives the engine from the committed value when a commit fails after writing', async () => {
        seedProjectTruth({ id: 'track-1', gain: 0.5 });
        mocks.executeAppAction.mockRejectedValueOnce(new Error('post-commit effect failed'));
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', gain: 0.8 })));

        await act(async () => {
            result.current.setGain(0.35, true);
            result.current.setGain(0.35, false);
            await Promise.resolve();
        });

        expect(mocks.setTrackGain).toHaveBeenLastCalledWith('track-1', 0.5, true);
    });

    it('re-drives the pan engine from project truth when the commit rejects', async () => {
        seedProjectTruth({ id: 'track-1', pan: 12 });
        mocks.executeAppAction.mockRejectedValueOnce(new Error('commit failed'));
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', pan: 12 })));

        await act(async () => {
            result.current.setPan(-30, true);
            result.current.setPan(-30, false);
            await Promise.resolve();
        });

        expect(mocks.setTrackPan).toHaveBeenLastCalledWith('track-1', 12, true);
    });

    it('does not re-drive the engine when the commit succeeds', async () => {
        seedProjectTruth({ id: 'track-1', gain: 0.35 });
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', gain: 0.8 })));

        await act(async () => {
            result.current.setGain(0.35, true);
            result.current.setGain(0.35, false);
            await Promise.resolve();
        });

        // The committed write already put 0.35 on the engine; a corrective
        // re-drive here would be a second, redundant engine write per gesture.
        expect(mocks.setTrackGain).toHaveBeenCalledTimes(1);
        expect(mocks.setTrackGain).toHaveBeenLastCalledWith('track-1', 0.35, true);
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

    /**
     * The reset's coalescing is record-gated, and this is the recording
     * direction: the settle's commit put the entry it recorded on top of the
     * undo stack, so the double-click reset that follows inside the window
     * must dispatch with `coalesceWithPrevious` and become one undo step with
     * the settle. The fake stack records the way `createUndoEntry` does — the
     * entry's `action` IS the object the dispatch received — and the mocked
     * dispatch is held open so the top moves exactly when the write lands;
     * the commit-time decision, serialized behind the settle, must then
     * already see the settle's own entry.
     */
    it('arms coalescing for the next discrete commit when the settled gesture recorded an undo entry', async () => {
        mocks.undoStackTop = { marker: 'older-entry' };
        let resolveSettleCommit = (): void => undefined;
        mocks.executeAppAction.mockImplementationOnce(
            (action) =>
                new Promise<void>((resolve) => {
                    // The write records as the commit resolves: the fake stack
                    // top becomes an action entry whose `action` IS this
                    // dispatch's object.
                    resolveSettleCommit = () => {
                        mocks.undoStackTop = makeRecordedEntry(action);
                        resolve();
                    };
                })
        );
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', gain: 0.8 })));

        await act(async () => {
            result.current.setGain(0.42, true);
            result.current.setGain(0.31, false);
        });
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);

        // The settle's write lands and records: the undo stack's top moves to
        // this settle's own entry.
        await act(async () => {
            resolveSettleCommit();
            await Promise.resolve();
            await Promise.resolve();
        });

        // The double-click reset: a discrete settle (no gesture open) inside
        // the window, which may only join the settle because it recorded.
        await act(async () => {
            result.current.setGain(1, false);
            await Promise.resolve();
        });

        expect(mocks.executeAppAction).toHaveBeenLastCalledWith(
            { type: 'setTrackGain', payload: { trackId: 'track-1', gain: 1, expectedGain: 0.8 } },
            { coalesceWithPrevious: true }
        );
    });

    /**
     * The mirror image, and the case that pins #4616: a jittered first click
     * settles at the unchanged gain, the handler swallows it as a no-op and
     * nothing records — the stack top the commit captured is still standing
     * after the dispatch. The stamp must stay cold, so the reset that follows
     * dispatches WITHOUT `coalesceWithPrevious` and undo returns it as its own
     * step instead of reverting the older entry with it.
     */
    it('does not arm coalescing when the settled gesture recorded nothing', async () => {
        mocks.undoStackTop = { marker: 'older-entry' };
        let resolveSettleCommit = (): void => undefined;
        mocks.executeAppAction.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    resolveSettleCommit = resolve;
                })
        );
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', gain: 0.8 })));

        // The jittered first click: a transient and its settle at the
        // unchanged gain — production's `handleSetTrackGain` swallows the
        // zero-change payload, so the dispatch records nothing.
        await act(async () => {
            result.current.setGain(0.8, true);
            result.current.setGain(0.8, false);
        });
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);

        // The dispatch lands and records nothing: the stack top stands.
        await act(async () => {
            resolveSettleCommit();
            await Promise.resolve();
            await Promise.resolve();
        });

        // The double-click reset, inside the window, must be its own undo step.
        await act(async () => {
            result.current.setGain(1, false);
            await Promise.resolve();
        });

        // No second argument: the reset joins nothing.
        expect(mocks.executeAppAction).toHaveBeenLastCalledWith({
            type: 'setTrackGain',
            payload: { trackId: 'track-1', gain: 1, expectedGain: 0.8 },
        });
    });

    /**
     * The demonstrated false arm: the settle's dispatch await is held open by
     * the persistence barrier and the storage transaction, and a FOREIGN
     * setTrackGain — same track, a different hand or automation pass — lands
     * and records inside that window. The stack top moves, but it is not this
     * settle's entry, so the reference check must leave the stamp cold: arming
     * here would let one Cmd+Z revert the foreign edit together with the
     * user's reset.
     */
    it('does not arm coalescing when a foreign same-track setTrackGain records inside the held-open settle window', async () => {
        mocks.undoStackTop = { marker: 'older-entry' };
        let resolveSettleCommit = (): void => undefined;
        mocks.executeAppAction.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    resolveSettleCommit = resolve;
                })
        );
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', gain: 0.8 })));

        await act(async () => {
            result.current.setGain(0.42, true);
            result.current.setGain(0.31, false);
        });
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);

        // While the settle's commit is still open, a foreign same-track
        // setTrackGain lands and records: the top moves, to an entry that is
        // not this settle's.
        await act(async () => {
            mocks.undoStackTop = makeRecordedEntry({
                type: 'setTrackGain',
                payload: { trackId: 'track-1', gain: 0.25, expectedGain: 0.8 },
            });
        });

        // The settle resolves having recorded nothing — its value matched the
        // store, so the zero-change handler swallowed it.
        await act(async () => {
            resolveSettleCommit();
            await Promise.resolve();
            await Promise.resolve();
        });

        // The double-click reset inside the window must be its own undo step.
        await act(async () => {
            result.current.setGain(1, false);
            await Promise.resolve();
        });

        // No second argument: the reset joins nothing, foreign or otherwise.
        expect(mocks.executeAppAction).toHaveBeenLastCalledWith({
            type: 'setTrackGain',
            payload: { trackId: 'track-1', gain: 1, expectedGain: 0.8 },
        });
    });

    /**
     * A discrete commit records too — a keyboard nudge dispatches, and the
     * entry it pushes is exactly as real as a gesture settle's — but it must
     * not re-arm the coalescing window: only a gesture settle's own recording
     * arms. Re-arming from a nudge would chain the next burst of nudges into
     * one undo group, and a single nudge could no longer be stepped back
     * alone.
     */
    it('does not arm coalescing when a discrete commit recorded, so the next nudge stays its own undo step', async () => {
        mocks.undoStackTop = { marker: 'older-entry' };
        // The first nudge — a discrete settle with no gesture open — records:
        // the fake stack top becomes an action entry whose `action` IS this
        // dispatch's object, the way `createUndoEntry` stores it.
        mocks.executeAppAction.mockImplementationOnce((action) => {
            mocks.undoStackTop = makeRecordedEntry(action);
            return Promise.resolve();
        });
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', gain: 0.8 })));

        await act(async () => {
            result.current.setGain(0.5, false);
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppAction).toHaveBeenNthCalledWith(1, {
            type: 'setTrackGain',
            payload: { trackId: 'track-1', gain: 0.5, expectedGain: 0.8 },
        });

        // The second nudge, well inside the 500 ms window: the recording
        // first nudge must not have armed the window, so this one joins
        // nothing and undo steps back one nudge at a time.
        await act(async () => {
            result.current.setGain(0.4, false);
            await Promise.resolve();
        });

        expect(mocks.executeAppAction).toHaveBeenNthCalledWith(2, {
            type: 'setTrackGain',
            payload: { trackId: 'track-1', gain: 0.4, expectedGain: 0.8 },
        });
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

        await act(async () => {
            result.current.setPan(-25, true);
            result.current.setPan(-30, false);
        });

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'setTrackPan',
            payload: { trackId: 'track-1', pan: -30, expectedPan: 0 },
        });
        expect(result.current.displayPan).toBe(-30);

        await act(async () => {
            settleCommit();
            // Let the commit continuation's `finally` run before asserting.
            await Promise.resolve();
        });

        expect(result.current.displayPan).toBe(0);
    });

    it('scopes gain commit continuation to the owning gesture and serialises overlapping settles', async () => {
        seedProjectTruth({ id: 'track-1', gain: 0.8 });
        let resolveCommit1: (() => void) | undefined;
        let resolveCommit2: (() => void) | undefined;
        mocks.executeAppAction
            .mockImplementationOnce(
                () =>
                    new Promise<void>((resolve) => {
                        resolveCommit1 = resolve;
                    })
            )
            .mockImplementationOnce(
                () =>
                    new Promise<void>((resolve) => {
                        resolveCommit2 = resolve;
                    })
            );

        const { result, rerender } = renderHook((track: Track) => useChannelStripActions(track), {
            initialProps: makeTrack({ id: 'track-1', gain: 0.8 }),
        });

        // Drag to 0.42 (transient), release at 0.65 (settle).
        await act(async () => {
            result.current.setGain(0.42, true);
            result.current.setGain(0.65, false);
        });

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppAction).toHaveBeenLastCalledWith({
            type: 'setTrackGain',
            payload: { trackId: 'track-1', gain: 0.65, expectedGain: 0.8 },
        });
        expect(result.current.displayGain).toBe(0.65);

        // While commit 1 is in flight, drag to 0.20 (transient), release at 0.30 (settle).
        await act(async () => {
            result.current.setGain(0.2, true);
            result.current.setGain(0.3, false);
        });

        expect(result.current.displayGain).toBe(0.3);
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);

        // Resolve commit 1, update store to 0.65.
        seedProjectTruth({ id: 'track-1', gain: 0.65 });
        rerender(makeTrack({ id: 'track-1', gain: 0.65 }));

        await act(async () => {
            resolveCommit1?.();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(result.current.displayGain).toBe(0.3);
        expect(mocks.setTrackGain).toHaveBeenLastCalledWith('track-1', 0.3, true);
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(2);
        expect(mocks.executeAppAction).toHaveBeenLastCalledWith({
            type: 'setTrackGain',
            payload: { trackId: 'track-1', gain: 0.3, expectedGain: 0.65 },
        });

        // Resolve commit 2, update store to 0.30.
        seedProjectTruth({ id: 'track-1', gain: 0.3 });
        rerender(makeTrack({ id: 'track-1', gain: 0.3 }));

        await act(async () => {
            resolveCommit2?.();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(result.current.displayGain).toBe(0.3);
    });

    it('scopes pan commit continuation to the owning gesture and serialises overlapping settles', async () => {
        seedProjectTruth({ id: 'track-1', pan: 0 });
        let resolveCommit1: (() => void) | undefined;
        let resolveCommit2: (() => void) | undefined;
        mocks.executeAppAction
            .mockImplementationOnce(
                () =>
                    new Promise<void>((resolve) => {
                        resolveCommit1 = resolve;
                    })
            )
            .mockImplementationOnce(
                () =>
                    new Promise<void>((resolve) => {
                        resolveCommit2 = resolve;
                    })
            );

        const { result, rerender } = renderHook((track: Track) => useChannelStripActions(track), {
            initialProps: makeTrack({ id: 'track-1', pan: 0 }),
        });

        // Drag to 10 (transient), release at 15 (settle).
        await act(async () => {
            result.current.setPan(10, true);
            result.current.setPan(15, false);
        });

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppAction).toHaveBeenLastCalledWith({
            type: 'setTrackPan',
            payload: { trackId: 'track-1', pan: 15, expectedPan: 0 },
        });
        expect(result.current.displayPan).toBe(15);

        // While commit 1 is in flight, drag to -20 (transient), release at -25 (settle).
        await act(async () => {
            result.current.setPan(-20, true);
            result.current.setPan(-25, false);
        });

        expect(result.current.displayPan).toBe(-25);
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);

        // Resolve commit 1, update store to 15.
        seedProjectTruth({ id: 'track-1', pan: 15 });
        rerender(makeTrack({ id: 'track-1', pan: 15 }));

        await act(async () => {
            resolveCommit1?.();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(result.current.displayPan).toBe(-25);
        expect(mocks.setTrackPan).toHaveBeenLastCalledWith('track-1', -25, true);
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(2);
        expect(mocks.executeAppAction).toHaveBeenLastCalledWith({
            type: 'setTrackPan',
            payload: { trackId: 'track-1', pan: -25, expectedPan: 15 },
        });

        // Resolve commit 2, update store to -25.
        seedProjectTruth({ id: 'track-1', pan: -25 });
        rerender(makeTrack({ id: 'track-1', pan: -25 }));

        await act(async () => {
            resolveCommit2?.();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(result.current.displayPan).toBe(-25);
    });

    it('does not restore engine to pre-gesture truth if an earlier commit rejects while a newer gesture is live', async () => {
        seedProjectTruth({ id: 'track-1', gain: 0.8 });
        let rejectCommit1: ((error: Error) => void) | undefined;
        mocks.executeAppAction.mockImplementationOnce(
            () =>
                new Promise<void>((_resolve, reject) => {
                    rejectCommit1 = reject;
                })
        );

        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', gain: 0.8 })));

        // Gesture 1: drag to 0.65, release.
        await act(async () => {
            result.current.setGain(0.65, true);
            result.current.setGain(0.65, false);
        });
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);

        // Gesture 2: drag to 0.30 (transient).
        act(() => {
            result.current.setGain(0.3, true);
        });
        expect(result.current.displayGain).toBe(0.3);

        mocks.setTrackGain.mockClear();

        // Commit 1 rejects with error.
        const commitError = new Error('commit 1 failed');
        await act(async () => {
            rejectCommit1?.(commitError);
            await Promise.resolve();
            await Promise.resolve();
        });

        // displayGain remains 0.30.
        expect(result.current.displayGain).toBe(0.3);
        // Engine is NOT restored to pre-gesture 0.8.
        expect(mocks.setTrackGain).not.toHaveBeenCalledWith('track-1', 0.8, true);
        // And mocks.logger.error logs the failure.
        expect(mocks.logger.error).toHaveBeenCalledTimes(1);
        const logged = mocks.logger.error.mock.calls[0]![0] as Error;
        expect(logged.message).toBe('Channel strip commit failed for action: setTrackGain');
        expect(logged.cause).toBe(commitError);
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

        await act(async () => {
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

        expect(mocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'setTrackColor',
            payload: { trackId: 'track-1', color: '#00ff00' },
        });
        expect(mocks.setTrackColor).not.toHaveBeenCalled();
    });

    it('rename dispatches renameTrack through the canonical write path', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        result.current.rename('New Name');

        expect(mocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'renameTrack',
            payload: { trackId: 'track-1', name: 'New Name' },
        });
        expect(mocks.renameTrack).not.toHaveBeenCalled();
    });

    it('toggleVca dispatches assignToVca for a track outside the group', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1', vcaGroupId: null })));

        result.current.toggleVca('vca-group-1');

        expect(mocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'assignToVca',
            payload: { trackId: 'track-1', vcaGroupId: 'vca-group-1' },
        });
    });

    it("toggleVca dispatches removeFromVca for the track's own group", () => {
        const { result } = renderHook(() =>
            useChannelStripActions(makeTrack({ id: 'track-1', vcaGroupId: 'vca-group-1' }))
        );

        result.current.toggleVca('vca-group-1');

        expect(mocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'removeFromVca',
            payload: { trackId: 'track-1' },
        });
    });

    it('createVcaAndAssign dispatches createVcaGroup containing the track', () => {
        vcaGroupStore.set({ groups: [] });
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        result.current.createVcaAndAssign();

        expect(mocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'createVcaGroup',
            payload: { name: 'VCA 1', trackIds: ['track-1'] },
        });
    });

    it('removeFromVca dispatches the removeFromVca action for the track', () => {
        const { result } = renderHook(() => useChannelStripActions(makeTrack({ id: 'track-1' })));

        result.current.removeFromVca();

        expect(mocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'removeFromVca',
            payload: { trackId: 'track-1' },
        });
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
            expect(mocks.executeUserAppAction).toHaveBeenCalledWith({
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
        expect(mocks.executeUserAppAction).not.toHaveBeenCalled();
        expect(mocks.removeTrack).not.toHaveBeenCalled();
    });
});
