/**
 * Mutation Engine — slowly drifts processor parameters over time.
 *
 * Uses a constrained random walk with damping so parameters evolve
 * without losing musical identity. Targets: velocity, gate, octave bias,
 * probability, note selection weights.
 */

import { BaseMidiProcessor } from '../../models/BaseMidiProcessor';
import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { gaussianLcg } from '../../services/lcgRandom';

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
    private stepCounter = 0;
    private stepsPerMutation = 4;

    constructor(id?: string) {
        super(id ?? `mutation-${Date.now()}`);
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], _transport: TransportInfo): void {
        // Mutation doesn't transform events directly — it modifies its own target values
        // which other processors can read. For now, apply velocity mutation to passing notes.
        this.stepCounter++;
        if (this.stepCounter >= this.stepsPerMutation) {
            this.stepCounter = 0;
            this.mutateStep();
        }

        const velOffset = this.targets[0]!.value * this.depth;

        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                const vel = Math.max(1, Math.min(127, Math.round(event.kind.velocity + velOffset)));
                output.push({
                    timeSamples: event.timeSamples,
                    kind: { type: 'noteOn', channel: event.kind.channel, note: event.kind.note, velocity: vel },
                });
            } else {
                output.push(event);
            }
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
        this.stepCounter = 0;
    }

    setParam(name: string, value: number): void {
        switch (name) {
            case 'depth':
                this.depth = Math.max(0, Math.min(1, value));
                break;
            case 'rate': {
                // `rate` (mutations per beat) is only needed to derive the
                // step cadence; the engine steps on stepCounter/stepsPerMutation,
                // so keep it local rather than as a write-only field.
                const rate = Math.max(0.1, Math.min(10, value));
                this.stepsPerMutation = Math.max(1, Math.round(4 / rate));
                break;
            }
        }
    }

    /** Get current mutation values for UI display. */
    getTargetValues(): Array<{ name: string; value: number }> {
        return this.targets.map((time) => ({ name: time.name, value: time.value * this.depth }));
    }
}
