/**
 * Chord Memory — Cthulhu-style one-finger chord recall.
 *
 * Store a voicing per trigger key, then recall it with a single finger.
 * Optionally transpose stored chords relative to the original root.
 */

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';
import { BoundedNoteVoiceQueue } from '../BoundedNoteVoiceQueue';

import type { YeastProcessorCommand } from '../../models/YeastProcessorCommand';
import type { YeastPreviewDecisionSink } from '../YeastPreviewSidecar';

type StoredChord = {
    root: number;
    notes: number[]; // absolute MIDI notes
};

export class ChordMemory extends BaseMidiProcessor {
    readonly name = 'Chord Memory';

    private memory = new Map<number, StoredChord>(); // trigger note → stored chord
    private learning = false;
    private learnBuffer: number[] = [];
    private learnRoot = -1;
    private transposeMode = true; // transpose stored chord relative to trigger
    // Track active chords for Note Off.
    // Numeric key (channel << 7) | triggerNote matches MidiRack/ScaleQuantizer and
    // avoids a per-event template-literal allocation on the audio thread.
    private activeChordVoices = new BoundedNoteVoiceQueue<number[]>();

    constructor(id?: string) {
        super(id ?? `chordmem-${Date.now()}`);
    }

    processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        _transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void {
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                if (this.learning) {
                    // Accumulate notes into learn buffer
                    if (this.learnRoot === -1) {
                        this.learnRoot = event.kind.note;
                    }
                    this.learnBuffer.push(event.kind.note);
                    // Don't output during learning
                    continue;
                }

                const stored = this.memory.get(event.kind.note);
                if (stored) {
                    const key = (event.kind.channel << 7) | event.kind.note;
                    const emitted: number[] = [];
                    const transpose = this.transposeMode ? event.kind.note - stored.root : 0;

                    for (const node of stored.notes) {
                        const note = Math.max(0, Math.min(127, node + transpose));
                        emitted.push(note);
                        const generated: MidiEvent = {
                            timeSamples: event.timeSamples,
                            durationSamples: event.durationSamples,
                            trackId: event.trackId,
                            kind: { type: 'noteOn', channel: event.kind.channel, note, velocity: event.kind.velocity },
                        };
                        output.push(generated);
                        preview?.transferDecisionLineage(event, generated);
                    }
                    this.activeChordVoices.push(event.trackId, key, emitted);
                } else {
                    // No memory for this key — pass through
                    output.push(event);
                }
            } else if (event.kind.type === 'noteOff') {
                if (this.learning) {
                    // On release during learning, finalize if buffer has notes
                    // (simplified: commit on first Note Off)
                    if (this.learnBuffer.length > 0 && this.learnRoot >= 0) {
                        this.memory.set(this.learnRoot, {
                            root: this.learnRoot,
                            notes: [...this.learnBuffer],
                        });
                        this.learnBuffer = [];
                        this.learnRoot = -1;
                        this.learning = false;
                    }
                    continue;
                }

                const key = (event.kind.channel << 7) | event.kind.note;
                const emitted = this.activeChordVoices.shift(event.trackId, key);
                if (emitted) {
                    for (const note of emitted) {
                        const noteOff: MidiEvent = {
                            timeSamples: event.timeSamples,
                            trackId: event.trackId,
                            kind: { type: 'noteOff', channel: event.kind.channel, note },
                        };
                        output.push(noteOff);
                        preview?.transferDecisionLineage(event, noteOff);
                    }
                } else {
                    output.push(event);
                }
            } else {
                output.push(event);
            }
        }
    }

    reset(): void {
        this.activeChordVoices.clear();
        this.learnBuffer = [];
        this.learnRoot = -1;
        this.learning = false;
    }

    executeCommand(command: YeastProcessorCommand): boolean {
        if (command.processorId !== this.id) {
            return false;
        }
        switch (command.type) {
            case 'chordMemory.learn':
                this.learning = true;
                this.learnBuffer = [];
                this.learnRoot = -1;
                return true;
            case 'chordMemory.clear':
                this.memory.clear();
                return true;
        }
        return false;
    }

    protected resetParams(): void {
        this.transposeMode = true;
    }

    setParam(name: string, value: number): void {
        switch (name) {
            case 'transpose_mode':
                this.transposeMode = value > 0.5;
                break;
        }
    }

    /** Get stored chord count for UI. */
    getStoredCount(): number {
        return this.memory.size;
    }
    isLearning(): boolean {
        return this.learning;
    }
}
