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
 * (`secondsBetweenBeats`), converted to frames there. A beat tolerance here
 * cannot keep two segments off one frame, because a frame's width in beats
 * depends on that rate, so the native install keeps the last of the segments
 * that round onto one frame (#5214).
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
 *
 * ## A segment states the tempo its span integrates to
 *
 * The engine counts beats by integrating each segment as `span × BPM`, and the
 * song position it hands the arpeggiator's step clock and hosted plugins'
 * tempo sync is that integral. A segment sitting at the exact second its beat
 * is reached must therefore carry the *mean* tempo over the span it opens —
 * stating the ramp's value at the segment's left endpoint makes every segment
 * of a rising ramp integrate too few beats (a falling one, too many) and
 * carries the error into every later segment, so the engine's song position
 * drifts off the arrangement permanently after one ramp (#4657). With the
 * mean, the engine's beat count returns exactly the arrangement's beat at
 * every projected segment boundary, whatever the sampling resolution.
 */

import { BEAT_EPSILON, secondsBetweenBeats } from '../../models/TempoMap';
import { getTransportState } from '../../repositories/transport/getTransportState';
import { tempoMapStore, type TempoMapStoreState } from '../../stores/tempoMapStore';
import { timeSignatureMapStore, type TimeSignatureMapStoreState } from '../../stores/timeSignatureMapStore';
import { DEFAULT_TEMPO_BPM, type TransportState } from '../../stores/transportStore';

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
 * Reduce a list to at most `cap` entries, spread evenly across both endpoints.
 *
 * Truncation is the wrong degradation here. The engine refuses an over-capacity
 * map whole, so the choice is never "keep the tail or drop it" — it is "install
 * a thinner map or install nothing". Dropping everything past the cap would
 * leave the end of a long arrangement playing at whatever tempo the cap
 * happened to land on; thinning evenly keeps the map's shape everywhere and
 * loses only resolution.
 *
 * Both ends are kept, and neither is an aesthetic choice. The first opens the
 * map, and the engine refuses a map that does not open at zero. The last is
 * the one every dropped entry is *not* corrected by: an interior entry that
 * goes missing is corrected at the next kept one a few beats later, but the
 * final change has nothing after it, so losing it plays the whole tail of the
 * arrangement at the previous kept tempo — permanently, and further off the
 * longer the arrangement runs. Spreading `cap` slots across `length - 1`
 * intervals is what lands the last slot exactly on the last entry.
 */
function thinUniformly<TItem>(items: readonly TItem[], cap: number): TItem[] {
    if (items.length <= cap) {
        return [...items];
    }
    const first = items[0];
    if (cap <= 1 || first === undefined) {
        // One slot cannot hold both ends. The opening wins, because a map that
        // does not start at zero is refused outright rather than degraded.
        return first === undefined ? [] : [first];
    }
    const step = (items.length - 1) / (cap - 1);
    const kept: TItem[] = [];
    for (let slot = 0; slot < cap; slot += 1) {
        const item = items[Math.round(slot * step)];
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
        // A sample within BEAT_EPSILON of the next change would open a second segment on its frame.
        for (let beat = change.beat + rampStep; beat < next.beat - BEAT_EPSILON; beat += rampStep) {
            beats.push(beat);
        }
    }
    return beats;
}

/**
 * One change per beat, the last of those sharing it. Two changes on one beat
 * mean "arrive at the first, govern from the last"; both land on the same
 * second, and the engine refuses a map whose segments do not start on strictly
 * increasing frames. Beats within BEAT_EPSILON share a beat, because a float
 * step apart they would otherwise open two segments on one frame. The arrival
 * is not lost: the seconds the segments start on are integrated through the
 * full map.
 */
function governingPerBeat<TChange extends { beat: number }>(sorted: readonly TChange[]): TChange[] {
    return sorted.filter((change, index) => {
        const next = sorted[index + 1];
        return next === undefined || next.beat - change.beat > BEAT_EPSILON;
    });
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

/**
 * The tempo one projected segment states, given the boundary its beat opens
 * and the one the next beat opens.
 *
 * The engine integrates each segment as `span × BPM`, so the tempo that makes
 * the integral land on the segment's own beats is the mean over its span —
 * `60 · Δbeat / Δseconds` (#4657). The last segment has no following boundary
 * to average across: its span is the rest of the arrangement, which holds the
 * tempo the arrangement is at, so it states that. A boundary that opens no
 * time (two beats on one second) cannot state a mean either, and the native
 * install keeps only the last segment on a frame, so the segment installs
 * nothing either way and keeps the arrangement's tempo rather than dividing by
 * zero.
 */
function segmentBeatsPerMinute(
    sorted: readonly TempoChange[],
    boundary: { beat: number; seconds: number },
    next: { beat: number; seconds: number } | undefined,
    defaultTempo: number
): number {
    if (next === undefined || next.seconds <= boundary.seconds) {
        return tempoAtBeat(sorted, boundary.beat, defaultTempo);
    }
    return (60 * (next.beat - boundary.beat)) / (next.seconds - boundary.seconds);
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
    // Changes sharing a beat open one segment, stated by the integral through
    // the whole map, so the beat is kept once and its governing change is the
    // entry that stays.
    const governing = governingPerBeat(sorted);
    const capacity = authoredCapacity(governing);
    const authored = thinUniformly(governing, capacity);

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
    // A first segment within BEAT_EPSILON of zero is the opening one: a second at zero would share its frame.
    if (beats[0] === undefined || beats[0] > BEAT_EPSILON) {
        beats.unshift(0);
    } else {
        beats[0] = 0;
    }

    // Each boundary's second is integrated once, in beat order, through the
    // whole authored map — not the thinned one — so a segment that survived
    // still opens on the second the arrangement actually reaches its beat,
    // whatever was dropped around it.
    const boundaries = beats.map((beat) => ({ beat, seconds: atBeat(beat) }));
    return boundaries.map((boundary, index) => ({
        startSeconds: boundary.seconds,
        beatsPerMinute: segmentBeatsPerMinute(sorted, boundary, boundaries[index + 1], defaultTempo),
    }));
}

function projectTimeSignature(
    changes: readonly TimeSignatureChange[],
    fallback: Readonly<{ numerator: number; denominator: number }>,
    atBeat: (beat: number) => number
): EngineTimeSignatureSegment[] {
    // Meters within BEAT_EPSILON of one beat share it, the last governing, as tempo changes do:
    // a float step apart they would open two segments on one frame.
    const sorted = governingPerBeat(
        byBeat(changes).filter((change) => Number.isFinite(change.beat) && change.beat >= 0)
    );
    // Thinned against the capacity the opening segment has already been
    // subtracted from, so the composed list is within the cap rather than one
    // over it — which is what refuses the install and leaves the engine with no
    // meter map at all.
    const authored = thinUniformly(sorted, authoredCapacity(sorted));
    const first = authored[0];
    const opening =
        first && first.beat <= BEAT_EPSILON
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
            startSeconds: atBeat(change.beat <= BEAT_EPSILON ? 0 : change.beat),
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
    const defaultTempo = transport?.tempo ?? DEFAULT_TEMPO_BPM;
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
