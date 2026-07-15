/**
 * Harmonizer — adds scale-aware harmony voices to incoming notes.
 * Each voice transposes by scale degrees (not semitones) for musically correct harmonies.
 */

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { BaseMidiProcessor } from '../BaseMidiProcessor';

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
    private generatedMap = new Map<string | undefined, Map<number, number[]>>();

    constructor(id?: string) {
        super(id ?? `harmonizer-${Date.now()}`);
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], _transport: TransportInfo): void {
        const pattern = SCALE_PATTERNS[this.scaleName] ?? SCALE_PATTERNS.major!;

        for (const event of input) {
            // Always pass through original
            output.push(event);

            if (event.kind.type === 'noteOn') {
                const key = (event.kind.channel << 7) | event.kind.note;
                const harmonyNotes: number[] = [];

                for (const voice of this.voices) {
                    if (!voice.enabled) {
                        continue;
                    }

                    const harmonyNote = this.diatonicTranspose(event.kind.note, voice.degrees, pattern);
                    if (harmonyNote < 0 || harmonyNote > 127) {
                        continue;
                    }

                    harmonyNotes.push(harmonyNote);
                    const vel = Math.max(1, Math.min(127, event.kind.velocity + voice.velocityOffset));

                    output.push({
                        timeSamples: event.timeSamples + voice.timeOffsetSamples,
                        trackId: event.trackId,
                        kind: { type: 'noteOn', channel: event.kind.channel, note: harmonyNote, velocity: vel },
                    });
                }

                const routeMap = this.generatedMap.get(event.trackId) ?? new Map<number, number[]>();
                routeMap.set(key, harmonyNotes);
                this.generatedMap.set(event.trackId, routeMap);
            } else if (event.kind.type === 'noteOff') {
                const key = (event.kind.channel << 7) | event.kind.note;
                const routeMap = this.generatedMap.get(event.trackId);
                const generated = routeMap?.get(key);
                if (routeMap && generated) {
                    for (const note of generated) {
                        output.push({
                            timeSamples: event.timeSamples,
                            trackId: event.trackId,
                            kind: { type: 'noteOff', channel: event.kind.channel, note },
                        });
                    }
                    routeMap.delete(key);
                    if (routeMap.size === 0) {
                        this.generatedMap.delete(event.trackId);
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
        this.generatedMap.clear();
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
                if (this.voices[0]) {
                    this.voices[0].degrees = Math.round(value);
                }
                break;
            case 'voice1_degrees':
                if (this.voices[1]) {
                    this.voices[1].degrees = Math.round(value);
                }
                break;
            case 'voice2_degrees':
                if (this.voices[2]) {
                    this.voices[2].degrees = Math.round(value);
                }
                break;
            case 'voice0_enabled':
                if (this.voices[0]) {
                    this.voices[0].enabled = value > 0.5;
                }
                break;
            case 'voice1_enabled':
                if (this.voices[1]) {
                    this.voices[1].enabled = value > 0.5;
                }
                break;
            case 'voice2_enabled':
                if (this.voices[2]) {
                    this.voices[2].enabled = value > 0.5;
                }
                break;
            case 'voice0_vel_offset':
                if (this.voices[0]) {
                    this.voices[0].velocityOffset = Math.round(value);
                }
                break;
            case 'voice1_vel_offset':
                if (this.voices[1]) {
                    this.voices[1].velocityOffset = Math.round(value);
                }
                break;
            case 'voice2_vel_offset':
                if (this.voices[2]) {
                    this.voices[2].velocityOffset = Math.round(value);
                }
                break;
        }
    }
}
