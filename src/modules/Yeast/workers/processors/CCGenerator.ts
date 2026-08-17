/**
 * CC Generator / LFO — generates CC messages from a modulation shape.
 * Supports synced and free-running rates, multiple waveforms, note retrigger.
 */

import {
    type MidiEvent,
    type TransportInfo,
    type RateValue,
    rateToBeats,
    samplesPerBeat,
} from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';
import { EMIT_FALLBACK_BLOCK_SPAN_SAMPLES, resolveBlockEndSamples, resolveBlockStartSamples } from '../MidiProcessor';

type LfoShape = 'sine' | 'triangle' | 'square' | 'sawUp' | 'sawDown' | 'sampleHold';

function evalShape(shape: LfoShape, phase: number, rngState: { v: number }): number {
    const param = phase % 1.0;
    switch (shape) {
        case 'sine':
            return 0.5 + 0.5 * Math.sin(param * 2 * Math.PI);
        case 'triangle':
            return param < 0.5 ? param * 2 : 2 - param * 2;
        case 'square':
            return param < 0.5 ? 1 : 0;
        case 'sawUp':
            return param;
        case 'sawDown':
            return 1 - param;
        case 'sampleHold': {
            // Only change on phase wrap
            if (param < 0.01) {
                rngState.v = ((rngState.v * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
            }
            return rngState.v;
        }
        default:
            // Audio-thread no-op fallback. setParam clamps `shape` to a valid
            // LfoShape, so this is unreachable in practice. MidiRack.processBlock
            // now wraps each processMidi call in try/catch and treats a throw as a
            // transparent bypass for the block, so a throw here would no longer
            // abort the chain — but it would silently drop this processor's output
            // for the block. Returning a neutral 0 keeps the LFO emitting instead.
            return 0;
    }
}

export class CCGenerator extends BaseMidiProcessor {
    readonly name = 'CC Generator';

    private ccNumber = 1; // mod wheel default
    private shape: LfoShape = 'sine';
    private rate: RateValue = { type: 'straight', denom: 4 };
    private freeRateHz = 1.0;
    private syncMode = true; // true = tempo sync, false = free Hz
    private min = 0;
    private max = 127;
    private phase = 0;
    private retriggerOnNote = false;
    private lastEmittedValue = -1;
    private changeThreshold = 2; // only emit when value changes by this much
    private rng = { v: 0.5 };
    private accumPhase = 0;

    constructor(id?: string) {
        super(id ?? `ccgen-${Date.now()}`);
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], transport: TransportInfo): void {
        // Pass through all input events
        for (const event of input) {
            output.push(event);

            // Retrigger phase on Note On
            if (this.retriggerOnNote && event.kind.type === 'noteOn') {
                this.accumPhase = 0;
            }
        }

        if (!transport.isPlaying) {
            return;
        }

        // Compute how much phase advances per sample
        const phasePerSample = this.syncMode
            ? 1.0 / (rateToBeats(this.rate) * samplesPerBeat(transport))
            : this.freeRateHz / transport.sampleRate;

        // Emit CC at subdivision boundaries (every ~64 samples to avoid flooding)
        const emitInterval = 64;
        const baseTime = resolveBlockStartSamples(transport, input);
        const blockSamples = Math.max(
            0,
            resolveBlockEndSamples(transport, baseTime, EMIT_FALLBACK_BLOCK_SPAN_SAMPLES) - baseTime
        );

        // `min` and `max` are interchangeable ends of one output range, so read
        // them in order. No UI reaches an inverted pair, but a stored project,
        // a CRDT merge, or an AI-authored action can set one, which silently
        // inverts the LFO against its own shape selection.
        const low = Math.min(this.min, this.max);
        const high = Math.max(this.min, this.max);

        for (let offset = 0; offset < blockSamples; offset += emitInterval) {
            // Advance by the samples this pass actually covers. A final partial
            // interval that advanced a whole `emitInterval` would run the LFO
            // fast in proportion to how badly the block divides by 64 — and
            // short sub-blocks are routine (tempo-change splits), so the error
            // compounds every block rather than averaging out.
            this.accumPhase += phasePerSample * Math.min(emitInterval, blockSamples - offset);
            const currentPhase = (this.accumPhase + this.phase) % 1.0;
            const normalized = evalShape(this.shape, currentPhase, this.rng);
            const ccValue = Math.round(low + normalized * (high - low));

            if (Math.abs(ccValue - this.lastEmittedValue) >= this.changeThreshold) {
                this.lastEmittedValue = ccValue;
                output.push({
                    timeSamples: baseTime + offset,
                    kind: { type: 'cc', channel: 0, cc: this.ccNumber, value: Math.max(0, Math.min(127, ccValue)) },
                });
            }
        }
    }

    reset(): void {
        this.accumPhase = 0;
        this.lastEmittedValue = -1;
    }

    protected resetParams(): void {
        this.ccNumber = 1;
        this.shape = 'sine';
        this.rate = { type: 'straight', denom: 4 };
        this.freeRateHz = 1;
        this.syncMode = true;
        this.min = 0;
        this.max = 127;
        this.phase = 0;
        this.retriggerOnNote = false;
    }

    setParam(name: string, value: number): void {
        switch (name) {
            case 'cc_number':
                this.ccNumber = Math.max(0, Math.min(127, Math.round(value)));
                break;
            case 'shape':
                this.shape =
                    (['sine', 'triangle', 'square', 'sawUp', 'sawDown', 'sampleHold'] as const)[Math.round(value)] ??
                    'sine';
                break;
            case 'rate_denom':
                this.rate = { ...this.rate, denom: Math.max(1, value) };
                break;
            case 'free_rate_hz':
                this.freeRateHz = Math.max(0.01, Math.min(20, value));
                break;
            case 'sync':
                this.syncMode = value > 0.5;
                break;
            case 'min':
                this.min = Math.max(0, Math.min(127, Math.round(value)));
                break;
            case 'max':
                this.max = Math.max(0, Math.min(127, Math.round(value)));
                break;
            case 'phase':
                this.phase = Math.max(0, Math.min(1, value));
                break;
            case 'retrigger':
                this.retriggerOnNote = value > 0.5;
                break;
            // Unknown params are ignored, matching every other Yeast processor's
            // setParam contract (Arpeggiator, ScaleQuantizer, etc.). Throwing here
            // would make CCGenerator the lone outlier and could abort a host
            // parameter sweep that addresses processors uniformly.
        }
    }
}
