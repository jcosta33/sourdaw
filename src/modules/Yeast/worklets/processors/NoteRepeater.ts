/**
 * Note Repeater / Echo — repeats incoming notes at intervals with velocity decay.
 * Supports pitch offset per repeat and synced/free rate.
 */

import {
    type MidiEvent,
    type TransportInfo,
    type RateValue,
    rateToBeats,
    samplesPerBeat,
} from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';
import { ScheduledEventQueue } from '../MidiProcessor';

export class NoteRepeater extends BaseMidiProcessor {
    readonly name = 'Note Repeater';

    private repeatCount = 3;
    private rate: RateValue = { type: 'straight', denom: 16 };
    private decay = 0.7; // velocity decay per repeat
    private gate = 0.5; // note length as fraction of interval
    private pitchStep = 0; // semitones per repeat
    private scheduled = new ScheduledEventQueue();

    constructor(id?: string) {
        super(id ?? `repeater-${Date.now()}`);
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], transport: TransportInfo): void {
        const intervalSamples = rateToBeats(this.rate) * samplesPerBeat(transport);
        const noteLenSamples = intervalSamples * this.gate;

        for (const event of input) {
            // Pass through the original event
            output.push(event);

            if (event.kind.type === 'noteOn') {
                // Generate repeats
                for (let r = 1; r <= this.repeatCount; r++) {
                    const time = event.timeSamples + r * intervalSamples;
                    const vel = Math.max(1, Math.round(event.kind.velocity * this.decay ** r));
                    const note = Math.max(0, Math.min(127, event.kind.note + r * this.pitchStep));

                    // Schedule Note On
                    this.scheduled.push({
                        timeSamples: time,
                        kind: { type: 'noteOn', channel: event.kind.channel, note, velocity: vel },
                    });

                    // Schedule Note Off
                    this.scheduled.push({
                        timeSamples: time + noteLenSamples,
                        kind: { type: 'noteOff', channel: event.kind.channel, note },
                    });
                }
            }
        }

        // Drain scheduled events for this block
        // Use a generous range since we don't know exact block boundaries here
        const now = input.length > 0 ? input[0]!.timeSamples : 0;
        const blockEnd = now + 8192; // generous window
        const drained = this.scheduled.drainRange(0, blockEnd);
        for (const event1 of drained) {
            output.push(event1);
        }
    }

    reset(): void {
        this.scheduled.clear();
    }
    setParam(name: string, value: number): void {
        switch (name) {
            case 'repeat_count':
                this.repeatCount = Math.max(1, Math.min(16, Math.round(value)));
                break;
            case 'rate_denom':
                this.rate = { ...this.rate, denom: Math.max(1, value) };
                break;
            case 'decay':
                this.decay = Math.max(0, Math.min(1, value));
                break;
            case 'gate':
                this.gate = Math.max(0.01, Math.min(2, value));
                break;
            case 'pitch_step':
                this.pitchStep = Math.round(value);
                break;
        }
    }
}
