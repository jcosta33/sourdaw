/**
 * Pooled side-tap peak meter: one f32 per input in a SharedArrayBuffer, written
 * here on the render thread and read-and-reset by the main thread.
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

    process(inputs: Float32Array[][], _outputs: Float32Array[][]): boolean {
        if (!this._active) {
            return false;
        }
        if (!this._sab) {
            return true;
        }

        for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
            const input = inputs[inputIndex];
            if (!input || input.length === 0 || inputIndex >= this._sab.length) {
                continue;
            }
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

            if (peak > this._sab[inputIndex]!) {
                this._sab[inputIndex] = peak;
            }
        }

        return true;
    }
}

registerProcessor('metering-processor', MeteringWorkletProcessor);
