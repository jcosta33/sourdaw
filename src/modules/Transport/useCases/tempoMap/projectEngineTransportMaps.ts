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
 * Reduce a list to at most `cap` entries, spread evenly, always keeping the
 * first.
 *
 * Truncation is the wrong degradation here. The engine refuses an over-capacity
 * map whole, so the choice is never "keep the tail or drop it" — it is "install
 * a thinner map or install nothing". Dropping everything past the cap would
 * leave the end of a long arrangement playing at whatever tempo the cap
 * happened to land on; thinning evenly keeps the map's shape everywhere and
 * loses only resolution. The first entry is kept unconditionally because it is
 * what opens the map, and the engine refuses a map that does not open at zero.
 */
function thinUniformly<TItem>(items: readonly TItem[], cap: number): TItem[] {
    if (items.length <= cap) {
        return [...items];
    }
    const stride = items.length / cap;
    const kept: TItem[] = [];
    for (let slot = 0; slot < cap; slot += 1) {
        const item = items[Math.floor(slot * stride)];
        if (item !== undefined) {
            kept.push(item);
        }
    }
    return kept;
}

/**
 * How many authored segments fit, once the opening segment the engine demands
 * at zero has taken its slot.
 *
 * A map whose first change already sits on beat zero needs no opening segment
 * and spends nothing. Counting this before anything is dropped is the whole
 * point: slicing to the cap and *then* prepending is how a projection ends up
 * one segment over it.
 */
function authoredCapacity(sorted: readonly { beat: number }[]): number {
    return sorted[0]?.beat === 0 ? MAX_ENGINE_SEGMENTS : MAX_ENGINE_SEGMENTS - 1;
}

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

    // Instant changes are held to the same budget as ramp samples: a map with
    // more authored changes than the engine can hold is thinned rather than
    // truncated, and never left over the cap for the engine to refuse whole.
    const capacity = authoredCapacity(sorted);
    const authored = thinUniformly(sorted, capacity);

    const ramped = totalRampBeats(authored);
    const budget = capacity - authored.length;
    // No budget left for ramp samples: an infinite step emits none, which is a
    // ramp read as a step. That is the correct degradation when the authored
    // changes alone already fill the engine's map.
    const rampStep =
        ramped > 0 && budget > 0 ? Math.max(RAMP_SEGMENT_BEATS, ramped / budget) : Number.POSITIVE_INFINITY;

    const beats = thinUniformly(
        segmentBeats(authored, rampStep).sort((left, right) => left - right),
        capacity
    );
    // The engine refuses a map that does not start at zero. Before the first
    // change the arrangement holds that change's tempo, so opening the map with
    // it is the projection of what the timeline already sounds like. `capacity`
    // reserved this slot, so the composed list is still within the cap.
    if (beats[0] !== 0) {
        beats.unshift(0);
    }

    // Tempo is read from the whole authored map, not from the thinned one: a
    // segment that survived should still state the tempo the arrangement is
    // actually at, whatever was dropped around it.
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
    const sorted = byBeat(changes).filter((change) => Number.isFinite(change.beat) && change.beat >= 0);
    // Thinned against the capacity the opening segment has already been
    // subtracted from, so the composed list is within the cap rather than one
    // over it — which is what refuses the install and leaves the engine with no
    // meter map at all.
    const authored = thinUniformly(sorted, authoredCapacity(sorted));
    const first = authored[0];
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
        ...authored.map((change) => ({
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
