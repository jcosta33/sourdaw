/**
 * Mutation Engine — slowly drifts note velocity, pitch, and density over time.
 *
 * Uses a constrained random walk with damping so parameters evolve without
 * losing musical identity. Three targets, each read and applied to the note
 * stream on every block: `velocity_offset` (added to Note On velocity),
 * `octave_bias` (added to pitch, in semitones, as a fraction of an octave),
 * and `probability_offset` (a chance to drop a Note On — and its matching
 * Note Off — entirely).
 *
 * A `gate_mul` target existed here without ever being read: no other
 * processor consumed it, and applying it here would need the Mutation Engine
 * to own Note Off scheduling/suppression the way a generator does (see
 * Arpeggiator's `ScheduledEventQueue` use) — live playback trusts a Note On's
 * `durationSamples` metadata directly (`processLiveYeastTrackBlock.ts`), but
 * offline rendering derives note length from the actual On/Off pair and
 * ignores that field (`projectOfflineYeastNotes.ts`); scaling `durationSamples`
 * alone would make gate length live-only and silently no-op offline. Removed
 * rather than shipped as a scale that only half the render paths honor.
 */

import { type MidiEvent, type TransportInfo, samplesPerBeat } from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';
import { BoundedNoteVoiceQueue } from '../BoundedNoteVoiceQueue';
import { nextLcg, gaussianLcg, LCG_MAX } from '../lcgRandom';
import { EMIT_FALLBACK_BLOCK_SPAN_SAMPLES, resolveBlockEndSamples, resolveBlockStartSamples } from '../MidiProcessor';

import type { YeastPreviewDecisionSink } from '../YeastPreviewSidecar';

/** Catch-up bound so a pathological block span cannot spin the random walk. */
const MAX_MUTATIONS_PER_BLOCK = 64;

/** Octave bias is stored as a fraction of an octave; a semitone is 1/12 of one. */
const SEMITONES_PER_OCTAVE = 12;

type MutationTarget = {
    name: string;
    value: number;
    baseValue: number;
    min: number;
    max: number;
    sigma: number; // random walk step size
    damping: number; // 0-1, how strongly to pull back to base
};

export class MutationEngine extends BaseMidiProcessor {
    readonly name = 'Mutation';

    private targets: MutationTarget[] = [
        { name: 'velocity_offset', value: 0, baseValue: 0, min: -30, max: 30, sigma: 2, damping: 0.05 },
        { name: 'octave_bias', value: 0, baseValue: 0, min: -1, max: 1, sigma: 0.05, damping: 0.1 },
        { name: 'probability_offset', value: 0, baseValue: 0, min: -0.3, max: 0.3, sigma: 0.02, damping: 0.05 },
    ];

    private depth = 0.5; // 0-1 master mutation amount
    private rngState = 0x1234;
    // Independent stream from `rngState`: the probability gate draws a sample
    // every Note On, and threading that through the walk's own RNG would make
    // the newly block-size-independent random walk consume a different number
    // of draws depending on how many notes passed through the same block —
    // desynchronizing the walk's musical cadence from the note density again.
    private dropRngState = 0x5678;
    /** Mutations per beat. Musical cadence, independent of sample rate and block size. */
    private rate = 1;
    /** Transport samples elapsed since the last mutation step. */
    private mutationPhaseSamples = 0;
    // Correlates a Note On's applied pitch shift with its matching Note Off —
    // the shift used at On time must still be the one subtracted at Off time
    // even though the walk has moved on by then. Mirrors Transposer.ts.
    private pitchVoices = new BoundedNoteVoiceQueue<number>();
    // Correlates the drop decision itself: a dropped Note On never reaches
    // downstream, so its matching Note Off must be dropped too, or a
    // processor downstream sees an Off with no On. Mirrors NoteFilter.ts.
    private passDecisions = new BoundedNoteVoiceQueue<boolean>();

    constructor(id?: string) {
        super(id ?? `mutation-${Date.now()}`);
    }

    processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void {
        this.advanceMutationPhase(input, transport);

        const velOffset = this.targets[0]!.value * this.depth;
        const semitoneShift = Math.round(this.targets[1]!.value * this.depth * SEMITONES_PER_OCTAVE);
        // A positive offset can only push the drop chance below zero (clamped
        // away); the walk's damping already pulls it back toward 0, so only
        // the negative half of the range has an audible effect. That is the
        // intended shape: probability_offset is a chance to THIN the stream,
        // not to add notes that were never played.
        const dropChance = Math.max(0, Math.min(1, -this.targets[2]!.value * this.depth));

        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                // Keyed by the note's own instance id when the feed carries one
                // (both live and offline feeds do), falling back to a pitch
                // composite only when it does not — same convention as
                // GrooveModule/ChordGenerator/Harmonizer/ChordMemory. A pitch
                // composite alone cross-assigns decisions between two
                // overlapping same-pitch voices released out of order (On1,
                // On2, Off2, Off1): if On1 passed and On2 dropped, Off1 would
                // be wrongly suppressed and instance1 would never close.
                const key = event.noteInstanceId ?? (event.kind.channel << 7) | event.kind.note;
                if (dropChance > 0 && this.drawDropSample() < dropChance) {
                    this.passDecisions.push(event.trackId, key, false);
                    continue;
                }
                this.passDecisions.push(event.trackId, key, true);

                const vel = Math.max(1, Math.min(127, Math.round(event.kind.velocity + velOffset)));
                const note = Math.max(0, Math.min(127, event.kind.note + semitoneShift));
                this.pitchVoices.push(event.trackId, key, note);

                const transformed: MidiEvent = {
                    ...event,
                    kind: { type: 'noteOn', channel: event.kind.channel, note, velocity: vel },
                };
                output.push(transformed);
                preview?.transferDecisionLineage(event, transformed);
            } else if (event.kind.type === 'noteOff') {
                const key = event.noteInstanceId ?? (event.kind.channel << 7) | event.kind.note;
                const passed = this.passDecisions.shift(event.trackId, key);
                if (passed === false) {
                    continue;
                }
                const note = this.pitchVoices.shift(event.trackId, key) ?? event.kind.note;
                const transformed: MidiEvent = {
                    ...event,
                    kind: { type: 'noteOff', channel: event.kind.channel, note },
                };
                output.push(transformed);
                preview?.transferDecisionLineage(event, transformed);
            } else {
                output.push(event);
            }
        }
    }

    private drawDropSample(): number {
        this.dropRngState = nextLcg(this.dropRngState);
        return this.dropRngState / LCG_MAX;
    }

    /**
     * Advance the walk by the block's musical duration.
     *
     * The cadence is `rate` mutations per beat, derived from the transport's
     * tempo and sample rate. Counting processed blocks instead would make the
     * musical rate a function of sample rate and render quantum — the same
     * project would evolve at a different speed on a different audio device.
     * The remainder carries across blocks so a mutation never drifts off the
     * beat grid, and never lands twice because a block straddled its boundary.
     */
    private advanceMutationPhase(input: readonly MidiEvent[], transport: TransportInfo): void {
        const blockStartSamples = resolveBlockStartSamples(transport, input);
        const blockSpanSamples =
            resolveBlockEndSamples(transport, blockStartSamples, EMIT_FALLBACK_BLOCK_SPAN_SAMPLES) - blockStartSamples;
        const samplesPerMutation = samplesPerBeat(transport) / this.rate;
        if (!(blockSpanSamples > 0) || !Number.isFinite(samplesPerMutation) || samplesPerMutation <= 0) {
            return;
        }

        this.mutationPhaseSamples += blockSpanSamples;
        let steps = 0;
        while (this.mutationPhaseSamples >= samplesPerMutation && steps < MAX_MUTATIONS_PER_BLOCK) {
            this.mutationPhaseSamples -= samplesPerMutation;
            this.mutateStep();
            steps++;
        }
        if (this.mutationPhaseSamples >= samplesPerMutation) {
            // Only reachable when the catch-up bound cut the loop short. Drop
            // the backlog so the cap does not keep firing on every later block.
            // Testing `steps === MAX_MUTATIONS_PER_BLOCK` instead would also
            // discard a legitimate sub-step remainder whenever the loop happened
            // to end at exactly the cap.
            this.mutationPhaseSamples = 0;
        }
    }

    private mutateStep(): void {
        for (const target of this.targets) {
            // Gaussian random walk
            const noise = this.gaussian(0, target.sigma);
            target.value += noise;
            // Clamp
            target.value = Math.max(target.min, Math.min(target.max, target.value));
            // Damping: pull back toward base
            target.value += (target.baseValue - target.value) * target.damping;
        }
    }

    private gaussian(mean: number, sigma: number): number {
        const { value, state } = gaussianLcg(this.rngState, mean, sigma);
        this.rngState = state;
        return value;
    }

    reset(): void {
        for (const target of this.targets) {
            target.value = target.baseValue;
        }
        this.mutationPhaseSamples = 0;
        // A dropped or pitch-shifted Note On that never reaches its matching
        // Note Off after a reset (an arpeggiator's own reset dropping the note
        // it was tied to, an all-notes-off, a discontinuity) would otherwise
        // leave a stale queue entry: a later, unrelated Note On/Off pair on the
        // same key would then read the wrong decision. Mirrors NoteFilter.reset().
        this.pitchVoices.clear();
        this.passDecisions.clear();
    }

    protected resetParams(): void {
        this.depth = 0.5;
        this.rate = 1;
    }

    setParam(name: string, value: number): void {
        switch (name) {
            case 'depth':
                this.depth = Math.max(0, Math.min(1, value));
                break;
            case 'rate':
                this.rate = Math.max(0.1, Math.min(10, value));
                break;
        }
    }

    /**
     * Test-only: exposes each target's current depth-scaled value so specs
     * can assert on the random walk's internal state directly instead of
     * reverse-engineering it from emitted MIDI. Not "for UI display" — there
     * is no production consumer; that was the same dead-API claim this PR
     * removes elsewhere (MidiRack.setProcessorParam, MidiRack.reorder).
     */
    __getTargetValuesForTest(): Array<{ name: string; value: number }> {
        return this.targets.map((time) => ({ name: time.name, value: time.value * this.depth }));
    }
}
