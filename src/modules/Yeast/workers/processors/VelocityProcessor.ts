/**
 * Velocity Processor — fixed, compress, expand, remap, randomize velocity.
 */

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';
import { nextLcg } from '../lcgRandom';

import type { YeastPreviewDecisionSink } from '../YeastPreviewSidecar';

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

    processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        _transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void {
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                const vel = this.processVelocity(event.kind.velocity);
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

    private processVelocity(value: number): number {
        let out: number;
        switch (this.mode) {
            case 'passthrough':
                out = value;
                break;
            case 'fixed':
                out = this.fixedVel;
                break;
            case 'compress':
            case 'expand': {
                const center = 64;
                out = center + (value - center) * this.compressAmount;
                break;
            }
            case 'curve': {
                const norm = value / 127;
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
                // `random_min` and `random_max` are interchangeable ends of one
                // range, so read them in order. No UI reaches an inverted pair,
                // but a stored project, a CRDT merge, or an AI-authored action
                // can set one: `rngState % (max - min + 1)` then divides by a
                // zero or negative span and a NaN velocity reaches the host.
                const low = Math.min(this.randomMin, this.randomMax);
                const high = Math.max(this.randomMin, this.randomMax);
                this.rngState = nextLcg(this.rngState);
                out = low + (this.rngState % (high - low + 1));
                break;
            }
        }
        return Math.max(1, Math.min(127, Math.round(out)));
    }

    reset(): void {}

    protected resetParams(): void {
        this.mode = 'passthrough';
        this.fixedVel = 100;
        this.compressAmount = 0.5;
        this.curve = 'linear';
        this.randomMin = 40;
        this.randomMax = 120;
    }

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
