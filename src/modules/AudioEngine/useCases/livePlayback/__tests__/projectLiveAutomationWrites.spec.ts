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

import { type Track } from '#/modules/Arrangement/stores';

import { type AutomationLane, type AutomationPoint } from '../../../models/AutomationViewTypes';
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
    } as Track;
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
    it('produces no entries and no exclusions for a strip with automationMode off', () => {
        const track = createTrack({ automationMode: 'off' });
        const lanes: AutomationLane[] = [
            lane({ trackId: track.id, parameterId: 'gain', points: [point(0, 0.5, 'step')] }),
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
