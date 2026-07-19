/**
 * BaseMidiProcessor — abstract base class that provides default implementations
 * of the bypass and latency boilerplate shared by all Yeast processor classes.
 *
 * Subclasses must implement: processMidi, reset, setParam (and declare id/name).
 */

import { type MidiEvent, type TransportInfo } from '../models/MidiEvent';

import { type MidiProcessor, type MidiProcessorParams } from './MidiProcessor';

import type { YeastPreviewDecisionSink } from './YeastPreviewSidecar';
import type { YeastProcessorCommand } from '../models/YeastProcessorCommand';

export abstract class BaseMidiProcessor implements MidiProcessor {
    readonly id: string;
    abstract readonly name: string;

    private bypassed = false;
    protected trackId: string | undefined;

    constructor(id: string) {
        this.id = id;
    }

    abstract processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void;
    abstract reset(): void;
    abstract setParam(name: string, value: number): void;
    /** Reset only fields controlled by setParam; live processor state must survive. */
    protected abstract resetParams(): void;

    replaceParams(params: MidiProcessorParams): void {
        this.resetParams();
        for (const [name, value] of Object.entries(params)) {
            this.setParam(name, value);
        }
    }

    executeCommand(_command: YeastProcessorCommand): boolean {
        return false;
    }

    setBypassed(b: boolean): void {
        this.bypassed = b;
    }

    isBypassed(): boolean {
        return this.bypassed;
    }

    setTrackId(trackId: string): void {
        this.trackId = trackId;
    }

    latencySamples(): number {
        return 0;
    }
}
