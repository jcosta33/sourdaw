/**
 * The notes a natively voiced strip is sent are delayed by that strip's latency
 * compensation, the figure its clips are delayed by (#7303).
 *
 * The projection is the double: its placement laws are proven in
 * `projectLiveMidiProgramme.spec.ts`, and the export calls the same projection
 * and adds its own shift, so the live shift has to be applied here, once, after
 * the projection answers. Every case reads the figure through the same
 * `getCompensationDelay` boundary `readLiveGraphProgramme` reads it through.
 * The projection is a stand-in here; which notes a looping pass admits is
 * `readLiveMidiProgrammeLoop.spec.ts`, on the real projection.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { midiStore } from '#/modules/MIDI/stores';

import { type AudioGraphMidiNoteEvent } from '../../../models/AudioGraphBackend';
import { offlineMidiEventProjectorState } from '../../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import { offlinePpqEndpointProjectorState } from '../../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { getCompensationDelay } from '../../latencyCompensation/compensation/getCompensationDelay';
import { readLiveMidiProgramme } from '../readLiveMidiProgramme';

const SAMPLE_RATE = 48_000;
const DELAYED_SECONDS = 0.25;

const mocks = vi.hoisted(() => ({
    delayByStripId: new Map<string, number>(),
}));

vi.mock('../../latencyCompensation/compensation/getCompensationDelay', () => ({
    getCompensationDelay: vi.fn((stripId: string) => mocks.delayByStripId.get(stripId) ?? 0),
}));
vi.mock('../projectLiveMidiProgramme', () => ({
    projectLiveMidiProgramme: () => ({
        targets: ['delayed', 'aligned'].map((trackId) => ({
            target: { trackId, deviceId: 'd1' },
            events: projected(),
        })),
        exclusions: [],
        nativeVoicedStripIds: new Set(['delayed', 'aligned']),
    }),
}));

function projected(): AudioGraphMidiNoteEvent[] {
    return [
        { time: 1, note: 60, velocity: 100, channel: 0, isNoteOn: true },
        { time: 1.5, note: 60, velocity: 0, channel: 0, isNoteOn: false },
        { time: 2, note: 64, velocity: 100, channel: 0, isNoteOn: true },
    ];
}

function strip(id: string): Track {
    return createTrack({ id, name: id, kind: 'midi' });
}

function read(): ReturnType<typeof readLiveMidiProgramme> {
    return readLiveMidiProgramme({
        stripTracks: [strip('delayed'), strip('aligned')],
        attachedInstanceIds: new Set(),
        carriedStripIds: new Set(['delayed', 'aligned']),
        sampleRate: SAMPLE_RATE,
        span: { startSeconds: 0, endSeconds: Number.POSITIVE_INFINITY },
    });
}

function timesOf(programme: ReturnType<typeof read>, trackId: string): number[] {
    const target = programme.targets.find((entry) => entry.target.trackId === trackId);
    return target?.events.map((event) => event.time) ?? [];
}

beforeEach(() => {
    mocks.delayByStripId.clear();
    mocks.delayByStripId.set('delayed', DELAYED_SECONDS);
    midiStore.set({ probabilitySeed: 3, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    offlinePpqEndpointProjectorState.project = ({ startPpq, endPpq, sampleRate }) => ({
        startSamples: startPpq * sampleRate,
        endSamples: endPpq * sampleRate,
        durationSamples: (endPpq - startPpq) * sampleRate,
        startSeconds: startPpq,
        endSeconds: endPpq,
        durationSeconds: endPpq - startPpq,
    });
    offlineMidiEventProjectorState.createProjector = () => (events) => events;
    offlineMidiEventProjectorState.selectProbability = () => true;
    vi.mocked(getCompensationDelay).mockClear();
});

afterEach(() => {
    offlinePpqEndpointProjectorState.project = null;
    offlineMidiEventProjectorState.createProjector = null;
    offlineMidiEventProjectorState.selectProbability = null;
});

describe('readLiveMidiProgramme compensation', () => {
    it("moves every note on and off of a strip by that strip's compensation", () => {
        const programme = read();

        expect(timesOf(programme, 'delayed')).toEqual([
            1 + DELAYED_SECONDS,
            1.5 + DELAYED_SECONDS,
            2 + DELAYED_SECONDS,
        ]);
    });

    it('leaves a zero-compensation strip exactly where it was projected', () => {
        const programme = read();

        expect(timesOf(programme, 'aligned')).toEqual([1, 1.5, 2]);
    });

    it('keeps every other field of a note and shifts the note once', () => {
        const programme = read();

        expect(programme.targets[0]?.events[0]).toEqual({
            time: 1 + DELAYED_SECONDS,
            note: 60,
            velocity: 100,
            channel: 0,
            isNoteOn: true,
        });
    });

    it('reads each strip’s figure with the carried strips as the engine-hosted set', () => {
        read();

        const calls = vi.mocked(getCompensationDelay).mock.calls;
        expect(calls.map(([stripId]) => stripId).sort()).toEqual(['aligned', 'delayed']);
        for (const [, omitted, hosted] of calls) {
            expect(omitted).toBeUndefined();
            expect(hosted).toEqual(new Set(['delayed', 'aligned']));
        }
    });

    // A claim names carried tracks and never a bus, while the engine's own
    // compensation counts a compensated device on a bus like any other, so the
    // set has to come through `engineHostedStripIds` rather than the claim alone.
    it('adds a bus holding an engine-compensated device to the set the figure is read against', () => {
        const bus = {
            ...createTrack({ id: 'bus', name: 'bus', kind: 'bus', withoutDefaultDevice: true }),
            devices: [{ id: 'bus-bacteria', name: 'Bacteria', type: 'bacteria', bypassed: false, parameterValues: {} }],
        };

        readLiveMidiProgramme({
            stripTracks: [strip('delayed'), strip('aligned'), bus],
            attachedInstanceIds: new Set(),
            carriedStripIds: new Set(['delayed', 'aligned']),
            sampleRate: SAMPLE_RATE,
            span: { startSeconds: 0, endSeconds: Number.POSITIVE_INFINITY },
        });

        const calls = vi.mocked(getCompensationDelay).mock.calls;
        expect(calls).not.toHaveLength(0);
        for (const [, , hosted] of calls) {
            expect(hosted).toEqual(new Set(['delayed', 'aligned', 'bus']));
        }
    });
});
