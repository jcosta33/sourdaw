/**
 * Harmonizer — adds scale-aware harmony voices to incoming notes.
 * Each voice transposes by scale degrees (not semitones) for musically correct harmonies.
 */

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';
import { BoundedNoteVoiceQueue } from '../BoundedNoteVoiceQueue';

import type { YeastPreviewDecisionSink } from '../YeastPreviewSidecar';

const SCALE_PATTERNS: Record<string, number[]> = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    pentatonic: [0, 2, 4, 7, 9],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
const SCALE_NAMES = Object.keys(SCALE_PATTERNS);

type HarmonyVoice = {
    degrees: number;
    velocityOffset: number;
    timeOffsetSamples: number;
    enabled: boolean;
};

type GeneratedHarmonyNote = { note: number; noteInstanceId: string };

export class Harmonizer extends BaseMidiProcessor {
    readonly name = 'Harmonizer';

    private root = 0;
    private scaleName = 'major';
    private voices: HarmonyVoice[] = [
        { degrees: 2, velocityOffset: -10, timeOffsetSamples: 0, enabled: true }, // 3rd
        { degrees: 4, velocityOffset: -15, timeOffsetSamples: 0, enabled: false }, // 5th
        { degrees: -1, velocityOffset: -20, timeOffsetSamples: 0, enabled: false }, // below
    ];
    // Track generated harmony notes for proper Note Off.
    // Numeric key (channel << 7) | note matches MidiRack/ScaleQuantizer and avoids a
    // per-event template-literal allocation on the audio thread.
    private generatedVoices = new BoundedNoteVoiceQueue<GeneratedHarmonyNote[]>();

    constructor(id?: string) {
        super(id ?? `harmonizer-${Date.now()}`);
    }

    processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        _transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void {
        // scaleName is always a valid SCALE_PATTERNS key: the constructor and
        // resetParams set it to 'major', and setParam('scale', v) clamps via
        // SCALE_NAMES[...] ?? 'major'. The fallback is therefore unreachable.
        const pattern = SCALE_PATTERNS[this.scaleName]!;

        for (const event of input) {
            // Always pass through original
            output.push(event);

            if (event.kind.type === 'noteOn') {
                const key = event.noteInstanceId ?? (event.kind.channel << 7) | event.kind.note;
                const harmonyNotes: GeneratedHarmonyNote[] = [];

                for (const voice of this.voices) {
                    if (!voice.enabled) {
                        continue;
                    }

                    const harmonyNote = this.diatonicTranspose(event.kind.note, voice.degrees, pattern);
                    if (harmonyNote < 0 || harmonyNote > 127) {
                        continue;
                    }

                    const vel = Math.max(1, Math.min(127, event.kind.velocity + voice.velocityOffset));
                    const durationSamples =
                        event.durationSamples === undefined
                            ? undefined
                            : Math.max(0, event.durationSamples - voice.timeOffsetSamples);
                    if (durationSamples === 0) {
                        continue;
                    }
                    const noteInstanceId = this.createGeneratedNoteInstanceId();
                    harmonyNotes.push({ note: harmonyNote, noteInstanceId });

                    const generated: MidiEvent = {
                        timeSamples: event.timeSamples + voice.timeOffsetSamples,
                        durationSamples,
                        trackId: event.trackId,
                        noteInstanceId,
                        kind: { type: 'noteOn', channel: event.kind.channel, note: harmonyNote, velocity: vel },
                    };
                    output.push(generated);
                    preview?.transferDecisionLineage(event, generated);
                }

                this.generatedVoices.push(event.trackId, key, harmonyNotes);
            } else if (event.kind.type === 'noteOff') {
                const key = event.noteInstanceId ?? (event.kind.channel << 7) | event.kind.note;
                const generated = this.generatedVoices.shift(event.trackId, key);
                if (generated) {
                    for (const generatedNote of generated) {
                        const noteOff: MidiEvent = {
                            timeSamples: event.timeSamples,
                            trackId: event.trackId,
                            noteInstanceId: generatedNote.noteInstanceId,
                            kind: { type: 'noteOff', channel: event.kind.channel, note: generatedNote.note },
                        };
                        output.push(noteOff);
                        preview?.transferDecisionLineage(event, noteOff);
                    }
                }
            }
        }
    }

    private diatonicTranspose(note: number, degrees: number, pattern: number[]): number {
        const pc = (((note - this.root) % 12) + 12) % 12;
        const octave = Math.floor((note - this.root) / 12);

        // Find closest scale degree
        let degreeIdx = 0;
        let minDist = 12;
        for (let index = 0; index < pattern.length; index++) {
            const dist = Math.abs(pc - pattern[index]!);
            if (dist < minDist) {
                minDist = dist;
                degreeIdx = index;
            }
        }

        const newIdx = degreeIdx + degrees;
        const newOctOffset = Math.floor(newIdx / pattern.length);
        const wrappedIdx = ((newIdx % pattern.length) + pattern.length) % pattern.length;
        return this.root + (octave + newOctOffset) * 12 + pattern[wrappedIdx]!;
    }

    reset(): void {
        this.generatedVoices.clear();
    }

    protected resetParams(): void {
        this.root = 0;
        this.scaleName = 'major';
        this.voices = [
            { degrees: 2, velocityOffset: -10, timeOffsetSamples: 0, enabled: true },
            { degrees: 4, velocityOffset: -15, timeOffsetSamples: 0, enabled: false },
            { degrees: -1, velocityOffset: -20, timeOffsetSamples: 0, enabled: false },
        ];
    }

    setParam(name: string, value: number): void {
        switch (name) {
            case 'root':
                this.root = Math.round(value) % 12;
                break;
            case 'scale': {
                this.scaleName = SCALE_NAMES[Math.round(value)] ?? 'major';
                break;
            }
            case 'voice0_degrees':
                this.voices[0]!.degrees = Math.round(value);
                break;
            case 'voice1_degrees':
                this.voices[1]!.degrees = Math.round(value);
                break;
            case 'voice2_degrees':
                this.voices[2]!.degrees = Math.round(value);
                break;
            case 'voice0_enabled':
                this.voices[0]!.enabled = value > 0.5;
                break;
            case 'voice1_enabled':
                this.voices[1]!.enabled = value > 0.5;
                break;
            case 'voice2_enabled':
                this.voices[2]!.enabled = value > 0.5;
                break;
            case 'voice0_vel_offset':
                this.voices[0]!.velocityOffset = Math.round(value);
                break;
            case 'voice1_vel_offset':
                this.voices[1]!.velocityOffset = Math.round(value);
                break;
            case 'voice2_vel_offset':
                this.voices[2]!.velocityOffset = Math.round(value);
                break;
        }
    }
}
