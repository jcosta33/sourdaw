/**
 * Chord Generator — builds chords from single input notes.
 * Supports voicing modes (close, drop 2, spread) and optional strum timing.
 */

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';
import { BoundedNoteVoiceQueue } from '../BoundedNoteVoiceQueue';
import {
    DRAIN_FALLBACK_BLOCK_SPAN_SAMPLES,
    resolveBlockEndSamples,
    resolveBlockStartSamples,
    ScheduledEventQueue,
} from '../MidiProcessor';

import type { YeastPreviewDecisionSink } from '../YeastPreviewSidecar';

type GeneratedChordNote = MidiEvent & { kind: Extract<MidiEvent['kind'], { type: 'noteOn' }> };

const CHORD_FORMULAS: Record<string, number[]> = {
    major: [0, 4, 7],
    minor: [0, 3, 7],
    dim: [0, 3, 6],
    aug: [0, 4, 8],
    sus2: [0, 2, 7],
    sus4: [0, 5, 7],
    dom7: [0, 4, 7, 10],
    maj7: [0, 4, 7, 11],
    min7: [0, 3, 7, 10],
    dim7: [0, 3, 6, 9],
    '9th': [0, 4, 7, 10, 14],
    '11th': [0, 4, 7, 10, 14, 17],
};

export class ChordGenerator extends BaseMidiProcessor {
    readonly name = 'Chord Generator';

    private chordType = 'major';
    private voicing: 'close' | 'drop2' | 'drop3' | 'spread' = 'close';
    private strumMs = 0; // 0 = no strum
    private strumDirection: 'up' | 'down' = 'up';
    // Track which notes we generated so we can send proper Note Offs.
    // Numeric key (channel << 7) | note matches MidiRack/ScaleQuantizer and avoids a
    // per-event template-literal allocation on the audio thread.
    private generatedVoices = new BoundedNoteVoiceQueue<GeneratedChordNote[]>();
    // Strummed tones whose time falls beyond the current block. They must
    // not leave the processor with a future timestamp (see processMidi).
    private scheduled = new ScheduledEventQueue();
    // Reused across blocks so the per-block scheduled drain allocates nothing.
    private readonly drainScratch: MidiEvent[] = [];

    constructor(id?: string) {
        super(id ?? `chord-${Date.now()}`);
    }

    processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void {
        // Bound strum emission by the transport's block range (MidiRack
        // always sets it). A strummed tone leaving the processor with
        // timeSamples >= the rack's block end parks in the rack-level
        // scheduled queue, which re-feeds it through the chain top on a
        // later block — the tone re-entered as fresh input and triggered a
        // NEW full chord (one noteOn + 20 ms strum → 12-20 noteOns in
        // 100 ms with compounding pitches). Queue future tones internally
        // and drain exactly [0, blockEnd): each tone leaves in the block
        // that contains it, as final output, and never re-enters (same
        // mechanism as the NoteRepeater fix).
        const now = resolveBlockStartSamples(transport, input);
        const blockEnd = resolveBlockEndSamples(transport, now, DRAIN_FALLBACK_BLOCK_SPAN_SAMPLES);

        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                let intervals = [...(CHORD_FORMULAS[this.chordType] ?? [0, 4, 7])];

                // Apply voicing transforms
                if (this.voicing === 'drop2' && intervals.length >= 3) {
                    // Drop the 2nd-from-top note down an octave
                    const dropIdx = intervals.length - 2;
                    intervals[dropIdx] = intervals[dropIdx]! - 12;
                    intervals.sort((alpha, b) => alpha - b);
                } else if (this.voicing === 'drop3' && intervals.length >= 4) {
                    // Drop the 3rd-from-top note down an octave
                    const dropIdx = intervals.length - 3;
                    intervals[dropIdx] = intervals[dropIdx]! - 12;
                    intervals.sort((alpha, b) => alpha - b);
                } else if (this.voicing === 'spread' && intervals.length >= 3) {
                    // Spread: alternate octave offsets for wider voicing
                    intervals = intervals.map((intv, idx) => intv + (idx % 2 === 1 ? 12 : 0));
                }

                const strumSamples = this.strumMs * 0.001 * transport.sampleRate;
                const generatedNotes: GeneratedChordNote[] = [];

                for (let index = 0; index < intervals.length; index++) {
                    const note = event.kind.note + intervals[index]!;
                    if (note < 0 || note > 127) {
                        continue;
                    }
                    const offset =
                        this.strumDirection === 'up'
                            ? index * strumSamples
                            : (intervals.length - 1 - index) * strumSamples;
                    const durationSamples =
                        event.durationSamples === undefined ? undefined : Math.max(0, event.durationSamples - offset);
                    if (durationSamples === 0) {
                        continue;
                    }
                    const generated: GeneratedChordNote = {
                        timeSamples: event.timeSamples + offset,
                        durationSamples,
                        trackId: event.trackId,
                        noteInstanceId: this.createGeneratedNoteInstanceId(),
                        kind: { type: 'noteOn', channel: event.kind.channel, note, velocity: event.kind.velocity },
                    };
                    generatedNotes.push(generated);
                    if (offset === 0 && generated.timeSamples < blockEnd) {
                        output.push(generated);
                    } else {
                        this.scheduled.push(generated);
                    }
                    preview?.transferDecisionLineage(event, generated);
                }

                const key = event.noteInstanceId ?? (event.kind.channel << 7) | event.kind.note;
                this.generatedVoices.push(event.trackId, key, generatedNotes);
            } else if (event.kind.type === 'noteOff') {
                const key = event.noteInstanceId ?? (event.kind.channel << 7) | event.kind.note;
                const generated = this.generatedVoices.shift(event.trackId, key);
                if (generated) {
                    for (const generatedNote of generated) {
                        const pending = this.scheduled.removeNoteOn(
                            generatedNote.trackId,
                            generatedNote.kind.channel,
                            generatedNote.kind.note,
                            generatedNote.timeSamples,
                            generatedNote.noteInstanceId
                        );
                        if (pending && generatedNote.timeSamples >= event.timeSamples) {
                            continue;
                        }
                        if (pending) {
                            output.push(generatedNote);
                        }
                        const noteOff: MidiEvent = {
                            timeSamples: event.timeSamples,
                            trackId: event.trackId,
                            noteInstanceId: generatedNote.noteInstanceId,
                            kind: { type: 'noteOff', channel: event.kind.channel, note: generatedNote.kind.note },
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

        // Drain internally queued strummed tones that fall in this block.
        const drained = this.drainScratch;
        drained.length = 0;
        this.scheduled.drainRangeInto(0, blockEnd, drained, this.trackId);
        for (const event1 of drained) {
            output.push(event1);
        }
        drained.length = 0;
    }

    reset(): void {
        this.generatedVoices.clear();
        this.scheduled.clear();
    }

    protected resetParams(): void {
        this.chordType = 'major';
        this.voicing = 'close';
        this.strumMs = 0;
        this.strumDirection = 'up';
    }

    setParam(name: string, value: number): void {
        switch (name) {
            case 'chord_type': {
                const types = Object.keys(CHORD_FORMULAS);
                this.chordType = types[Math.round(value)] ?? 'major';
                break;
            }
            case 'voicing':
                this.voicing = (['close', 'drop2', 'drop3', 'spread'] as const)[Math.round(value)] ?? 'close';
                break;
            case 'strum_ms':
                this.strumMs = Math.max(0, Math.min(100, value));
                break;
            case 'strum_direction':
                this.strumDirection = value > 0.5 ? 'down' : 'up';
                break;
        }
    }
}
