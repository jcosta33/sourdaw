import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Clip, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { createAutomationLane } from '#/modules/Automation/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { CLIP_GAIN_LAW, SEND_MIN_DB } from '#/utils/audioLevelLaw';

import { buildAgentContext } from '../useCases/buildAgentContext';
import { getProjectContext } from '../useCases/getProjectContext';

const GAIN_LANE_ID = 'lane-gain';
const PAN_LANE_ID = 'lane-pan';

/** A minimal clip for these fixtures; only its gain matters here. */
function fixtureClip(id: string, trackId: string, gain: number): Clip {
    return {
        id,
        trackId,
        name: 'Clip',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        audioBufferId: 'buffer-1',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain,
        color: '#ff0000',
        locked: false,
        muted: false,
    };
}

function seedProject({ trackGain = 0.8, masterGain = 80 }: { trackGain?: number; masterGain?: number } = {}) {
    const track = {
        ...createTrack({ id: 'track-1', name: 'Track', kind: 'audio' }),
        gain: trackGain,
        clips: [fixtureClip('clip-1', 'track-1', 0.5)],
        sends: [{ busId: 'bus-1', level: 0.25, preFader: false }],
    };
    const bus = createTrack({ id: 'bus-1', name: 'Bus', kind: 'bus' });
    trackStore.set({ tracks: [track, bus], selectedTrackId: 'track-1', ghostClips: [] });
    transportStore.set({ ...defaultTransportState, masterGain });
}

describe('project context level units', () => {
    beforeEach(() => {
        seedProject();
        automationStore.set({
            lanes: [
                { ...createAutomationLane('track-1', 'gain', 'Gain', 0, 1), id: GAIN_LANE_ID },
                { ...createAutomationLane('track-1', 'pan', 'Pan', -1, 1), id: PAN_LANE_ID },
            ],
        });
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        automationStore.set({ lanes: [] });
        transportStore.set(defaultTransportState);
    });

    it('reports every stored level in decibels beside the linear value', () => {
        const context = getProjectContext();
        const track = context.tracks.find((candidate) => candidate.id === 'track-1');

        expect(track?.gain).toBe(0.8);
        expect(track?.gainDb).toBeCloseTo(-1.9382, 4);
        expect(track?.clips[0]?.gain).toBe(0.5);
        expect(track?.clips[0]?.gainDb).toBeCloseTo(-6.0206, 4);
        expect(track?.sends?.[0]?.level).toBe(0.25);
        expect(track?.sends?.[0]?.levelDb).toBeCloseTo(-12.0412, 4);
        expect(context.masterGain).toBe(0.8);
        expect(context.masterGainDb).toBeCloseTo(-1.9382, 4);
    });

    it('reports silence as no decibel reading rather than as a very small level', () => {
        seedProject({ trackGain: 0, masterGain: 0 });

        const context = getProjectContext();

        expect(context.tracks.find((candidate) => candidate.id === 'track-1')?.gainDb).toBeNull();
        expect(context.masterGainDb).toBeNull();
    });

    it('states the decibel windows once at the root', () => {
        const context = getProjectContext();

        expect(context.levelLaw).toEqual({
            floorDb: SEND_MIN_DB,
            unityDb: 0,
            ceilingDb: 6,
            sendFloorDb: SEND_MIN_DB,
            sendCeilingDb: 0,
            clipCeilingDb: CLIP_GAIN_LAW.ceilingDb,
        });
    });

    // A pan position or a filter cutoff measures something decibels do not
    // describe, so advertising a decibel window there would invite a request in
    // the wrong unit.
    it('gives a decibel window only to lanes that hold amplitudes', () => {
        const context = getProjectContext();
        const gainLane = context.automationLanes?.find((lane) => lane.id === GAIN_LANE_ID);
        const panLane = context.automationLanes?.find((lane) => lane.id === PAN_LANE_ID);

        expect(gainLane?.minValueDb).toBeCloseTo(SEND_MIN_DB, 4);
        expect(gainLane?.maxValueDb).toBeCloseTo(6, 4);
        expect(panLane).toBeDefined();
        expect(panLane).not.toHaveProperty('minValueDb');
        expect(panLane).not.toHaveProperty('maxValueDb');
    });

    it('hands the planner decibels and the law it reads them against', () => {
        const context = getProjectContext();

        const built = buildAgentContext({
            fixedPolicy: 'Fixed policy: tools only.',
            prompt: 'Bring the lead down a little.',
            context,
            projectRevision: 'revision-1',
        });
        const payload = JSON.parse(
            built.message
                .slice(built.message.indexOf('untrusted_project_data:\n') + 'untrusted_project_data:\n'.length)
                .split('\n\n')[0] ?? '{}'
        ) as {
            data: {
                levelLaw: { ceilingDb: number; floorDb: number };
                masterGainDb: number;
                selectableTargets: Array<{ gainDb: number | null; id: string }>;
            };
        };

        expect(payload.data.levelLaw).toEqual(context.levelLaw);
        expect(payload.data.masterGainDb).toBeCloseTo(-1.9382, 4);
        expect(payload.data.selectableTargets.find((target) => target.id === 'track-1')?.gainDb).toBeCloseTo(
            -1.9382,
            4
        );
        // The law is stated once for the whole payload rather than beside each level.
        expect(built.message.split('"floorDb"')).toHaveLength(2);
    });
});
