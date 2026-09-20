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

    it('keeps every provider-bound level paired in a full message', () => {
        const initialContext = getProjectContext();
        const full = buildAgentContext({
            fixedPolicy: 'Fixed policy: tools only.',
            prompt: 'Balance the project.',
            context: initialContext,
            projectRevision: 'revision-1',
        });
        const fullProjectContext = JSON.parse(
            full.message
                .slice(full.message.indexOf('<project_context>\n') + '<project_context>\n'.length)
                .split('\n</project_context>')[0] ?? '{}'
        ) as typeof initialContext;

        expect(full.message.split('"floorDb"')).toHaveLength(2);
        expect(fullProjectContext.tracks[0]).toMatchObject({
            gain: initialContext.tracks[0]?.gain,
            gainDb: initialContext.tracks[0]?.gainDb,
            clips: [{ gain: 0.5, gainDb: initialContext.tracks[0]?.clips[0]?.gainDb }],
            sends: [{ level: 0.25, levelDb: initialContext.tracks[0]?.sends?.[0]?.levelDb }],
        });
        expect(fullProjectContext.automationLanes?.[0]).toMatchObject({
            minValue: initialContext.automationLanes?.[0]?.minValue,
            minValueDb: initialContext.automationLanes?.[0]?.minValueDb,
            maxValue: initialContext.automationLanes?.[0]?.maxValue,
            maxValueDb: initialContext.automationLanes?.[0]?.maxValueDb,
        });
        expect(fullProjectContext.masterGain).toBe(initialContext.masterGain);
        expect(fullProjectContext.masterGainDb).toBe(initialContext.masterGainDb);
        const panLane = fullProjectContext.automationLanes?.find((lane) => lane.id === PAN_LANE_ID);
        expect(panLane).not.toHaveProperty('minValueDb');
        expect(panLane).not.toHaveProperty('maxValueDb');

        const silentContext = {
            ...initialContext,
            masterGain: 0,
            masterGainDb: null,
            tracks: initialContext.tracks.map((track) => ({
                ...track,
                gain: 0,
                gainDb: null,
                clips: track.clips.map((clip) => ({ ...clip, gain: 0, gainDb: null })),
                sends: track.sends?.map((send) => ({ ...send, level: 0, levelDb: null })),
            })),
        };
        const silent = buildAgentContext({
            fixedPolicy: 'Fixed policy: tools only.',
            prompt: 'Inspect silence.',
            context: silentContext,
            projectRevision: 'revision-silent',
        });
        const silentProjectContext = JSON.parse(
            silent.message
                .slice(silent.message.indexOf('<project_context>\n') + '<project_context>\n'.length)
                .split('\n</project_context>')[0] ?? '{}'
        ) as typeof silentContext;
        expect(silentProjectContext.masterGainDb).toBeNull();
        expect(silentProjectContext.tracks[0]).toMatchObject({
            gainDb: null,
            clips: [{ gainDb: null }],
            sends: [{ levelDb: null }],
        });
    });

    it('keeps changed and removed nested levels paired in a delta message', () => {
        const projectContext = getProjectContext();
        const unselectedBus = projectContext.tracks.find((track) => track.id === 'bus-1');
        if (!unselectedBus) {
            throw new Error('Expected the fixture to contain an unselected bus');
        }
        const busGainLane = {
            ...createAutomationLane(unselectedBus.id, 'gain', 'Bus Gain', 0, 1),
            id: 'lane-bus-gain',
            name: 'Bus Gain',
            minValueDb: SEND_MIN_DB,
            maxValue: 1,
            maxValueDb: 0,
        };
        const withBusLevels = (track: (typeof projectContext.tracks)[number], gain: number, gainDb: number) => {
            if (track.id !== unselectedBus.id) {
                return track;
            }
            return {
                ...track,
                clips: [{ ...fixtureClip('clip-bus', track.id, gain), noteCount: 0, gainDb }],
                sends: [{ busId: 'track-1', level: gain / 2, levelDb: gainDb - 6.020599913279624, preFader: true }],
            };
        };
        const initialAutomationLanes = projectContext.automationLanes ?? [];
        const initialContext = {
            ...projectContext,
            tracks: projectContext.tracks.map((track) => withBusLevels(track, 0.5, -6.020599913279624)),
            automationLanes: [...initialAutomationLanes, busGainLane],
        };
        const initial = buildAgentContext({
            fixedPolicy: 'Fixed policy: tools only.',
            prompt: 'Balance the project.',
            context: initialContext,
            projectRevision: 'revision-1',
        });

        const clipOnly = buildAgentContext({
            fixedPolicy: 'Fixed policy: tools only.',
            prompt: 'Change only the bus clip gain.',
            context: {
                ...initialContext,
                tracks: initialContext.tracks.map((track) => {
                    if (track.id !== unselectedBus.id) {
                        return track;
                    }
                    return {
                        ...track,
                        clips: [{ ...track.clips[0]!, gain: 0.25, gainDb: -12.041199826559248 }],
                    };
                }),
            },
            projectRevision: 'revision-clip',
            priorEvidence: initial.evidence,
        });
        const clipOnlyPayload = JSON.parse(
            clipOnly.message
                .slice(clipOnly.message.indexOf('untrusted_project_data:\n') + 'untrusted_project_data:\n'.length)
                .split('\n\n')[0] ?? '{}'
        ) as { data: { selectableTargets: Array<{ id: string; clips: Array<{ gain: number; gainDb: number }> }> } };
        expect(clipOnlyPayload.data.selectableTargets).toEqual([
            expect.objectContaining({
                id: unselectedBus.id,
                gain: unselectedBus.gain,
                clips: [expect.objectContaining({ gain: 0.25, gainDb: -12.041199826559248 })],
            }),
        ]);

        const sendOnly = buildAgentContext({
            fixedPolicy: 'Fixed policy: tools only.',
            prompt: 'Change only the bus send level.',
            context: {
                ...initialContext,
                tracks: initialContext.tracks.map((track) => {
                    if (track.id !== unselectedBus.id) {
                        return track;
                    }
                    const send = track.sends?.[0];
                    if (!send) {
                        throw new Error('Expected the unselected bus to contain a send');
                    }
                    return {
                        ...track,
                        sends: [{ ...send, level: 0.125, levelDb: -18.06179973983887 }],
                    };
                }),
            },
            projectRevision: 'revision-send',
            priorEvidence: initial.evidence,
        });
        const sendOnlyPayload = JSON.parse(
            sendOnly.message
                .slice(sendOnly.message.indexOf('untrusted_project_data:\n') + 'untrusted_project_data:\n'.length)
                .split('\n\n')[0] ?? '{}'
        ) as { data: { selectableTargets: Array<{ id: string; sends: Array<{ level: number; levelDb: number }> }> } };
        expect(sendOnlyPayload.data.selectableTargets).toEqual([
            expect.objectContaining({
                id: unselectedBus.id,
                gain: unselectedBus.gain,
                sends: [expect.objectContaining({ level: 0.125, levelDb: -18.06179973983887 })],
            }),
        ]);

        const laneOnly = buildAgentContext({
            fixedPolicy: 'Fixed policy: tools only.',
            prompt: 'Change only the bus gain lane range.',
            context: {
                ...initialContext,
                automationLanes: initialContext.automationLanes.map((lane) => {
                    if (lane.id !== busGainLane.id) {
                        return lane;
                    }
                    return {
                        ...lane,
                        minValue: 0.25,
                        minValueDb: -12.041199826559248,
                        maxValue: 0.5,
                        maxValueDb: -6.020599913279624,
                    };
                }),
            },
            projectRevision: 'revision-lane',
            priorEvidence: initial.evidence,
        });
        const laneOnlyPayload = JSON.parse(
            laneOnly.message
                .slice(laneOnly.message.indexOf('untrusted_project_data:\n') + 'untrusted_project_data:\n'.length)
                .split('\n\n')[0] ?? '{}'
        ) as { data: { automationLanes: Array<{ id: string; minValue: number; minValueDb: number }> } };
        expect(laneOnlyPayload.data).not.toHaveProperty('selectableTargets');
        expect(laneOnlyPayload.data.automationLanes).toEqual([
            expect.objectContaining({ id: busGainLane.id, minValue: 0.25, minValueDb: -12.041199826559248 }),
        ]);

        const changedContext = {
            ...initialContext,
            masterGain: 0.5,
            masterGainDb: -6.020599913279624,
            tracks: initialContext.tracks.map((track) => withBusLevels(track, 0.25, -12.041199826559248)),
            automationLanes: initialContext.automationLanes.map((lane) => {
                if (lane.id !== busGainLane.id) {
                    return lane;
                }
                return {
                    ...lane,
                    minValue: 0.25,
                    minValueDb: -12.041199826559248,
                    maxValue: 0.5,
                    maxValueDb: -6.020599913279624,
                };
            }),
        };
        const delta = buildAgentContext({
            fixedPolicy: 'Fixed policy: tools only.',
            prompt: 'Balance the project.',
            context: changedContext,
            projectRevision: 'revision-2',
            priorEvidence: initial.evidence,
        });
        const deltaPayload = JSON.parse(
            delta.message
                .slice(delta.message.indexOf('untrusted_project_data:\n') + 'untrusted_project_data:\n'.length)
                .split('\n\n')[0] ?? '{}'
        ) as {
            data: {
                levelLaw: typeof initialContext.levelLaw;
                masterGain: number;
                masterGainDb: number;
                selectableTargets: typeof initialContext.tracks;
                automationLanes: NonNullable<typeof initialContext.automationLanes>;
            };
        };

        expect(delta.evidence.delta.mode).toBe('delta');
        expect(deltaPayload.data.levelLaw).toEqual(initialContext.levelLaw);
        expect(deltaPayload.data).toMatchObject({ masterGain: 0.5, masterGainDb: -6.020599913279624 });
        expect(deltaPayload.data.selectableTargets).toEqual([
            expect.objectContaining({
                id: 'bus-1',
                gain: unselectedBus.gain,
                gainDb: unselectedBus.gainDb,
                clips: [expect.objectContaining({ gain: 0.25, gainDb: -12.041199826559248 })],
                sends: [expect.objectContaining({ level: 0.125, levelDb: -18.06179973983887 })],
            }),
        ]);
        expect(deltaPayload.data.automationLanes).toEqual([
            expect.objectContaining({
                id: busGainLane.id,
                minValue: 0.25,
                minValueDb: -12.041199826559248,
                maxValue: 0.5,
                maxValueDb: -6.020599913279624,
            }),
        ]);
        expect(delta.message.split('"floorDb"')).toHaveLength(2);

        const removed = buildAgentContext({
            fixedPolicy: 'Fixed policy: tools only.',
            prompt: 'Remove the nested level evidence.',
            context: {
                ...changedContext,
                tracks: changedContext.tracks.map((track) => {
                    if (track.id !== unselectedBus.id) {
                        return track;
                    }
                    return { ...track, clips: [], sends: [] };
                }),
                automationLanes: changedContext.automationLanes.filter((lane) => lane.id !== busGainLane.id),
            },
            projectRevision: 'revision-3',
            priorEvidence: delta.evidence,
        });
        const removedPayload = JSON.parse(
            removed.message
                .slice(removed.message.indexOf('untrusted_project_data:\n') + 'untrusted_project_data:\n'.length)
                .split('\n\n')[0] ?? '{}'
        ) as {
            data: {
                selectableTargets: Array<{ id: string; clips: unknown[]; sends: unknown[] }>;
                removedAutomationLaneIds: string[];
            };
        };

        expect(removedPayload.data.selectableTargets).toEqual([
            expect.objectContaining({ id: unselectedBus.id, clips: [], sends: [] }),
        ]);
        expect(removedPayload.data.removedAutomationLaneIds).toEqual([busGainLane.id]);
    });
});
