import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: { value: null as { tracks: unknown[] } | null },
}));

vi.mock('#/modules/WorkspaceShell/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/WorkspaceShell/stores')>()),
    workspaceStore: { value: { soloMode: 'sip' } as { soloMode: string } | null },
}));

import { trackStore } from '#/modules/Arrangement/stores';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';
import { UNKNOWN_FROZEN_TAIL_SECONDS } from '#/utils/frozenBufferTail';

import * as estimateMod from '../../../services/estimateRenderTailSeconds';
import { getAutoDetectedTailSeconds } from '../getAutoDetectedTailSeconds';

const DELAY_TAIL = {
    kind: 'feedbackLoop',
    feedbackParameterId: 'delay-feedback',
    defaultFeedback: 0.4,
    maxFeedback: 0.95,
    loopParameterId: 'delay-time',
    loopUnit: 'ms',
    defaultLoopSeconds: 0.25,
} as const;

const REVERB_TAIL = { kind: 'decaySeconds', parameterId: 'rev-decay', defaultSeconds: 2 } as const;
const STATEFUL_DELAY_TAIL = {
    kind: 'stateFeedbackLoop',
    feedbackPath: ['data', 'kit', 'delayFeedback'],
    defaultFeedback: 0.35,
    maxFeedback: 0.95,
    loopPath: ['data', 'kit', 'delayTime'],
    loopUnit: 'ms',
    defaultLoopSeconds: 0.375,
    enabledPath: ['data', 'kit', 'delayMix'],
    defaultEnabledValue: 0,
    automatableEnabledParameterId: 'delayMix',
} as const;

/** Stands in for the descriptor lookup the export dialog injects. */
function tailForDeviceType(deviceType: string) {
    if (deviceType === 'builtin-reverb') {
        return REVERB_TAIL;
    }
    if (deviceType === 'builtin-delay') {
        return DELAY_TAIL;
    }
    if (deviceType === 'stateful-delay') {
        return STATEFUL_DELAY_TAIL;
    }
    return undefined;
}

type MutableTrackStore = { value: { tracks: unknown[] } | null };
const mockTrackStore = trackStore as unknown as MutableTrackStore;

type MutableWorkspaceStore = { value: { soloMode: string } | null };
const mockWorkspaceStore = workspaceStore as unknown as MutableWorkspaceStore;

type TrackOverrides = {
    muted?: boolean;
    soloed?: boolean;
    disabled?: boolean;
    frozen?: boolean;
    /** Tail seconds baked into the frozen buffer at freeze time. */
    frozenTailSeconds?: number;
    /**
     * Frozen but carrying no `renderSettings` at all. `isFreezeState` accepts
     * this shape, so a project can legitimately load in it.
     */
    frozenWithoutRenderSettings?: boolean;
    kind?: string;
    id?: string;
    outputId?: string;
    sends?: Array<{ busId: string; preFader: boolean }>;
};

/** Unfrozen, frozen with a recorded tail, or frozen with none — the last is a
 *  shape the project validator accepts. */
function makeFreezeState(overrides: TrackOverrides) {
    if (overrides.frozen !== true && overrides.frozenWithoutRenderSettings !== true) {
        return { status: 'unfrozen' };
    }
    if (overrides.frozenWithoutRenderSettings === true) {
        return { status: 'frozen', frozenBufferId: 'buffer-1' };
    }
    return {
        status: 'frozen',
        frozenBufferId: 'buffer-1',
        renderSettings: { tailLengthSeconds: overrides.frozenTailSeconds ?? 0 },
    };
}

function makeTrack(
    devices: Array<{
        id?: string;
        type: string;
        parameterValues?: Record<string, number>;
        deviceState?: unknown;
        bypassed?: boolean;
    }>,
    overrides: TrackOverrides = {}
) {
    return {
        id: overrides.id ?? 'track-1',
        kind: overrides.kind ?? 'audio',
        muted: overrides.muted ?? false,
        soloed: overrides.soloed ?? false,
        disabled: overrides.disabled ?? false,
        freezeState: makeFreezeState(overrides),
        outputId: overrides.outputId,
        sends: overrides.sends ?? [],
        devices: devices.map((d) => ({
            id: d.id ?? `${d.type}-1`,
            type: d.type,
            parameterValues: d.parameterValues ?? {},
            deviceState: d.deviceState,
            bypassed: d.bypassed ?? false,
        })),
    };
}

describe('getAutoDetectedTailSeconds', () => {
    beforeEach(() => {
        mockTrackStore.value = null;
        mockWorkspaceStore.value = { soloMode: 'sip' };
        vi.restoreAllMocks();
    });

    it('uses an enabled final-bar device lane as evidence that a zero snapshot mix can open', () => {
        const tracks = [
            makeTrack([
                {
                    id: 'delay-1',
                    type: 'stateful-delay',
                    parameterValues: { delayMix: 0 },
                    deviceState: {
                        data: { kit: { delayMix: 0, delayTime: 2_000, delayFeedback: 0.95 } },
                    },
                },
            ]),
        ];
        mockTrackStore.value = { tracks };

        const withoutLane = getAutoDetectedTailSeconds({
            tailForDeviceType,
            honorMuted: true,
            soloMode: 'sip',
            automationLanes: [],
        });
        const withFinalBarLane = getAutoDetectedTailSeconds({
            tailForDeviceType,
            honorMuted: true,
            soloMode: 'sip',
            automationLanes: [
                {
                    trackId: 'track-1',
                    parameterId: 'delay-1:delayMix',
                    enabled: true,
                },
            ],
        });

        expect(withoutLane.seconds).toBe(0);
        expect(withFinalBarLane.seconds).toBe(estimateMod.MAX_AUTO_TAIL_SECONDS);
    });

    it('keeps a muted track that PFL solo makes audible', () => {
        // `applySoloLogic` clears mute unconditionally for a soloed track in PFL
        // mode, which is the whole point of PFL: preview a muted channel. The
        // render therefore plays it in full, so its tail must be reserved.
        mockWorkspaceStore.value = { soloMode: 'pfl' };
        mockTrackStore.value = {
            tracks: [
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 20 } }], {
                    muted: true,
                    soloed: true,
                }),
            ],
        };

        expect(getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true }).seconds).toBe(20);
    });

    it('drops a track that solo-in-place gates out', () => {
        // The mirror case: with another track soloed in SIP mode, this one feeds
        // nothing and its tail is dead weight.
        mockWorkspaceStore.value = { soloMode: 'sip' };
        mockTrackStore.value = {
            tracks: [
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 20 } }], { id: 'track-1' }),
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 1.5 } }], {
                    id: 'track-2',
                    soloed: true,
                }),
            ],
        };

        expect(getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true }).seconds).toBe(1.5);
    });

    it('reserves a frozen track’s baked buffer tail, which its devices no longer describe', () => {
        // Freeze bakes a tail into the buffer (`AUTO_TAIL_SECONDS`) and records
        // it. The devices are bypassed at playback, but the buffer still plays
        // its baked decay, and `OfflineAudioContext` truncates anything past the
        // frame count — so dropping the track entirely cuts real audio.
        mockTrackStore.value = {
            tracks: [
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 20 } }], {
                    frozen: true,
                    frozenTailSeconds: 10,
                }),
            ],
        };

        expect(getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true }).seconds).toBe(10);
    });

    it('never reserves zero for a frozen buffer whose chain cannot answer', () => {
        // The chain fallback is bounded below by zero, so every shape where the
        // chain has nothing to say collapsed to "no tail" for a buffer that
        // still decays. Freezing a track with no inserts is completely ordinary
        // — people freeze to lock CPU or print automation — and bypass is
        // unguarded on frozen tracks.
        const shapes: Array<[string, ReturnType<typeof makeTrack>]> = [
            ['empty device list', makeTrack([], { frozenWithoutRenderSettings: true })],
            [
                'all devices bypassed',
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 20 }, bypassed: true }], {
                    frozenWithoutRenderSettings: true,
                }),
            ],
            ['device with no declaration', makeTrack([{ type: 'builtin-eq' }], { frozenWithoutRenderSettings: true })],
        ];

        for (const [label, track] of shapes) {
            mockTrackStore.value = { tracks: [track] };
            const seconds = getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true }).seconds;
            expect(seconds, `${label} reserved nothing`).toBe(UNKNOWN_FROZEN_TAIL_SECONDS);
        }
    });

    it('reports the clamp when an unknown frozen chain exceeds the ceiling on its own', () => {
        // The unknown-tail path feeds its chain estimate back through the
        // estimator. If that nested call returned the already-clamped `seconds`,
        // a chain over the ceiling would re-enter as exactly the ceiling and the
        // outer `> MAX_AUTO_TAIL_SECONDS` check would read false — reporting an
        // un-clamped figure for a truncated estimate. Two 40 s reverbs in series
        // sum to 80 s, so only the uncapped total can trip the outer clamp.
        mockTrackStore.value = {
            tracks: [
                makeTrack(
                    [
                        { type: 'builtin-reverb', parameterValues: { 'rev-decay': 40 } },
                        { type: 'builtin-reverb', parameterValues: { 'rev-decay': 40 } },
                    ],
                    { frozenWithoutRenderSettings: true }
                ),
            ],
        };

        const detected = getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true });
        expect(detected.seconds).toBe(60);
        expect(detected.clamped).toBe(true);
    });

    it('treats a negative recorded tail as unknown rather than trusting it as zero', () => {
        // Both validators check finiteness and never sign, so -5 persists and
        // loads. `Math.max(0, -5)` laundered it into a trusted zero.
        mockTrackStore.value = {
            tracks: [makeTrack([], { frozen: true, frozenTailSeconds: -5 })],
        };

        expect(getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true }).seconds).toBe(
            UNKNOWN_FROZEN_TAIL_SECONDS
        );
    });

    it('falls back to the device chain when a frozen track records no baked tail', () => {
        // `isFreezeState` accepts a frozen track with `renderSettings`
        // undefined, so this shape loads from disk legitimately. Reading zero
        // there reserves nothing for a buffer that still carries a decay — the
        // round-4 defect, reached through the persistence layer instead.
        // The chain must exceed the unknown-tail floor to show it is the chain
        // being used and not the floor.
        mockTrackStore.value = {
            tracks: [
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 40 } }], {
                    frozenWithoutRenderSettings: true,
                }),
            ],
        };

        expect(getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true }).seconds).toBe(40);
    });

    it('does not grant a muted frozen track the pre-fader send exception', () => {
        // A frozen buffer is wired to `trackGainNode` (the fader), downstream of
        // `preFaderTap`, so it bypasses the device chain and the tap the
        // exception depends on. Frozen and pre-fader-audible are exclusive.
        mockTrackStore.value = {
            tracks: [
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 20 } }], {
                    muted: true,
                    frozen: true,
                    frozenTailSeconds: 10,
                    sends: [{ busId: 'bus-1', preFader: true }],
                }),
                makeTrack([], { id: 'bus-1', kind: 'bus' }),
            ],
        };

        expect(getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true }).seconds).toBe(0);
    });

    it('ignores a frozen track, whose device chain never runs', () => {
        // `scheduleTrackClips` connects the frozen buffer straight to
        // `trackGainNode`, skipping `trackInputNode` "to bypass device chain
        // processing" — those devices produce no audio in any export mode, so
        // reserving their tails is pure wasted render time.
        mockTrackStore.value = {
            tracks: [
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 20 } }], { frozen: true }),
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 1.5 } }], { id: 'track-2' }),
            ],
        };

        expect(getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true }).seconds).toBe(1.5);
    });

    it('ignores a disabled track, which is never given a strip', () => {
        mockTrackStore.value = {
            tracks: [
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 20 } }], { disabled: true }),
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 1.5 } }], { id: 'track-2' }),
            ],
        };

        expect(getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true }).seconds).toBe(1.5);
    });

    it('ignores a muted track when the export honours mute, as a mixdown does', () => {
        mockTrackStore.value = {
            tracks: [
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 20 } }], { muted: true }),
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 1.5 } }], { id: 'track-2' }),
            ],
        };

        expect(getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true }).seconds).toBe(1.5);
    });

    it('counts a muted track when the export ignores mute, as a stem set does', () => {
        // `exportStems` builds strips with `honorMuted: false` so a muted track
        // still exports its full content — cutting its tail would truncate the
        // stem itself.
        mockTrackStore.value = {
            tracks: [makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 20 } }], { muted: true })],
        };

        expect(getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: false }).seconds).toBe(20);
    });

    it('counts a muted track that still feeds a bus through a pre-fader send', () => {
        // Devices sit before the pre-fader tap, so a muted track's cue send keeps
        // feeding its bus and stays audible in the mixdown.
        mockTrackStore.value = {
            tracks: [
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 20 } }], {
                    muted: true,
                    sends: [{ busId: 'bus-1', preFader: true }],
                }),
                makeTrack([], { id: 'bus-1', kind: 'bus' }),
            ],
        };

        expect(getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true }).seconds).toBe(20);
    });

    it('still ignores a muted track whose only send is post-fader', () => {
        // A post-fader send sits after the mute node, so it carries nothing.
        mockTrackStore.value = {
            tracks: [
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 20 } }], {
                    muted: true,
                    sends: [{ busId: 'bus-1', preFader: false }],
                }),
                makeTrack([], { id: 'bus-1', kind: 'bus' }),
            ],
        };

        expect(getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true }).seconds).toBe(0);
    });

    it('reports when the estimate was clamped to the ceiling', () => {
        const uncapped = makeTrack(
            [
                { type: 'builtin-reverb', parameterValues: { 'rev-decay': 40 } },
                { type: 'builtin-reverb', parameterValues: { 'rev-decay': 40 } },
            ],
            { id: 'track-1' }
        );
        mockTrackStore.value = { tracks: [uncapped] };

        const capped = getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true });
        expect(capped.seconds).toBe(60);
        expect(capped.clamped).toBe(true);

        mockTrackStore.value = {
            tracks: [makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 5 } }])],
        };
        const withinCeiling = getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true });
        expect(withinCeiling.seconds).toBe(5);
        expect(withinCeiling.clamped).toBe(false);
    });

    it('projects each track device shape into estimateRenderTailSeconds', () => {
        // Reverb decay of 4s is the dominant tail; expected result 4 (clamped to <=30).
        mockTrackStore.value = {
            tracks: [
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 4 } }]),
                makeTrack([{ type: 'builtin-eq' }]),
            ],
        };

        expect(getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true }).seconds).toBe(4);
    });

    it('skips bypassed devices so their tail no longer counts', () => {
        mockTrackStore.value = {
            tracks: [
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 4 }, bypassed: true }]),
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 1.5 } }]),
            ],
        };

        expect(getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true }).seconds).toBe(1.5);
    });

    it('returns 0 when the track store has no state', () => {
        mockTrackStore.value = null;
        expect(getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true }).seconds).toBe(0);
    });

    it('reserves a track’s chain plus the bus chain it plays through', () => {
        // The reason routing is projected at all. A track carrying a delay into
        // a bus carrying a reverb needs both to resolve: the bus reverb only
        // starts decaying the delay's last echo when that echo arrives. Scored
        // as two independent chains this reserved 2 s and cut the rest.
        mockTrackStore.value = {
            tracks: [
                makeTrack([{ type: 'builtin-delay' }], { id: 'track-1', outputId: 'bus-1' }),
                makeTrack([{ type: 'builtin-reverb' }], { id: 'bus-1', kind: 'bus', outputId: 'master' }),
            ],
        };

        const delaySeconds = 0.25 * (Math.log(0.001) / Math.log(0.4));
        expect(getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true }).seconds).toBeCloseTo(
            delaySeconds + 2,
            6
        );
    });

    it('forwards the device projection together with the descriptor-declared tail', () => {
        const spy = vi.spyOn(estimateMod, 'estimateRenderTailSeconds');
        mockTrackStore.value = {
            tracks: [makeTrack([{ type: 'builtin-delay', parameterValues: { 'delay-time': 300 } }])],
        };

        getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true });
        expect(spy).toHaveBeenCalledTimes(1);
        const projected = spy.mock.calls[0]![0];
        // The tail declaration has to come from the device's own descriptor —
        // the estimator is pure and cannot look it up itself, so a missing
        // lookup here silently turns every tail into zero. The routing edges
        // travel by the same rule: without them the estimator cannot follow a
        // track into the bus chain it plays through.
        expect(projected).toEqual([
            {
                id: 'track-1',
                outputId: undefined,
                sends: [],
                devices: [
                    {
                        id: 'builtin-delay-1',
                        type: 'builtin-delay',
                        parameterValues: { 'delay-time': 300 },
                        deviceState: undefined,
                        bypassed: false,
                        automatedParameterIds: [],
                        tail: {
                            kind: 'feedbackLoop',
                            feedbackParameterId: 'delay-feedback',
                            defaultFeedback: 0.4,
                            maxFeedback: 0.95,
                            loopParameterId: 'delay-time',
                            loopUnit: 'ms',
                            defaultLoopSeconds: 0.25,
                        },
                    },
                ],
            },
        ]);
    });

    it('leaves a device with no declared tail undeclared in the projection', () => {
        const spy = vi.spyOn(estimateMod, 'estimateRenderTailSeconds');
        mockTrackStore.value = { tracks: [makeTrack([{ type: 'builtin-eq' }])] };

        getAutoDetectedTailSeconds({ tailForDeviceType, honorMuted: true });
        const projected = spy.mock.calls[0]![0];
        expect(projected[0]!.devices[0]!.tail).toBeUndefined();
    });
});
