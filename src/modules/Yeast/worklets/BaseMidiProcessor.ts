/**
 * BaseMidiProcessor — abstract base class that provides default implementations
 * of the bypass and latency boilerplate shared by all Yeast processor classes.
 *
 * Subclasses must implement: processMidi, reset, setParam (and declare id/name).
 */

import { type MidiEvent, type TransportInfo } from '../models/MidiEvent';

import { type MidiProcessor } from './MidiProcessor';

export abstract class BaseMidiProcessor implements MidiProcessor {
    readonly id: string;
    abstract readonly name: string;

    private bypassed = false;

    constructor(id: string) {
        this.id = id;
    }

    abstract processMidi(input: readonly MidiEvent[], output: MidiEvent[], transport: TransportInfo): void;
    abstract reset(): void;
    abstract setParam(name: string, value: number): void;

    setBypassed(b: boolean): void {
        this.bypassed = b;
    }

    isBypassed(): boolean {
        return this.bypassed;
    }

    latencySamples(): number {
        return 0;
    }
}
