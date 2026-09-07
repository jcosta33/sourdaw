/**
 * `projectStripAutomationWrites` is the export's per-strip automation
 * projection, extracted out of `renderOfflineWithNativeEngine.ts` so the live
 * producer can share it (#3068). These specs pin its own contract directly,
 * with plain lane fixtures and no store or backend — the parity between this
 * projection and the actual export is `renderOfflineNativeParity.spec.ts`'s
 * job, not this file's.
 */

import { describe, expect, it } from 'vitest';

import { type Clip, type Device, type Track } from '#/modules/Arrangement/stores';
import { clampFaderGain, dbToGain, FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type AutomationLane, type AutomationPoint } from '../../../models/AutomationViewTypes';
import {
    projectStripAutomationWrites,
    type StripAutomationDeviceEntry,
    type StripAutomationWritesInput,
} from '../projectStripAutomationWrites';

function createTrack(overrides?: Partial<Track>): Track {
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
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'hw_out',
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
        ...overrides,
    };
}

function point(beat: number, value: number, curve: AutomationPoint['curve'] = 'step'): AutomationPoint {
    return { beat, value, curve, tension: 0 };
}

function clip(overrides: Partial<Clip> & Pick<Clip, 'id' | 'startBeat' | 'endBeat'>): Clip {
    return {
        trackId: 'track-1',
        name: 'Clip',
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#00ff00',
        locked: false,
        muted: false,
        ...overrides,
    };
}

/**
 * A single-point lane is deliberately simple: `compileAutomationEvents` never
 * enters its interpolation loop for one point, so it emits exactly one `set`
 * event carrying the point's own value at the region's own start — nothing
 * here depends on curve or interpolation behaviour this module does not own.
 */
function lane(overrides: Partial<AutomationLane> & Pick<AutomationLane, 'parameterId' | 'points'>): AutomationLane {
    return {
        id: `lane-${overrides.parameterId}`,
        trackId: 'track-1',
        parameterName: overrides.parameterId,
        enabled: true,
        minValue: 0,
        maxValue: 1,
        ...overrides,
    };
}

const baseInput: Omit<StripAutomationWritesInput, 'track' | 'lanes' | 'admittedSendBusIds'> = {
    regionStartSeconds: 0,
    durationSeconds: 4,
    defaultTempo: 120,
    changes: [],
    projectBeatToSeconds: (beat) => beat,
    sampleRate: 48_000,
    compensationDelaySec: 0,
    vcaMultiplier: 1,
    slewTickSeconds: 0.01,
    resolveLaneCeiling: (candidate) => candidate.maxValue,
};

describe('projectStripAutomationWrites — the target table', () => {
    it('projects one target for the fader, the pan, and each admitted send bus', () => {
        const track = createTrack();
        const lanes: AutomationLane[] = [
            lane({ parameterId: 'gain', points: [point(0, 0.7)], minValue: 0, maxValue: FADER_MAX_GAIN }),
            lane({ parameterId: 'pan', points: [point(0, 0.25)], minValue: -1, maxValue: 1 }),
            lane({ parameterId: 'send:bus-a', points: [point(0, 0.6)], minValue: 0, maxValue: 1 }),
        ];

        const result = projectStripAutomationWrites({
            ...baseInput,
            track,
            admittedSendBusIds: ['bus-a'],
            lanes,
        });

        expect(result.outcome).toBe('converted');
        if (result.outcome !== 'converted') {
            throw new Error('unreachable: asserted above');
        }
        expect(result.entries.map((entry) => entry.target)).toEqual([
            { kind: 'track-fader', trackId: track.id },
            { kind: 'track-pan', trackId: track.id },
            { kind: 'track-send-level', trackId: track.id, busId: 'bus-a' },
        ]);
        // Every write's own value law is pinned separately below — this test
        // is about which targets exist, not what they carry.
        for (const entry of result.entries) {
            expect(entry.writes).toHaveLength(1);
        }
    });

    it('projects a send-level target per admitted bus, and nothing for an unadmitted one', () => {
        const track = createTrack();
        const lanes: AutomationLane[] = [
            lane({ parameterId: 'send:bus-a', points: [point(0, 0.4)], minValue: 0, maxValue: 1 }),
            lane({ parameterId: 'send:bus-b', points: [point(0, 0.9)], minValue: 0, maxValue: 1 }),
            // Never admitted: the topology never built this bus, so the
            // extraction gives it no recorder and no target, exactly as it
            // gives the export no `add-send` command for it.
            lane({ parameterId: 'send:bus-c', points: [point(0, 0.5)], minValue: 0, maxValue: 1 }),
        ];

        const result = projectStripAutomationWrites({
            ...baseInput,
            track,
            admittedSendBusIds: ['bus-a', 'bus-b'],
            lanes,
        });

        expect(result.outcome).toBe('converted');
        if (result.outcome !== 'converted') {
            throw new Error('unreachable: asserted above');
        }
        expect(result.entries.map((entry) => entry.target)).toEqual([
            { kind: 'track-send-level', trackId: track.id, busId: 'bus-a' },
            { kind: 'track-send-level', trackId: track.id, busId: 'bus-b' },
        ]);
    });
});

describe('projectStripAutomationWrites — the seam-value inversions', () => {
    it('rounds a decibel fader value through clampFaderGain and the VCA-multiplier inversion', () => {
        const track = createTrack();
        const vcaMultiplier = 0.5;
        const faderDb = -6;
        const lanes: AutomationLane[] = [
            lane({ parameterId: 'gain', points: [point(0, faderDb)], minValue: -60, maxValue: 6 }),
        ];

        const result = projectStripAutomationWrites({
            ...baseInput,
            track,
            admittedSendBusIds: [],
            lanes,
            vcaMultiplier,
        });

        expect(result.outcome).toBe('converted');
        if (result.outcome !== 'converted') {
            throw new Error('unreachable: asserted above');
        }
        const faderEntry = result.entries.find((entry) => entry.target.kind === 'track-fader');
        expect(faderEntry).toBeDefined();
        const write = faderEntry!.writes[0];
        expect(write?.shape).toBe('step');
        // The scheduler recorded `clampFaderGain(dbToGain(value) * vcaMultiplier)`
        // in node domain; the seam divides the multiplier back out
        // (`seamFaderValue`). Neither factor clips here, so the round trip
        // lands back on the dB value's own linear gain.
        const nodeGain = clampFaderGain(dbToGain(faderDb) * vcaMultiplier);
        expect((write as { value: number }).value).toBeCloseTo(nodeGain / vcaMultiplier, 10);
        expect((write as { value: number }).value).toBeCloseTo(dbToGain(faderDb), 10);
    });

    it('rounds a pan value back to the project scale through the ×50 inversion', () => {
        const track = createTrack();
        const panValue = -0.4;
        const lanes: AutomationLane[] = [
            lane({ parameterId: 'pan', points: [point(0, panValue)], minValue: -1, maxValue: 1 }),
        ];

        const result = projectStripAutomationWrites({ ...baseInput, track, admittedSendBusIds: [], lanes });

        expect(result.outcome).toBe('converted');
        if (result.outcome !== 'converted') {
            throw new Error('unreachable: asserted above');
        }
        const panEntry = result.entries.find((entry) => entry.target.kind === 'track-pan');
        const write = panEntry!.writes[0];
        expect(write?.shape).toBe('step');
        // Pan carries no `valueTransform`, so the recorded node-domain value is
        // the lane's own point value; `seamPanValue` maps it onto the −50…50
        // project scale by the inverse of the same factor a real
        // `StereoPannerNode`'s nominal range implies.
        expect((write as { value: number }).value).toBeCloseTo(panValue * 50, 10);
    });

    it('collapses every fader write to exactly 0 under a zero VCA multiplier, never NaN', () => {
        const track = createTrack();
        const vcaMultiplier = 0;
        // A non-silent, moving lane: `clampFaderGain(value * 0)` records 0 at
        // every sampled point regardless, so the seam's zero-multiplier branch
        // is what has to hold the write at 0 rather than divide by 0.
        const lanes: AutomationLane[] = [
            lane({
                parameterId: 'gain',
                points: [point(0, 0.5, 'linear'), point(4, 1.5, 'linear')],
                minValue: 0,
                maxValue: 2,
            }),
        ];

        const result = projectStripAutomationWrites({
            ...baseInput,
            track,
            admittedSendBusIds: [],
            lanes,
            vcaMultiplier,
        });

        expect(result.outcome).toBe('converted');
        if (result.outcome !== 'converted') {
            throw new Error('unreachable: asserted above');
        }
        const faderEntry = result.entries.find((entry) => entry.target.kind === 'track-fader');
        expect(faderEntry).toBeDefined();
        expect(faderEntry!.writes.length).toBeGreaterThan(0);
        // `seamFaderValue`'s guard returns 0 explicitly for a zero multiplier;
        // `recorded / vcaMultiplier` would divide 0 by 0 and write NaN instead.
        for (const write of faderEntry!.writes) {
            expect((write as { value: number }).value).toBe(0);
        }
    });
});

describe('projectStripAutomationWrites — an orphan device lane (#3124)', () => {
    it('silently drops an enabled lane outside the fader, pan, and admitted-send families, matching main', () => {
        // A device lane with no device left to resolve against — the shape
        // `prepareRemoveDevice.ts` leaves behind, since it deletes the device
        // and never the lane. `scheduleTrackAutomation` resolves it against an
        // empty device chain, finds nothing, and drops it; this projection
        // must reproduce exactly that, never decline the whole strip over it
        // (the live producer detects and names the lane on its own — see
        // `projectLiveAutomationWrites.spec.ts`).
        const track = createTrack();
        const lanes: AutomationLane[] = [
            lane({ parameterId: 'gain', points: [point(0, 0.8)] }),
            lane({ parameterId: 'grinder-1:cutoff', points: [point(0, 0.3)] }),
        ];

        const result = projectStripAutomationWrites({ ...baseInput, track, admittedSendBusIds: [], lanes });

        expect(result.outcome).toBe('converted');
        if (result.outcome !== 'converted') {
            throw new Error('unreachable: asserted above');
        }
        expect(result.entries.map((entry) => entry.target.kind)).toEqual(['track-fader']);
        expect(result.entries[0]!.writes).toHaveLength(1);
    });
});

describe('projectStripAutomationWrites — clip-scoped lanes', () => {
    it("confines a clip-scoped gain lane's writes to its own clip window", () => {
        // The clip window is `scheduleTrackAutomation`'s own bound
        // (`activeWindowSeconds`), keyed by `clipBoundsById` — built inside
        // this extraction from the track's own `clips`. `projectBeatToSeconds`
        // is the identity here, so the clip's beat window and its expected
        // second window are the same numbers, computed independently of
        // whatever tempo the fixture happens to carry.
        const scopedClip = clip({ id: 'clip-1', startBeat: 2, endBeat: 6 });
        const track = createTrack({ clips: [scopedClip] });
        const lanes: AutomationLane[] = [
            lane({
                parameterId: 'gain',
                clipId: scopedClip.id,
                points: [point(0, 0.2), point(3, 0.6), point(8, 0.9)],
                minValue: 0,
                maxValue: 2,
            }),
        ];

        const result = projectStripAutomationWrites({
            ...baseInput,
            track,
            admittedSendBusIds: [],
            lanes,
            durationSeconds: 10,
        });

        expect(result.outcome).toBe('converted');
        if (result.outcome !== 'converted') {
            throw new Error('unreachable: asserted above');
        }
        const faderEntry = result.entries.find((entry) => entry.target.kind === 'track-fader');
        expect(faderEntry).toBeDefined();
        expect(faderEntry!.writes.length).toBeGreaterThan(0);
        for (const write of faderEntry!.writes) {
            const time = (write as { time: number }).time;
            expect(time).toBeGreaterThanOrEqual(scopedClip.startBeat);
            expect(time).toBeLessThanOrEqual(scopedClip.endBeat);
        }
    });

    it('emits nothing for a lane scoped to a clip the track does not hold', () => {
        // The track's own `clips` is empty here, so this pins the drop
        // itself — a clip id the track never carries resolves to no bounds,
        // and the scheduler's own drop condition (mirrored in
        // `clipBoundsById?.get(...) ?? continue`) skips the lane exactly as
        // it would skip one on a clip that was deleted out from under it.
        // An empty `clipBoundsById` would not turn this one red — an empty
        // `track.clips` already produces an empty map, so the lane drops
        // either way; it is the clip-window test above that pins what the
        // map actually holds when a clip is present.
        const track = createTrack({ clips: [] });
        const lanes: AutomationLane[] = [
            lane({ parameterId: 'gain', clipId: 'clip-does-not-exist', points: [point(0, 0.5)] }),
        ];

        const result = projectStripAutomationWrites({ ...baseInput, track, admittedSendBusIds: [], lanes });

        expect(result.outcome).toBe('converted');
        if (result.outcome !== 'converted') {
            throw new Error('unreachable: asserted above');
        }
        expect(result.entries.find((entry) => entry.target.kind === 'track-fader')).toBeUndefined();
    });
});

describe('projectStripAutomationWrites — no lanes', () => {
    it('converts a track carrying no automation lanes into zero entries', () => {
        const track = createTrack();

        const result = projectStripAutomationWrites({ ...baseInput, track, admittedSendBusIds: [], lanes: [] });

        expect(result).toEqual({ outcome: 'converted', entries: [] });
    });

    it('converts a track whose automationMode is off into zero entries without reading its lanes', () => {
        const track = createTrack({ automationMode: 'off' });
        const lanes: AutomationLane[] = [lane({ parameterId: 'gain', points: [point(0, 0.8)] })];

        const result = projectStripAutomationWrites({ ...baseInput, track, admittedSendBusIds: [], lanes });

        expect(result).toEqual({ outcome: 'converted', entries: [] });
    });
});

/**
 * The device half of the projection (#3568). A caller that names devices and
 * supplies a law gets an entry per automated parameter, addressed by the
 * plugin's own numeric parameter id; a caller that names none gets exactly what
 * it got before, which is what keeps the export byte-for-byte unchanged.
 */
describe('projectStripAutomationWrites — a hosted device lane (#3568)', () => {
    const hostedDevice: Device = {
        id: 'plugin-1',
        name: 'Compressor',
        type: 'external-plugin',
        bypassed: false,
        parameterValues: {},
        externalInstanceId: 'instance-1',
    };

    const deviceEntries: StripAutomationDeviceEntry[] = [
        { deviceId: hostedDevice.id, deviceType: hostedDevice.type, externalInstanceId: 'instance-1' },
    ];

    const deviceParameterLaw: StripAutomationWritesInput['deviceParameterLaw'] = {
        acceptsAutomation: ({ deviceId, parameterId }) => deviceId === hostedDevice.id && parameterId === '7',
        clampValue: ({ value }) => value,
        quantiseValue: ({ value }) => value,
    };

    it('projects a named hosted device parameter into step writes opening at the region start', () => {
        const track = createTrack({ devices: [hostedDevice] });
        const lanes: AutomationLane[] = [lane({ parameterId: 'plugin-1:7', points: [point(0, 0.6)] })];

        const result = projectStripAutomationWrites({
            ...baseInput,
            track,
            admittedSendBusIds: [],
            lanes,
            deviceEntries,
            deviceParameterLaw,
        });

        expect(result.outcome).toBe('converted');
        if (result.outcome !== 'converted') {
            throw new Error('unreachable: asserted above');
        }
        const entry = result.entries.find((candidate) => candidate.target.kind === 'device-parameter');
        expect(entry?.target).toEqual({
            kind: 'device-parameter',
            trackId: track.id,
            deviceId: hostedDevice.id,
            parameterId: '7',
        });
        // Region-relative and stepped: the seed the compiler opens every span
        // with is what converges a plugin the pass was armed in the middle of.
        expect(entry?.writes[0]).toEqual({ shape: 'step', value: 0.6, time: 0 });
    });

    it('leaves a lane on a device the law refuses unprojected', () => {
        const track = createTrack({ devices: [hostedDevice] });
        const lanes: AutomationLane[] = [lane({ parameterId: 'plugin-1:9', points: [point(0, 0.6)] })];

        const result = projectStripAutomationWrites({
            ...baseInput,
            track,
            admittedSendBusIds: [],
            lanes,
            deviceEntries,
            deviceParameterLaw,
        });

        expect(result).toEqual({ outcome: 'converted', entries: [] });
    });

    it('names no device target for a caller that supplies no device entries', () => {
        const track = createTrack({ devices: [hostedDevice] });
        const lanes: AutomationLane[] = [lane({ parameterId: 'plugin-1:7', points: [point(0, 0.6)] })];

        const result = projectStripAutomationWrites({ ...baseInput, track, admittedSendBusIds: [], lanes });

        expect(result).toEqual({ outcome: 'converted', entries: [] });
    });
});
