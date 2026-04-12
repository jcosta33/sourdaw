/**
 * Velocity Processor — fixed, compress, expand, remap, randomize velocity.
 */

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../../models/BaseMidiProcessor';

type VelCurve = 'linear' | 'soft' | 'hard' | 'sCurve';

export class VelocityProcessor extends BaseMidiProcessor {
    readonly name = 'Velocity';

    private mode: 'passthrough' | 'fixed' | 'compress' | 'expand' | 'curve' | 'random' = 'passthrough';
    private fixedVel = 100;
    private compressAmount = 0.5; // < 1 compresses, > 1 expands
    private curve: VelCurve = 'linear';
    private randomMin = 40;
    private randomMax = 120;
    private rngState = 0xbeef;

    constructor(id?: string) {
        super(id ?? `vel-${Date.now()}`);
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], _transport: TransportInfo): void {
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                const vel = this.processVelocity(event.kind.velocity);
                output.push({
                    timeSamples: event.timeSamples,
                    kind: { type: 'noteOn', channel: event.kind.channel, note: event.kind.note, velocity: vel },
                });
            } else {
                output.push(event);
            }
        }
    }

    private processVelocity(v: number): number {
        let out: number;
        switch (this.mode) {
            case 'passthrough':
                out = v;
                break;
            case 'fixed':
                out = this.fixedVel;
                break;
            case 'compress':
            case 'expand': {
                const center = 64;
                out = center + (v - center) * this.compressAmount;
                break;
            }
            case 'curve': {
                const norm = v / 127;
                let mapped: number;
                switch (this.curve) {
                    case 'linear':
                        mapped = norm;
                        break;
                    case 'soft':
                        mapped = Math.sqrt(norm);
                        break;
                    case 'hard':
                        mapped = norm * norm;
                        break;
                    case 'sCurve':
                        mapped = norm < 0.5 ? 2 * norm * norm : 1 - 2 * (1 - norm) * (1 - norm);
                        break;
                }
                out = mapped * 127;
                break;
            }
            case 'random': {
                this.rngState = (this.rngState * 1103515245 + 12345) & 0x7fffffff;
                out = this.randomMin + (this.rngState % (this.randomMax - this.randomMin + 1));
                break;
            }
        }
        return Math.max(1, Math.min(127, Math.round(out)));
    }

    reset(): void {}

    setParam(name: string, value: number): void {
        switch (name) {
            case 'mode':
                this.mode =
                    (['passthrough', 'fixed', 'compress', 'expand', 'curve', 'random'] as const)[Math.round(value)] ??
                    'passthrough';
                break;
            case 'fixed_vel':
                this.fixedVel = Math.max(1, Math.min(127, Math.round(value)));
                break;
            case 'compress_amount':
                this.compressAmount = Math.max(0, Math.min(3, value));
                break;
            case 'curve':
                this.curve = (['linear', 'soft', 'hard', 'sCurve'] as const)[Math.round(value)] ?? 'linear';
                break;
            case 'random_min':
                this.randomMin = Math.max(1, Math.min(127, Math.round(value)));
                break;
            case 'random_max':
                this.randomMax = Math.max(1, Math.min(127, Math.round(value)));
                break;
        }
    }
}
