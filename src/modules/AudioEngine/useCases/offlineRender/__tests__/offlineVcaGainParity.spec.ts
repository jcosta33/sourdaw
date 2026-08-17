import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveVcaMultiplier, trackStore, vcaGroupStore } from '#/modules/Arrangement/stores';
import { getEffectiveGain, normalizeTrack } from '#/modules/Arrangement/useCases';
import { clampFaderGain, dbToGain, gainToDb } from '#/utils/audioLevelLaw';

import { type AutomationLane } from '../../../models/AutomationViewTypes';
import { scheduleTrackAutomationFixture } from '../../../repositories/offlineScheduler/__tests__/scheduleTrackAutomationFixture';
import { createOfflineTrackStrip } from '../createOfflineTrackStrip';

const mocks = vi.hoisted(() => ({
    buildDeviceChain: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../buildDeviceChain', () => ({
    buildDeviceChain: mocks.buildDeviceChain,
}));

function makeOfflineCtx(): OfflineAudioContext {
    return {
        createGain: vi.fn(() => ({ gain: { value: -1 }, connect: vi.fn() })),
        createStereoPanner: vi.fn(() => ({ pan: { value: 0 }, connect: vi.fn() })),
    } as unknown as OfflineAudioContext;
}

function makeParam() {
    return {
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
    };
}

function makeGainLane(overrides: Partial<AutomationLane>): AutomationLane {
    return {
        id: 'lane-gain',
        trackId: 'track-1',
        clipId: undefined,
        parameterId: 'gain',
        parameterName: 'Gain',
        points: [],
        enabled: true,
        minValue: 0,
        maxValue: 1,
        ...overrides,
    };
}

type SeedVcaProjectInput = {
    trackGain: number;
    groupGain: number;
};

/**
 * Put one VCA-member track and its group into the read model both runtimes
 * resolve their level from.
 */
function seedVcaProject({ trackGain, groupGain }: SeedVcaProjectInput): void {
    trackStore.set({
        tracks: [normalizeTrack({ id: 'track-1', name: 'Kick', kind: 'audio', gain: trackGain, vcaGroupId: 'vca-1' })],
        selectedTrackId: null,
    });
    vcaGroupStore.set({
        groups: [{ id: 'vca-1', name: 'Drums', gain: groupGain, muted: false, trackIds: ['track-1'] }],
    });
}

/**
 * The level the live engine actually plays a VCA-member track's fader at.
 *
 * Live composes in one fixed order and both live writers agree on it:
 * `applyVcaGains` hands `getEffectiveGain(trackId, track.gain)` to
 * `setTrackGain`, and the gain-automation branch of `applyAutomation` hands
 * `dbToGain(value) * getEffectiveGain(trackId, 1)` to `scheduleTrackGain`. In
 * both cases `TrackNode` clamps the *product* to the fader ceiling. Clamping
 * before the multiply is a different number, so the order is load-bearing.
 */
function liveFaderGain(trackId: string, faderLinearGain: number): number {
    return clampFaderGain(faderLinearGain * getEffectiveGain(trackId, 1));
}

/**
 * What the offline render resolves for the same track. It reads the group list
 * directly rather than going through `getEffectiveGain`, because AudioEngine
 * cannot import Arrangement's use cases without closing an import cycle — which
 * is exactly why these two numbers are worth asserting against each other.
 */
function offlineVcaMultiplier(trackId: string): number {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    return deriveVcaMultiplier({ vcaGroupId: track?.vcaGroupId, groups: vcaGroupStore.value?.groups ?? [] });
}

describe('offline render composes the VCA multiplier the way live does', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('bounces a VCA-member track at the level it plays, with no gain automation', async () => {
        seedVcaProject({ trackGain: 0.5, groupGain: 0.5 });
        const live = liveFaderGain('track-1', 0.5);

        const strip = await createOfflineTrackStrip(
            makeOfflineCtx(),
            { id: 'track-1', name: 'Kick', gain: 0.5, muted: false, pan: 0, devices: [] },
            { vcaMultiplier: offlineVcaMultiplier('track-1') }
        );

        expect(live).toBeCloseTo(0.25, 10);
        expect(strip.faderNode.gain.value).toBeCloseTo(live, 10);
        expect(gainToDb(strip.faderNode.gain.value) - gainToDb(live)).toBeCloseTo(0, 6);
    });

    it('bounces an automated gain lane on a VCA-member track at the level it plays', () => {
        seedVcaProject({ trackGain: 0.8, groupGain: 0.5 });
        // A -6 dB lane point: live converts dB to linear, multiplies the VCA
        // multiplier in, then clamps.
        const live = liveFaderGain('track-1', dbToGain(-6));

        const gain = makeParam();
        scheduleTrackAutomationFixture({
            lanes: [
                makeGainLane({
                    minValue: -60,
                    maxValue: 6,
                    points: [{ beat: 0, value: -6, curve: 'linear', tension: 0 }],
                }),
            ],
            trackId: 'track-1',
            trackGainNode: { gain } as unknown as GainNode,
            trackPanNode: { pan: makeParam() } as unknown as StereoPannerNode,
            deviceEntries: [],
            durationSeconds: 10,
            defaultTempo: 120,
            changes: [],
            regionStartSeconds: 0,
            sampleRate: 44_100,
            compensationDelaySec: 0,
            vcaMultiplier: offlineVcaMultiplier('track-1'),
        });

        expect(live).toBeCloseTo(0.250_593_6, 7);
        expect(gain.setValueAtTime).toHaveBeenCalledWith(live, 0);
    });

    it('clamps the VCA-composed product to the fader ceiling instead of clamping before the multiply', async () => {
        // Clamp-then-multiply would give 0.8 * 2 = 1.6 on the output; the live
        // order (multiply, then clamp) tops out at unity.
        seedVcaProject({ trackGain: 0.8, groupGain: 2 });
        const live = liveFaderGain('track-1', 0.8);

        const strip = await createOfflineTrackStrip(
            makeOfflineCtx(),
            { id: 'track-1', name: 'Kick', gain: 0.8, muted: false, pan: 0, devices: [] },
            { vcaMultiplier: offlineVcaMultiplier('track-1') }
        );

        expect(live).toBe(1);
        expect(strip.faderNode.gain.value).toBe(1);
    });

    it('leaves a track outside every VCA group at its own fader level', async () => {
        trackStore.set({
            tracks: [normalizeTrack({ id: 'track-1', name: 'Kick', kind: 'audio', gain: 0.5 })],
            selectedTrackId: null,
        });
        vcaGroupStore.set({ groups: [] });

        const strip = await createOfflineTrackStrip(
            makeOfflineCtx(),
            { id: 'track-1', name: 'Kick', gain: 0.5, muted: false, pan: 0, devices: [] },
            { vcaMultiplier: offlineVcaMultiplier('track-1') }
        );

        expect(offlineVcaMultiplier('track-1')).toBe(1);
        expect(strip.faderNode.gain.value).toBe(0.5);
    });
});
