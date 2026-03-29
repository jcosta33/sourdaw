/**
 * Note Filter — filter notes by range, velocity, or pitch class.
 * Useful for keyboard splits, velocity layers, and scale-based filtering.
 */

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { type MidiProcessor } from '../../models/MidiProcessor';

export class NoteFilter implements MidiProcessor {
    readonly id: string;
    readonly name = 'Note Filter';

    private noteMin = 0;
    private noteMax = 127;
    private velMin = 0;
    private velMax = 127;
    private allowedPitchClasses = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]); // all by default
    private invert = false;
    private bypassed = false;
    // Track filtered Note Ons to suppress matching Note Offs
    private filteredNotes = new Set<string>();

    constructor(id?: string) {
        this.id = id ?? `filter-${Date.now()}`;
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], _transport: TransportInfo): void {
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                const key = `${event.kind.channel}:${event.kind.note}`;
                let passes = this.passesFilter(event.kind.note, event.kind.velocity);
                if (this.invert) passes = !passes;

                if (passes) {
                    output.push(event);
                } else {
                    this.filteredNotes.add(key);
                }
            } else if (event.kind.type === 'noteOff') {
                const key = `${event.kind.channel}:${event.kind.note}`;
                if (this.filteredNotes.has(key)) {
                    this.filteredNotes.delete(key);
                    // Suppress the Note Off for a filtered Note On
                } else {
                    output.push(event);
                }
            } else {
                output.push(event);
            }
        }
    }

    private passesFilter(note: number, velocity: number): boolean {
        if (note < this.noteMin || note > this.noteMax) return false;
        if (velocity < this.velMin || velocity > this.velMax) return false;
        if (!this.allowedPitchClasses.has(note % 12)) return false;
        return true;
    }

    reset(): void { this.filteredNotes.clear(); }
    setBypassed(b: boolean): void { this.bypassed = b; }
    isBypassed(): boolean { return this.bypassed; }
    latencySamples(): number { return 0; }

    setParam(name: string, value: number): void {
        switch (name) {
            case 'note_min': this.noteMin = Math.max(0, Math.min(127, Math.round(value))); break;
            case 'note_max': this.noteMax = Math.max(0, Math.min(127, Math.round(value))); break;
            case 'vel_min': this.velMin = Math.max(0, Math.min(127, Math.round(value))); break;
            case 'vel_max': this.velMax = Math.max(0, Math.min(127, Math.round(value))); break;
            case 'invert': this.invert = value > 0.5; break;
        }
    }

    /** Set allowed pitch classes (0-11). */
    setAllowedPitchClasses(classes: number[]): void {
        this.allowedPitchClasses = new Set(classes);
    }
}
