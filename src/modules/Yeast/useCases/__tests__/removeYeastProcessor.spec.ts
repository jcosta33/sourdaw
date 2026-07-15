import { afterEach, describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { getYeastRack } from '../../stores/yeastStore';
import { type MidiProcessor } from '../../worklets/MidiProcessor';
import { removeYeastProcessor } from '../removeYeastProcessor';

const eventBus = { emit: vi.fn() };

const transport: TransportInfo = {
    sampleRate: 44100,
    bpm: 120,
    ppqPosition: 0,
    isPlaying: true,
    barIndex: 0,
    beatInBar: 0,
    timeSigNum: 4,
    timeSigDen: 4,
    loopEnabled: false,
    loopStartPpq: 0,
    loopEndPpq: 0,
};

/** Pass-through processor so the rack tracks the note as active. */
class PassthroughProcessor implements MidiProcessor {
    readonly id: string;
    readonly name = 'Passthrough';
    private bypassed = false;
    constructor(id: string) {
        this.id = id;
    }
    processMidi(input: readonly MidiEvent[], output: MidiEvent[]): void {
        for (const event of input) {
            output.push(event);
        }
    }
    reset(): void {}
    setBypassed(b: boolean): void {
        this.bypassed = b;
    }
    isBypassed(): boolean {
        return this.bypassed;
    }
    setParam(): void {}
    latencySamples(): number {
        return 0;
    }
}

afterEach(() => {
    vi.restoreAllMocks();
    eventBus.emit.mockClear();
    // Drain any processors a test left on the singleton rack.
    const rack = getYeastRack();
    for (const id of rack.getProcessorIds()) {
        rack.removeProcessor(id);
    }
});

describe('removeYeastProcessor — routes hung-note offs downstream', () => {
    it('emits yeast.notesOff with the still-sounding note when a live processor is removed', () => {
        const rack = getYeastRack();
        rack.addProcessor(new PassthroughProcessor('p-live'));

        // Sound a note so the rack tracks it as active.
        rack.processBlock(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
            0,
            128,
            transport
        );

        injectDependencies(removeYeastProcessor, { eventBus });

        removeYeastProcessor('p-live');

        // The use case must EMIT the offs downstream — not silently discard the
        // value returned by rack.removeProcessor (the round-1 hung-note bug).
        expect(eventBus.emit).toHaveBeenCalledWith('yeast.notesOff', { notes: [60] });
    });

    it('does not emit when the removed processor had no sounding notes', () => {
        const rack = getYeastRack();
        rack.addProcessor(new PassthroughProcessor('p-idle'));

        injectDependencies(removeYeastProcessor, { eventBus });

        removeYeastProcessor('p-idle');

        const notesOffEmits = eventBus.emit.mock.calls.filter(([type]) => type === 'yeast.notesOff');
        expect(notesOffEmits).toHaveLength(0);
    });

    it('does not emit when the id is unknown (no spurious offs)', () => {
        injectDependencies(removeYeastProcessor, { eventBus });
        removeYeastProcessor('not-a-real-id');
        const notesOffEmits = eventBus.emit.mock.calls.filter(([type]) => type === 'yeast.notesOff');
        expect(notesOffEmits).toHaveLength(0);
    });
});
