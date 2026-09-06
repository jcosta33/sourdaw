/**
 * `projectLiveAutomationWrites` is the live twin of the export's per-strip
 * automation projection (#3068): same law, shared via
 * `projectStripAutomationWrites`, but writes land in absolute engine-clock
 * seconds, an orphan device lane is excluded by name rather than silently
 * dropped, and a declined strip is excluded rather than refusing the batch.
 * These specs pin exactly that seam — clipping and time-shifting are
 * `compileAutomationEvents`'s own contract, pinned by its own specs.
 */

import { describe, expect, it } from 'vitest';

import { type Clip, type Device, type Track } from '#/modules/Arrangement/stores';

import { type AutomationLane, type AutomationPoint } from '../../../models/AutomationViewTypes';
import {
    REFUSE_DEVICE_AUTOMATION,
    type StripAutomationDeviceEntry,
} from '../../offlineRender/projectStripAutomationWrites';
import { projectLiveAutomationWrites, type LiveAutomationWritesInput } from '../projectLiveAutomationWrites';

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

function lane(
    overrides: Partial<AutomationLane> & Pick<AutomationLane, 'trackId' | 'parameterId' | 'points'>
): AutomationLane {
    return {
        id: `lane-${overrides.trackId}-${overrides.parameterId}`,
        parameterName: overrides.parameterId,
        enabled: true,
        minValue: 0,
        maxValue: 1,
        ...overrides,
    };
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

const baseInput: Omit<LiveAutomationWritesInput, 'stripTracks' | 'lanes' | 'regionStartSeconds' | 'regionEndSeconds'> =
    {
        defaultTempo: 120,
        changes: [],
        projectBeatToSeconds: (beat) => beat,
        sampleRate: 48_000,
        compensationDelaySeconds: () => 0,
        vcaMultiplierByTrackId: new Map(),
        slewTickSeconds: 0.01,
        resolveLaneCeiling: (candidate) => candidate.maxValue,
        // A session carrying nothing natively, held to the refusing law: what
        // every spec below this line inherits, and what main's behaviour was.
        carriedDeviceEntries: () => [],
        deviceParameterLaw: REFUSE_DEVICE_AUTOMATION,
    };

describe('projectLiveAutomationWrites — region clipping', () => {
    it('clips a segment crossing the region end to the compiler’s own re-interpolated boundary, slope preserved', () => {
        const track = createTrack();
        const regionStartSeconds = 100;
        const regionEndSeconds = 104;
        // A linear gain ramp from (101, 0.2) to (105, 1.0): the region ends at
        // 104, inside the segment, so the compiler must emit the value the
        // segment's own slope reaches at 104 — not 1.0, and not silence.
        const startBeat = 101;
        const startValue = 0.2;
        const endBeat = 105;
        const endValue = 1.0;
        const fractionAtRegionEnd = (regionEndSeconds - startBeat) / (endBeat - startBeat);
        const clippedValue = startValue + (endValue - startValue) * fractionAtRegionEnd;

        const lanes: AutomationLane[] = [
            lane({
                trackId: track.id,
                parameterId: 'gain',
                minValue: 0,
                maxValue: 2,
                points: [point(startBeat, startValue, 'linear'), point(endBeat, endValue, 'linear')],
            }),
        ];

        const result = projectLiveAutomationWrites({
            ...baseInput,
            stripTracks: [track],
            lanes,
            regionStartSeconds,
            regionEndSeconds,
        });

        expect(result.exclusions).toEqual([]);
        const faderEntry = result.entries.find((entry) => entry.target.kind === 'track-fader');
        expect(faderEntry).toBeDefined();
        const lastWrite = faderEntry!.writes.at(-1)!;
        expect(lastWrite.shape).toBe('ramp-to');
        expect((lastWrite as { landTime: number }).landTime).toBeCloseTo(regionEndSeconds, 6);
        expect((lastWrite as { value: number }).value).toBeCloseTo(clippedValue, 6);
        // Nothing dispatches at or past the region end — a clipped segment
        // still has to start its ramp strictly before the window it lands in.
        for (const write of faderEntry!.writes) {
            if (write.shape === 'ramp-to') {
                expect(write.startTime).toBeLessThan(regionEndSeconds);
            }
        }
    });
});

describe('projectLiveAutomationWrites — absolute-time offset', () => {
    it('shifts a compiler-relative t=0.25s write to regionStartSeconds + 0.25', () => {
        const track = createTrack();
        const regionStartSeconds = 50;
        const regionEndSeconds = 54;
        // A step lane whose second point lands exactly 0.25s after the region
        // start (curve 'step' emits its landing 'set' at the point's own time,
        // with no interpolation to reason about).
        const lanes: AutomationLane[] = [
            lane({
                trackId: track.id,
                parameterId: 'pan',
                minValue: -1,
                maxValue: 1,
                points: [point(regionStartSeconds, -0.2, 'step'), point(regionStartSeconds + 0.25, 0.4, 'step')],
            }),
        ];

        const result = projectLiveAutomationWrites({
            ...baseInput,
            stripTracks: [track],
            lanes,
            regionStartSeconds,
            regionEndSeconds,
        });

        expect(result.exclusions).toEqual([]);
        const panEntry = result.entries.find((entry) => entry.target.kind === 'track-pan');
        expect(panEntry).toBeDefined();
        const offsetWrite = panEntry!.writes.find(
            (write) => write.shape === 'step' && Math.abs(write.time - (regionStartSeconds + 0.25)) < 1e-6
        );
        expect(offsetWrite).toBeDefined();
        // Pan carries no valueTransform; the seam is the ×50 inversion of the
        // node-domain point value the lane held.
        expect((offsetWrite as { value: number }).value).toBeCloseTo(0.4 * 50, 6);
    });
});

describe('projectLiveAutomationWrites — automationMode off', () => {
    it('produces no entries and no exclusions for a strip with automationMode off, orphan device lane included', () => {
        const track = createTrack({ automationMode: 'off' });
        const lanes: AutomationLane[] = [
            lane({ trackId: track.id, parameterId: 'gain', points: [point(0, 0.5, 'step')] }),
            // An off strip reads no lane at all — the device-lane exclusion
            // loop must not fire either, or removing the `automationMode !==
            // 'off'` guard around it would still pass this test.
            lane({ trackId: track.id, parameterId: 'grinder-1:cutoff', points: [point(0, 0.3, 'step')] }),
        ];

        const result = projectLiveAutomationWrites({
            ...baseInput,
            stripTracks: [track],
            lanes,
            regionStartSeconds: 0,
            regionEndSeconds: 4,
        });

        expect(result).toEqual({ entries: [], exclusions: [] });
    });
});

describe('projectLiveAutomationWrites — device-lane exclusion', () => {
    it('names the orphan lane, not the strip, and still converts the strip’s fader', () => {
        // The shape `prepareRemoveDevice.ts` leaves behind: the device is gone,
        // its lane is not. `projectStripAutomationWrites` silently drops it
        // (matching main); this producer is the one with an exclusion channel,
        // so it must name the lane the writer cannot carry while still moving
        // the fader the web live path keeps moving.
        const track = createTrack({ id: 'track-declined', name: 'Synth' });
        const otherTrack = createTrack({ id: 'track-converted', name: 'Vox' });
        const deviceLane = lane({
            trackId: track.id,
            parameterId: 'grinder-1:cutoff',
            points: [point(0, 0.3, 'step')],
        });
        const lanes: AutomationLane[] = [
            lane({ trackId: track.id, parameterId: 'gain', points: [point(0, 0.5, 'step')] }),
            deviceLane,
            lane({ trackId: otherTrack.id, parameterId: 'gain', points: [point(0, 0.6, 'step')] }),
        ];

        const result = projectLiveAutomationWrites({
            ...baseInput,
            stripTracks: [track, otherTrack],
            lanes,
            regionStartSeconds: 0,
            regionEndSeconds: 4,
        });

        expect(result.exclusions).toEqual([
            {
                stripId: track.id,
                subjectId: deviceLane.id,
                reason: 'device parameter automation has no native body yet (#3124)',
            },
        ]);
        const declinedFader = result.entries.find(
            (entry) => entry.target.kind === 'track-fader' && entry.target.trackId === track.id
        );
        expect(declinedFader).toBeDefined();
        expect(declinedFader!.writes).toHaveLength(1);
        expect(
            result.entries.some(
                (entry) => entry.target.kind === 'track-fader' && entry.target.trackId === otherTrack.id
            )
        ).toBe(true);
    });

    it('does not exclude a disabled device lane, and still converts the strip’s fader', () => {
        const track = createTrack();
        const lanes: AutomationLane[] = [
            lane({ trackId: track.id, parameterId: 'gain', points: [point(0, 0.5, 'step')] }),
            lane({
                trackId: track.id,
                parameterId: 'grinder-1:cutoff',
                points: [point(0, 0.3, 'step')],
                enabled: false,
            }),
        ];

        const result = projectLiveAutomationWrites({
            ...baseInput,
            stripTracks: [track],
            lanes,
            regionStartSeconds: 0,
            regionEndSeconds: 4,
        });

        expect(result.exclusions).toEqual([]);
        const faderEntry = result.entries.find((entry) => entry.target.kind === 'track-fader');
        expect(faderEntry).toBeDefined();
        expect(faderEntry!.writes).toHaveLength(1);
    });

    it('does not exclude an enabled device lane with no points, but does once it carries one', () => {
        // Mirrors `scheduleTrackAutomation`'s own drop condition: a lane
        // resolving to an empty source is one the scheduler was never going
        // to carry, so this producer must not flag it as an exclusion either.
        const track = createTrack();
        const emptyLanes: AutomationLane[] = [
            lane({ trackId: track.id, parameterId: 'gain', points: [point(0, 0.5, 'step')] }),
            lane({ trackId: track.id, parameterId: 'grinder-1:cutoff', points: [] }),
        ];

        const emptyResult = projectLiveAutomationWrites({
            ...baseInput,
            stripTracks: [track],
            lanes: emptyLanes,
            regionStartSeconds: 0,
            regionEndSeconds: 4,
        });

        expect(emptyResult.exclusions).toEqual([]);

        const populatedLane = lane({
            trackId: track.id,
            parameterId: 'grinder-1:cutoff',
            points: [point(0, 0.3, 'step')],
        });
        const populatedLanes: AutomationLane[] = [
            lane({ trackId: track.id, parameterId: 'gain', points: [point(0, 0.5, 'step')] }),
            populatedLane,
        ];

        const populatedResult = projectLiveAutomationWrites({
            ...baseInput,
            stripTracks: [track],
            lanes: populatedLanes,
            regionStartSeconds: 0,
            regionEndSeconds: 4,
        });

        expect(populatedResult.exclusions).toEqual([
            {
                stripId: track.id,
                subjectId: populatedLane.id,
                reason: 'device parameter automation has no native body yet (#3124)',
            },
        ]);
    });
});

describe('projectLiveAutomationWrites — device-lane clip scope', () => {
    it('does not exclude a device lane scoped to a clip the strip does not hold', () => {
        // No spec on the prior head carried a lane with a `clipId` at all, so
        // both the guard and its absence deleted green. `clipBoundsById` here
        // is built from the track's own (empty) `clips` — a clip id the strip
        // never carries resolves to no bounds, the same drop
        // `scheduleTrackAutomation` itself applies, so the lane contributes no
        // automation and must not be named as an exclusion either.
        const track = createTrack();
        const deviceLane = lane({
            trackId: track.id,
            parameterId: 'grinder-1:cutoff',
            clipId: 'clip-not-on-strip',
            points: [point(0, 0.3, 'step')],
        });
        const lanes: AutomationLane[] = [
            lane({ trackId: track.id, parameterId: 'gain', points: [point(0, 0.5, 'step')] }),
            deviceLane,
        ];

        const result = projectLiveAutomationWrites({
            ...baseInput,
            stripTracks: [track],
            lanes,
            regionStartSeconds: 0,
            regionEndSeconds: 4,
        });

        expect(result.exclusions).toEqual([]);
    });

    it('excludes the same lane once it is scoped to a clip the strip does hold', () => {
        const heldClip = clip({ id: 'clip-1', startBeat: 0, endBeat: 4 });
        const track = createTrack({ clips: [heldClip] });
        const deviceLane = lane({
            trackId: track.id,
            parameterId: 'grinder-1:cutoff',
            clipId: heldClip.id,
            points: [point(0, 0.3, 'step')],
        });
        const lanes: AutomationLane[] = [
            lane({ trackId: track.id, parameterId: 'gain', points: [point(0, 0.5, 'step')] }),
            deviceLane,
        ];

        const result = projectLiveAutomationWrites({
            ...baseInput,
            stripTracks: [track],
            lanes,
            regionStartSeconds: 0,
            regionEndSeconds: 4,
        });

        expect(result.exclusions).toEqual([
            {
                stripId: track.id,
                subjectId: deviceLane.id,
                reason: 'device parameter automation has no native body yet (#3124)',
            },
        ]);
    });
});

describe('projectLiveAutomationWrites — device-lane link resolution', () => {
    it('does not exclude a device lane linked to a lane that does not exist', () => {
        const track = createTrack();
        // One point on the lane itself, deliberately: a linked lane's own
        // points are never read (it adopts the source's), so the only thing
        // that can produce "no exclusion" here is the failed link walk, not
        // an empty-points lane that would have resolved to nothing anyway.
        const deviceLane = lane({
            trackId: track.id,
            parameterId: 'grinder-1:cutoff',
            linkedLaneId: 'lane-does-not-exist',
            points: [point(0, 0.3, 'step')],
        });
        const lanes: AutomationLane[] = [
            lane({ trackId: track.id, parameterId: 'gain', points: [point(0, 0.5, 'step')] }),
            deviceLane,
        ];

        const result = projectLiveAutomationWrites({
            ...baseInput,
            stripTracks: [track],
            lanes,
            regionStartSeconds: 0,
            regionEndSeconds: 4,
        });

        expect(result.exclusions).toEqual([]);
    });

    it('excludes a device lane linked to a populated source lane', () => {
        // The source lane lives on an unrelated track on purpose: link
        // resolution walks the project's whole lane set regardless of which
        // strip it runs for, so this pins that the walk itself — not an
        // accidental trackId match — is what finds the source's points.
        const track = createTrack();
        const sourceLane = lane({
            trackId: 'unrelated-track',
            parameterId: 'grinder-1:cutoff',
            points: [point(0, 0.3, 'step')],
        });
        const deviceLane = lane({
            trackId: track.id,
            parameterId: 'grinder-1:cutoff',
            linkedLaneId: sourceLane.id,
            points: [],
        });
        const lanes: AutomationLane[] = [
            lane({ trackId: track.id, parameterId: 'gain', points: [point(0, 0.5, 'step')] }),
            deviceLane,
            sourceLane,
        ];

        const result = projectLiveAutomationWrites({
            ...baseInput,
            stripTracks: [track],
            lanes,
            regionStartSeconds: 0,
            regionEndSeconds: 4,
        });

        expect(result.exclusions).toEqual([
            {
                stripId: track.id,
                subjectId: deviceLane.id,
                reason: 'device parameter automation has no native body yet (#3124)',
            },
        ]);
    });
});

describe('projectLiveAutomationWrites — dropped-send exclusion', () => {
    it('emits no target for a send lane whose bus the topology never admitted', () => {
        const bus = createTrack({ id: 'bus-a', kind: 'bus', name: 'Bus A' });
        const track = createTrack({
            id: 'track-1',
            sends: [{ busId: 'bus-a', level: 0.5, preFader: false }],
        });
        const lanes: AutomationLane[] = [
            // Admitted: the topology built 'bus-a' as a strip and the track
            // sends into it.
            lane({ trackId: track.id, parameterId: 'send:bus-a', points: [point(0, 0.5, 'step')] }),
            // Dropped: no strip named 'bus-x' exists, so the topology never
            // built an `add-send` command for it — the automation must not
            // name a path the graph never built either.
            lane({ trackId: track.id, parameterId: 'send:bus-x', points: [point(0, 0.9, 'step')] }),
        ];

        const result = projectLiveAutomationWrites({
            ...baseInput,
            stripTracks: [bus, track],
            lanes,
            regionStartSeconds: 0,
            regionEndSeconds: 4,
        });

        expect(result.exclusions).toEqual([]);
        expect(
            result.entries.some((entry) => entry.target.kind === 'track-send-level' && entry.target.busId === 'bus-a')
        ).toBe(true);
        expect(
            result.entries.some((entry) => entry.target.kind === 'track-send-level' && entry.target.busId === 'bus-x')
        ).toBe(false);
    });
});

/**
 * The three outcomes a device lane can have on the live producer (#3568), and
 * why they are three rather than two. A lane the native session carries is
 * projected into a `device-parameter` entry. A hosted lane on a device this
 * session does *not* carry is omitted in silence, because Web Audio is driving
 * that plugin over IPC and naming it excluded would report a working parameter
 * as broken. Anything else keeps the #3124 exclusion it has always had.
 */
describe('projectLiveAutomationWrites — hosted device lanes', () => {
    const hostedDevice: Device = {
        id: 'plugin-1',
        name: 'Compressor',
        type: 'external-plugin',
        bypassed: false,
        parameterValues: {},
        externalInstanceId: 'instance-1',
    };

    const builtinDevice: Device = {
        id: 'grinder-1',
        name: 'Grinder',
        type: 'grinder',
        bypassed: false,
        parameterValues: { cutoff: 0.4 },
    };

    const carriedEntry: StripAutomationDeviceEntry = {
        deviceId: hostedDevice.id,
        deviceType: hostedDevice.type,
        externalInstanceId: 'instance-1',
    };

    /** Accepts this one plugin's parameter 7 and refuses everything else. */
    const hostedLaw: LiveAutomationWritesInput['deviceParameterLaw'] = {
        acceptsAutomation: ({ deviceId, parameterId }) => deviceId === hostedDevice.id && parameterId === '7',
        clampValue: ({ value }) => value,
        quantiseValue: ({ value }) => value,
    };

    it('projects a lane on a carried hosted device into a device-parameter entry', () => {
        const track = createTrack({ devices: [hostedDevice] });
        const result = projectLiveAutomationWrites({
            ...baseInput,
            carriedDeviceEntries: (stripId) => (stripId === track.id ? [carriedEntry] : []),
            deviceParameterLaw: hostedLaw,
            stripTracks: [track],
            lanes: [lane({ trackId: track.id, parameterId: 'plugin-1:7', points: [point(0, 0.3, 'step')] })],
            regionStartSeconds: 0,
            regionEndSeconds: 4,
        });

        expect(result.exclusions).toEqual([]);
        const entry = result.entries.find((candidate) => candidate.target.kind === 'device-parameter');
        expect(entry?.target).toEqual({
            kind: 'device-parameter',
            trackId: track.id,
            deviceId: hostedDevice.id,
            parameterId: '7',
        });
        expect(entry?.writes.length).toBeGreaterThan(0);
        expect(entry?.writes.every((write) => write.shape === 'step')).toBe(true);
    });

    it('omits a lane on a hosted device this session does not carry, without excluding it', () => {
        // The plugin is on the strip and its parameter is automatable; what is
        // missing is the native body. Web Audio is writing it over IPC, so the
        // lane is carried — just not here.
        const track = createTrack({ devices: [hostedDevice] });
        const result = projectLiveAutomationWrites({
            ...baseInput,
            carriedDeviceEntries: () => [],
            deviceParameterLaw: hostedLaw,
            stripTracks: [track],
            lanes: [lane({ trackId: track.id, parameterId: 'plugin-1:7', points: [point(0, 0.3, 'step')] })],
            regionStartSeconds: 0,
            regionEndSeconds: 4,
        });

        expect(result.exclusions).toEqual([]);
        expect(result.entries.some((entry) => entry.target.kind === 'device-parameter')).toBe(false);
    });

    it('still excludes a built-in device lane on a strip whose hosted device is carried', () => {
        const track = createTrack({ devices: [builtinDevice, hostedDevice] });
        const builtinLane = lane({
            trackId: track.id,
            parameterId: 'grinder-1:cutoff',
            points: [point(0, 0.3, 'step')],
        });
        const result = projectLiveAutomationWrites({
            ...baseInput,
            carriedDeviceEntries: () => [carriedEntry],
            deviceParameterLaw: hostedLaw,
            stripTracks: [track],
            lanes: [builtinLane],
            regionStartSeconds: 0,
            regionEndSeconds: 4,
        });

        expect(result.exclusions).toEqual([
            {
                stripId: track.id,
                subjectId: builtinLane.id,
                reason: 'device parameter automation has no native body yet (#3124)',
            },
        ]);
    });
});

/**
 * A built-in the engine builds a body for is in the same position a hosted
 * plugin is (#3893): the session may not be carrying it yet, but the engine
 * *can* carry it, so an uncarried lane on one is omitted in silence rather than
 * reported as automation with nowhere to go. A device the engine builds no body
 * for keeps the exclusion it has always had.
 */
describe('projectLiveAutomationWrites — native built-in device lanes', () => {
    const fermenter: Device = {
        id: 'fermenter-1',
        name: 'Fermenter',
        type: 'fermenter',
        bypassed: false,
        parameterValues: { filterCutoff: 0.4 },
    };

    const crust: Device = {
        id: 'crust-1',
        name: 'Crust',
        type: 'crust',
        bypassed: false,
        parameterValues: { drive: 0.4 },
    };

    /** Accepts every parameter, so admission turns on the device rather than the id. */
    const permissiveLaw: LiveAutomationWritesInput['deviceParameterLaw'] = {
        acceptsAutomation: () => true,
        clampValue: ({ value }) => value,
        quantiseValue: ({ value }) => value,
    };

    function projectBothLanes(): ReturnType<typeof projectLiveAutomationWrites> {
        const track = createTrack({ devices: [fermenter, crust] });
        return projectLiveAutomationWrites({
            ...baseInput,
            // The engine is carrying nothing on this strip: what separates the
            // two lanes below is only whether the engine has a body to carry.
            carriedDeviceEntries: () => [],
            deviceParameterLaw: permissiveLaw,
            stripTracks: [track],
            lanes: [
                lane({ trackId: track.id, parameterId: 'fermenter-1:filterCutoff', points: [point(0, 0.3, 'step')] }),
                lane({ trackId: track.id, parameterId: 'crust-1:drive', points: [point(0, 0.3, 'step')] }),
            ],
            regionStartSeconds: 0,
            regionEndSeconds: 4,
        });
    }

    it('does not exclude an uncarried lane on a device the engine builds a body for', () => {
        expect(projectBothLanes().exclusions.map((exclusion) => exclusion.subjectId)).not.toContain(
            'lane-track-1-fermenter-1:filterCutoff'
        );
    });

    it('still excludes a lane on a device the engine builds no body for', () => {
        expect(projectBothLanes().exclusions).toEqual([
            {
                stripId: 'track-1',
                subjectId: 'lane-track-1-crust-1:drive',
                reason: 'device parameter automation has no native body yet (#3124)',
            },
        ]);
    });
});
