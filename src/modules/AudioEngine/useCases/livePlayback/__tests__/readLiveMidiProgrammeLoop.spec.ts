/**
 * A looping pass admits a note by where its strip's compensation makes it
 * sound, not by where it was written (#7303).
 *
 * The audio programme places a clip at its compensated time on the timeline
 * and the engine loops that timeline, so a clip shifted past the loop end is
 * not reached that pass and one shifted into the loop from before its start
 * is. Notes keep that same offset to their strip's clips. The projection
 * is the real one: the window is decided there, from the span the reader hands
 * it, and a stand-in would only restate the reader's own contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { midiStore } from '#/modules/MIDI/stores';

import { type OfflineMidiEventProjector } from '../../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import { offlineMidiEventProjectorState } from '../../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import { offlinePpqEndpointProjectorState } from '../../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { readLiveMidiProgramme } from '../readLiveMidiProgramme';

const SAMPLE_RATE = 48_000;
const DELAY_SECONDS = 0.25;
const LOOP = { startSeconds: 4, endSeconds: 8 };

const mocks = vi.hoisted(() => ({ delayByStripId: new Map<string, number>() }));

vi.mock('../../latencyCompensation/compensation/getCompensationDelay', () => ({
    getCompensationDelay: (stripId: string) => mocks.delayByStripId.get(stripId) ?? 0,
}));

/** One beat is one second here, so a note's beat is the second it is written at. */
const projectMidiEvents: OfflineMidiEventProjector = (input) => {
    if (input.phase === 'sequencer-groove') {
        return input.events;
    }
    const shift = input.iterationStartBeat - input.clipStartBeat;
    return input.events.map((event) => ({ ...event, startBeat: event.startBeat + input.clipStartBeat + shift }));
};

function strip(id: string): Track {
    return {
        ...createTrack({ id, name: id, kind: 'midi', withoutDefaultDevice: true }),
        devices: [
            { id: `${id}-instrument`, name: 'Fermenter', type: 'fermenter', bypassed: false, parameterValues: {} },
        ],
        clips: [
            {
                id: `${id}-clip`,
                name: `${id}-clip`,
                trackId: id,
                startBeat: 0,
                endBeat: 16,
                type: 'midi',
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '#00ff00',
                locked: false,
                muted: false,
            },
        ],
    };
}

function writeNotes(trackId: string, onsets: readonly number[]): void {
    midiStore.set({
        probabilitySeed: 3,
        notesByClipId: {
            [`${trackId}-clip`]: onsets.map((startBeat, index) => ({
                id: `n${index}`,
                pitch: 60 + index,
                startBeat,
                duration: 0.5,
                velocity: 100,
            })),
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    });
}

function onsetsOf(span: { startSeconds: number; endSeconds: number }, delay: number): number[] {
    mocks.delayByStripId.set('lead', delay);
    const programme = readLiveMidiProgramme({
        stripTracks: [strip('lead')],
        attachedInstanceIds: new Set(),
        carriedStripIds: new Set(['lead']),
        sampleRate: SAMPLE_RATE,
        span,
    });
    return (programme.targets[0]?.events ?? []).filter((event) => event.isNoteOn).map((event) => event.time);
}

beforeEach(() => {
    mocks.delayByStripId.clear();
    offlinePpqEndpointProjectorState.project = ({ startPpq, endPpq, sampleRate }) => ({
        startSamples: startPpq * sampleRate,
        endSamples: endPpq * sampleRate,
        durationSamples: (endPpq - startPpq) * sampleRate,
        startSeconds: startPpq,
        endSeconds: endPpq,
        durationSeconds: endPpq - startPpq,
    });
    offlineMidiEventProjectorState.createProjector = () => projectMidiEvents;
    offlineMidiEventProjectorState.selectProbability = () => true;
});

afterEach(() => {
    offlinePpqEndpointProjectorState.project = null;
    offlineMidiEventProjectorState.createProjector = null;
    offlineMidiEventProjectorState.selectProbability = null;
});

describe('readLiveMidiProgramme over a looping pass', () => {
    it('leaves out a note the compensation moves past the loop end, as its strip’s clips are left out', () => {
        writeNotes('lead', [5, 7.9]);

        expect(onsetsOf(LOOP, DELAY_SECONDS)).toEqual([5 + DELAY_SECONDS]);
    });

    it('keeps a note that still ends its cycle inside the loop once shifted', () => {
        writeNotes('lead', [7.7]);

        expect(onsetsOf(LOOP, DELAY_SECONDS)).toEqual([7.7 + DELAY_SECONDS]);
    });

    it('brings in a note written just before the loop start that the compensation lands inside it', () => {
        writeNotes('lead', [3.7, 3.9]);

        expect(onsetsOf(LOOP, DELAY_SECONDS)).toEqual([3.9 + DELAY_SECONDS]);
    });

    it('admits from a seek position before the loop by the shifted time too', () => {
        writeNotes('lead', [1.7, 1.9, 5]);

        expect(onsetsOf({ startSeconds: 2, endSeconds: 8 }, DELAY_SECONDS)).toEqual([
            1.9 + DELAY_SECONDS,
            5 + DELAY_SECONDS,
        ]);
    });

    it('windows an uncompensated strip on its written times', () => {
        writeNotes('lead', [3.9, 5, 7.9, 8.1]);

        expect(onsetsOf(LOOP, 0)).toEqual([5, 7.9]);
    });
});
