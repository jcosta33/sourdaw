import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: { value: null as { tracks: unknown[] } | null },
}));

import { trackStore } from '#/modules/Arrangement/stores';

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

/** Stands in for the descriptor lookup the export dialog injects. */
const tailForDeviceType = (deviceType: string) => {
    if (deviceType === 'builtin-reverb') {
        return REVERB_TAIL;
    }
    if (deviceType === 'builtin-delay') {
        return DELAY_TAIL;
    }
    return undefined;
};

type MutableTrackStore = { value: { tracks: unknown[] } | null };
const mockTrackStore = trackStore as unknown as MutableTrackStore;

type TrackOverrides = {
    muted?: boolean;
    disabled?: boolean;
    frozen?: boolean;
    kind?: string;
    id?: string;
    sends?: Array<{ busId: string; preFader: boolean }>;
};

function makeTrack(
    devices: Array<{ type: string; parameterValues?: Record<string, number>; bypassed?: boolean }>,
    overrides: TrackOverrides = {}
) {
    return {
        id: overrides.id ?? 'track-1',
        kind: overrides.kind ?? 'audio',
        muted: overrides.muted ?? false,
        disabled: overrides.disabled ?? false,
        freezeState: { status: overrides.frozen === true ? 'frozen' : 'unfrozen' },
        sends: overrides.sends ?? [],
        devices: devices.map((d) => ({
            type: d.type,
            parameterValues: d.parameterValues ?? {},
            bypassed: d.bypassed ?? false,
        })),
    };
}

describe('getAutoDetectedTailSeconds', () => {
    beforeEach(() => {
        mockTrackStore.value = null;
        vi.restoreAllMocks();
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
        // lookup here silently turns every tail into zero.
        expect(projected).toEqual([
            {
                devices: [
                    {
                        type: 'builtin-delay',
                        parameterValues: { 'delay-time': 300 },
                        bypassed: false,
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
