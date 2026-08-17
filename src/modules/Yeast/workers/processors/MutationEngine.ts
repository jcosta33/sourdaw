/**
 * Mutation Engine — slowly drifts processor parameters over time.
 *
 * Uses a constrained random walk with damping so parameters evolve
 * without losing musical identity. Targets: velocity, gate, octave bias,
 * probability, note selection weights.
 */

import { type MidiEvent, type TransportInfo, samplesPerBeat } from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';
import { gaussianLcg } from '../lcgRandom';
import { EMIT_FALLBACK_BLOCK_SPAN_SAMPLES, resolveBlockEndSamples, resolveBlockStartSamples } from '../MidiProcessor';

import type { YeastPreviewDecisionSink } from '../YeastPreviewSidecar';

/** Catch-up bound so a pathological block span cannot spin the random walk. */
const MAX_MUTATIONS_PER_BLOCK = 64;

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
        { name: 'gate_mul', value: 1, baseValue: 1, min: 0.3, max: 1.8, sigma: 0.03, damping: 0.03 },
        { name: 'octave_bias', value: 0, baseValue: 0, min: -1, max: 1, sigma: 0.05, damping: 0.1 },
        { name: 'probability_offset', value: 0, baseValue: 0, min: -0.3, max: 0.3, sigma: 0.02, damping: 0.05 },
    ];

    private depth = 0.5; // 0-1 master mutation amount
    private rngState = 0x1234;
    /** Mutations per beat. Musical cadence, independent of sample rate and block size. */
    private rate = 1;
    /** Transport samples elapsed since the last mutation step. */
    private mutationPhaseSamples = 0;

    constructor(id?: string) {
        super(id ?? `mutation-${Date.now()}`);
    }

    processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void {
        // Mutation doesn't transform events directly — it modifies its own target values
        // which other processors can read. For now, apply velocity mutation to passing notes.
        this.advanceMutationPhase(input, transport);

        const velOffset = this.targets[0]!.value * this.depth;

        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                const vel = Math.max(1, Math.min(127, Math.round(event.kind.velocity + velOffset)));
                const transformed: MidiEvent = {
                    ...event,
                    kind: { type: 'noteOn', channel: event.kind.channel, note: event.kind.note, velocity: vel },
                };
                output.push(transformed);
                preview?.transferDecisionLineage(event, transformed);
            } else {
                output.push(event);
            }
        }
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

    /** Get current mutation values for UI display. */
    getTargetValues(): Array<{ name: string; value: number }> {
        return this.targets.map((time) => ({ name: time.name, value: time.value * this.depth }));
    }
}
