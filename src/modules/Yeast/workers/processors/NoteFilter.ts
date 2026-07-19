/**
 * Note Filter — filter notes by range, velocity, or pitch class.
 * Useful for keyboard splits, velocity layers, and scale-based filtering.
 */

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';
import { BoundedNoteVoiceQueue } from '../BoundedNoteVoiceQueue';

export class NoteFilter extends BaseMidiProcessor {
    readonly name = 'Note Filter';

    private noteMin = 0;
    private noteMax = 127;
    private velMin = 0;
    private velMax = 127;
    private allowedPitchClasses = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]); // all by default
    private invert = false;
    // Track every Note On decision so overlapping equal-key voices consume the
    // matching FIFO decision and suppress only the offs whose ons were filtered.
    // Numeric key (channel << 7) | note matches MidiRack/ScaleQuantizer/Humanizer
    // and avoids a per-event template-literal allocation on the audio thread.
    private noteDecisions = new BoundedNoteVoiceQueue<boolean>();

    constructor(id?: string) {
        super(id ?? `filter-${Date.now()}`);
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], _transport: TransportInfo): void {
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                const key = (event.kind.channel << 7) | event.kind.note;
                let passes = this.passesFilter(event.kind.note, event.kind.velocity);
                if (this.invert) {
                    passes = !passes;
                }

                if (passes) {
                    this.noteDecisions.push(event.trackId, key, true);
                    output.push(event);
                } else {
                    this.noteDecisions.push(event.trackId, key, false);
                }
            } else if (event.kind.type === 'noteOff') {
                const key = (event.kind.channel << 7) | event.kind.note;
                const passed = this.noteDecisions.shift(event.trackId, key);
                if (passed !== false) {
                    output.push(event);
                }
            } else {
                output.push(event);
            }
        }
    }

    private passesFilter(note: number, velocity: number): boolean {
        if (note < this.noteMin || note > this.noteMax) {
            return false;
        }
        if (velocity < this.velMin || velocity > this.velMax) {
            return false;
        }
        if (!this.allowedPitchClasses.has(note % 12)) {
            return false;
        }
        return true;
    }

    reset(): void {
        // Clear the filtered-note tracking. A filtered Note On was never forwarded
        // downstream, so dropping its key can never orphan a sounding note — the
        // only thing the key does is suppress a *matching* Note Off. Keeping a stale
        // key across a reset/panic is strictly worse: if the user later widens the
        // range so that note number now passes, the next Note On is forwarded and
        // sounding, but its Note Off matches the stale key and is swallowed — a hung
        // note. Clearing on reset closes that window; legitimately filtered Note
        // On/Off pairs within a single playback span still match because they arrive
        // without an intervening reset.
        this.noteDecisions.clear();
    }

    protected resetParams(): void {
        this.noteMin = 0;
        this.noteMax = 127;
        this.velMin = 0;
        this.velMax = 127;
        this.invert = false;
    }

    setParam(name: string, value: number): void {
        switch (name) {
            case 'note_min':
                this.noteMin = Math.max(0, Math.min(127, Math.round(value)));
                break;
            case 'note_max':
                this.noteMax = Math.max(0, Math.min(127, Math.round(value)));
                break;
            case 'vel_min':
                this.velMin = Math.max(0, Math.min(127, Math.round(value)));
                break;
            case 'vel_max':
                this.velMax = Math.max(0, Math.min(127, Math.round(value)));
                break;
            case 'invert':
                this.invert = value > 0.5;
                break;
        }
    }

    /** Set allowed pitch classes (0-11). */
    setAllowedPitchClasses(classes: number[]): void {
        this.allowedPitchClasses = new Set(classes);
    }
}
