/**
 * Project the arrangement's tempo map, meter map and loop region onto the shape
 * the native engine follows (#3067, D3.c.4b).
 *
 * ## Beats in, seconds out
 *
 * The arrangement's maps are addressed in beats, which is the only coordinate a
 * tempo map can be authored in. The engine is addressed in frames, and only it
 * knows the sample rate its device opened, so the wire coordinate is seconds:
 * integrated here through the same tempo map the scheduler integrates
 * (`secondsBetweenBeats`), converted to frames there.
 *
 * ## Ramps become steps, at a stated resolution
 *
 * The engine's tempo map is piecewise constant — a segment holds one BPM until
 * the next one starts — because an audio block must resolve its tempo with a
 * binary search and no arithmetic on a curve. A `linear` tempo change is
 * therefore sampled across its span rather than collapsed to a step at its
 * start, which is what a step would do: hold the ramp's opening tempo for the
 * whole ramp and then jump. The sampling interval is musical
 * (`RAMP_SEGMENT_BEATS`) and widens uniformly when a project's ramps would
 * otherwise exceed the engine's segment budget, so a dense map loses resolution
 * evenly instead of losing its tail.
 */

import { secondsBetweenBeats } from '../../models/TempoMap';
import { getTransportState } from '../../repositories/transport/getTransportState';
import { tempoMapStore, type TempoMapStoreState } from '../../stores/tempoMapStore';
import { timeSignatureMapStore, type TimeSignatureMapStoreState } from '../../stores/timeSignatureMapStore';
import { type TransportState } from '../../stores/transportStore';

import type { startNativeLiveGraphSession } from '#/modules/AudioEngine/useCases';

/**
 * The shape the engine reads its maps in, derived from the use case that takes
 * them rather than imported: AudioEngine keeps its models private, and the
 * callable contract is the public statement of what this has to produce.
 */
type EngineTransportMaps = Parameters<typeof startNativeLiveGraphSession>[0]['transportMaps'];
type EngineTempoSegment = EngineTransportMaps['tempo'][number];
type EngineTimeSignatureSegment = EngineTransportMaps['timeSignature'][number];

/**
 * The engine's own segment ceilings
 * (`crates/daw-engine/src/transport_map.rs`). Mirrored rather than imported —
 * there is no binding generator — and used to bound the ramp sampling below,
 * because a map the engine refuses installs nothing at all.
 */
const MAX_ENGINE_SEGMENTS = 4096;

/** How finely a linear tempo ramp is sampled, in beats, when budget allows. */
const RAMP_SEGMENT_BEATS = 0.25;

type TempoChange = TempoMapStoreState['changes'][number];
type TimeSignatureChange = TimeSignatureMapStoreState['changes'][number];

const byBeat = <TChange extends { beat: number }>(changes: readonly TChange[]): TChange[] =>
    [...changes].sort((left, right) => left.beat - right.beat);

/**
 * Walk beats forward, integrating each step through the tempo map.
 *
 * One integration per step rather than one from beat zero per point: the map
 * can hold thousands of segments, and re-integrating the whole prefix for each
 * would be quadratic in a projection that runs on every play.
 */
function createBeatClock(changes: readonly TempoChange[], defaultTempo: number) {
    let lastBeat = 0;
    let seconds = 0;
    return (beat: number): number => {
        seconds += secondsBetweenBeats(changes, lastBeat, beat, defaultTempo);
        lastBeat = beat;
        return seconds;
    };
}

/**
 * How many beats of ramp the projection has to sample, so the interval can be
 * chosen once for the whole map rather than per ramp.
 */
function totalRampBeats(sorted: readonly TempoChange[]): number {
    return sorted.reduce((total, change, index) => {
        const next = sorted[index + 1];
        if (change.curve !== 'linear' || !next || next.beat <= change.beat) {
            return total;
        }
        return total + (next.beat - change.beat);
    }, 0);
}

/** The beats at which a segment starts, ramps expanded. */
function segmentBeats(sorted: readonly TempoChange[], rampStep: number): number[] {
    const beats: number[] = [];
    for (const [index, change] of sorted.entries()) {
        beats.push(change.beat);
        const next = sorted[index + 1];
        if (change.curve !== 'linear' || !next || next.beat <= change.beat) {
            continue;
        }
        for (let beat = change.beat + rampStep; beat < next.beat; beat += rampStep) {
            beats.push(beat);
        }
    }
    return beats;
}

/**
 * The tempo the arrangement is at, at a beat, ramps included.
 *
 * Deliberately local rather than the Transport query: this walks a list already
 * sorted once for the whole projection, and interpolating here is what makes a
 * sampled ramp differ from a step.
 */
function tempoAtBeat(sorted: readonly TempoChange[], beat: number, defaultTempo: number): number {
    if (sorted.length === 0) {
        return defaultTempo;
    }
    let governingIndex = 0;
    for (const [index, change] of sorted.entries()) {
        if (change.beat > beat) {
            break;
        }
        governingIndex = index;
    }
    const governing = sorted[governingIndex];
    if (!governing) {
        return defaultTempo;
    }
    const next = sorted[governingIndex + 1];
    if (governing.curve !== 'linear' || !next || next.beat <= governing.beat || beat <= governing.beat) {
        return governing.tempo;
    }
    const travelled = Math.min(1, (beat - governing.beat) / (next.beat - governing.beat));
    return governing.tempo + (next.tempo - governing.tempo) * travelled;
}

function projectTempo(
    changes: readonly TempoChange[],
    defaultTempo: number,
    atBeat: (beat: number) => number
): EngineTempoSegment[] {
    const sorted = byBeat(changes).filter((change) => Number.isFinite(change.beat) && change.beat >= 0);
    if (sorted.length === 0) {
        return [{ startSeconds: 0, beatsPerMinute: defaultTempo }];
    }

    const ramped = totalRampBeats(sorted);
    const budget = Math.max(1, MAX_ENGINE_SEGMENTS - sorted.length - 1);
    const rampStep = ramped > 0 ? Math.max(RAMP_SEGMENT_BEATS, ramped / budget) : RAMP_SEGMENT_BEATS;

    const beats = segmentBeats(sorted, rampStep).sort((left, right) => left - right);
    // The engine refuses a map that does not start at zero. Before the first
    // change the arrangement holds that change's tempo, so opening the map with
    // it is the projection of what the timeline already sounds like.
    if (beats[0] !== 0) {
        beats.unshift(0);
    }

    return beats.map((beat) => ({
        startSeconds: atBeat(beat),
        beatsPerMinute: tempoAtBeat(sorted, beat, defaultTempo),
    }));
}

function projectTimeSignature(
    changes: readonly TimeSignatureChange[],
    fallback: Readonly<{ numerator: number; denominator: number }>,
    atBeat: (beat: number) => number
): EngineTimeSignatureSegment[] {
    const sorted = byBeat(changes)
        .filter((change) => Number.isFinite(change.beat) && change.beat >= 0)
        .slice(0, MAX_ENGINE_SEGMENTS);
    const first = sorted[0];
    const opening =
        first && first.beat === 0
            ? []
            : [
                  {
                      startSeconds: 0,
                      numerator: first?.numerator ?? fallback.numerator,
                      denominator: first?.denominator ?? fallback.denominator,
                  },
              ];

    return [
        ...opening,
        ...sorted.map((change) => ({
            startSeconds: atBeat(change.beat),
            numerator: change.numerator,
            denominator: change.denominator,
        })),
    ];
}

/**
 * Read the arrangement's transport maps as the engine's shape.
 *
 * The two maps and the loop share one beat clock, so every second on the result
 * is integrated through the same tempo map — a meter change and a tempo change
 * at the same beat cannot land at two different times.
 */
export function projectEngineTransportMaps(): EngineTransportMaps {
    const transport: TransportState | null = getTransportState();
    const tempoChanges = tempoMapStore.value?.changes ?? [];
    const defaultTempo = transport?.tempo ?? 120;
    const atBeat = createBeatClock(tempoChanges, defaultTempo);

    // Beats are visited in ascending order across all three projections because
    // the clock only walks forward; tempo first, then meter, then the loop, and
    // each of those lists is sorted.
    const tempo = projectTempo(tempoChanges, defaultTempo, atBeat);
    const timeSignature = projectTimeSignature(
        timeSignatureMapStore.value?.changes ?? [],
        {
            numerator: transport?.timeSignatureNumerator ?? 4,
            denominator: transport?.timeSignatureDenominator ?? 4,
        },
        createBeatClock(tempoChanges, defaultTempo)
    );

    const loopClock = createBeatClock(tempoChanges, defaultTempo);
    const loopRegion =
        transport && transport.loopEnd > transport.loopStart
            ? {
                  enabled: transport.isLooping,
                  startSeconds: loopClock(transport.loopStart),
                  endSeconds: loopClock(transport.loopEnd),
              }
            : null;

    return { tempo, timeSignature, loopRegion };
}
