/**
 * Pass-through peak meter: one f32 in a SharedArrayBuffer, written here on the
 * render thread and read-and-reset by the main thread (TrackNode.getPeakLevel,
 * WebAudioEngine.getMasterPeakLevel).
 *
 * **The plain, non-`Atomics` access below is deliberate (audit RT-9), not an
 * oversight and not a missing seqlock — do not "fix" it into one.** The multi-
 * field telemetry slots need the seqlock in engine/telemetryAllocator.ts because
 * a reader there can pair field A from one block with field B from the next: a
 * torn *snapshot* across fields. This buffer holds a single 4-byte-aligned
 * scalar with exactly one writer and one reader, so there is no cross-field
 * pairing to tear and no real hardware on which the value itself tears. The only
 * race is benign and already accepted by the design: a peak written between the
 * reader's load and its reset is dropped, costing at most one meter frame of a
 * value that is decaying anyway. Wrapping it in Atomics would add render-thread
 * RMWs to buy nothing.
 */
type MeteringMsg = { type: 'init'; sab: SharedArrayBuffer } | { type: 'shutdown' };

export class MeteringWorkletProcessor extends AudioWorkletProcessor {
    private _active = true;
    private _sab: Float32Array | null = null;

    constructor() {
        super();
        this.port.onmessage = (event: MessageEvent<MeteringMsg>) => {
            if (event.data.type === 'shutdown') {
                this._active = false;
                this._sab = null;
                return;
            }
            this._sab = new Float32Array(event.data.sab);
        };
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        if (!this._active) {
            return false;
        }
        const input = inputs[0];
        if (!input || input.length === 0 || !this._sab) {
            return true;
        }

        // Pass-through audio so we can drop this right in the signal chain
        const output = outputs[0];
        if (output && output.length > 0) {
            for (let channel = 0; channel < input.length; channel++) {
                const inData = input[channel];
                const outData = output[channel];
                if (inData && outData) {
                    outData.set(inData);
                }
            }
        }

        // Calculate the combined peak across every input channel in the block.
        // The SAB holds a single float, so this is a mono peak readout by design
        // (the consumer surface, getPeakLevel/getMasterPeakLevel, returns one
        // number). Scanning all present channels — rather than a caller-supplied
        // `channels` count against a 1-float buffer — means a hard-panned signal
        // is not under-reported by the meter.
        let peak = 0;
        for (let channel = 0; channel < input.length; channel++) {
            const data = input[channel];
            if (data) {
                for (let index = 0; index < data.length; index++) {
                    const abs = Math.abs(data[index]!);
                    if (abs > peak) {
                        peak = abs;
                    }
                }
            }
        }

        // Write the peak to SAB (UI reads and resets to 0 periodically)
        // Using Math.max so we don't drop peaks between UI polling frames.
        // Non-atomic by design — see the RT-9 note in the module header.
        if (peak > this._sab[0]!) {
            this._sab[0] = peak;
        }

        return true;
    }
}

registerProcessor('metering-processor', MeteringWorkletProcessor);
