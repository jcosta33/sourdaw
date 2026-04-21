/**
 * Groove / Swing Module — applies timing offset templates to notes.
 * Supports built-in groove presets and custom templates.
 */

import { BaseMidiProcessor } from '../../models/BaseMidiProcessor';
import { type MidiEvent, type TransportInfo, samplesPerBeat } from '../../models/MidiEvent';

type GrooveTemplate = {
    name: string;
    /** Normalized timing offsets per step (-0.5 to +0.5 of step duration). */
    offsets: number[];
};

const GROOVE_TEMPLATES: GrooveTemplate[] = [
    { name: 'Straight', offsets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { name: 'MPC Swing', offsets: [0, 0.12, 0, 0.12, 0, 0.12, 0, 0.12, 0, 0.12, 0, 0.12, 0, 0.12, 0, 0.12] },
    {
        name: 'Triplet Shuffle',
        offsets: [0, 0.167, 0, 0.167, 0, 0.167, 0, 0.167, 0, 0.167, 0, 0.167, 0, 0.167, 0, 0.167],
    },
    { name: 'Late Backbeat', offsets: [0, 0, 0, 0, 0.05, 0, 0, 0, 0, 0, 0, 0, 0.05, 0, 0, 0] },
    {
        name: 'Dilla Pocket',
        offsets: [0, 0.08, -0.03, 0.15, 0, 0.06, -0.02, 0.12, 0, 0.09, -0.04, 0.14, 0, 0.07, -0.03, 0.11],
    },
    { name: 'Push', offsets: [-0.03, 0, -0.03, 0, -0.03, 0, -0.03, 0, -0.03, 0, -0.03, 0, -0.03, 0, -0.03, 0] },
];

export class GrooveModule extends BaseMidiProcessor {
    readonly name = 'Groove';

    private templateIndex = 0;
    private amount = 0.5; // 0–1 blend
    private subdivision = 16; // quantize grid (16 = 16th notes)
    private noteMap = new Map<string, number>(); // track timing offset for Note Off

    constructor(id?: string) {
        super(id ?? `groove-${Date.now()}`);
    }

    processMidi(input: readonly MidiEvent[], output: MidiEvent[], transport: TransportInfo): void {
        const template = GROOVE_TEMPLATES[this.templateIndex] ?? GROOVE_TEMPLATES[0]!;
        const stepLen = samplesPerBeat(transport) * (4 / this.subdivision);

        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                // Determine which step this note falls on
                const beatPos = event.timeSamples / samplesPerBeat(transport);
                const stepIdx = Math.round(beatPos * (this.subdivision / 4));
                const templateIdx = stepIdx % template.offsets.length;
                const offset = template.offsets[templateIdx]! * this.amount * stepLen;
                const offsetSamples = Math.round(offset);

                const key = `${event.kind.channel}:${event.kind.note}`;
                this.noteMap.set(key, offsetSamples);

                output.push({
                    timeSamples: event.timeSamples + offsetSamples,
                    kind: event.kind,
                });
            } else if (event.kind.type === 'noteOff') {
                const key = `${event.kind.channel}:${event.kind.note}`;
                const offset = this.noteMap.get(key) ?? 0;
                this.noteMap.delete(key);

                output.push({
                    timeSamples: event.timeSamples + offset,
                    kind: event.kind,
                });
            } else {
                output.push(event);
            }
        }
    }

    reset(): void {
        this.noteMap.clear();
    }
    setParam(name: string, value: number): void {
        switch (name) {
            case 'template':
                this.templateIndex = Math.max(0, Math.min(GROOVE_TEMPLATES.length - 1, Math.round(value)));
                break;
            case 'amount':
                this.amount = Math.max(0, Math.min(1, value));
                break;
            case 'subdivision':
                this.subdivision = Math.max(4, Math.min(32, Math.round(value)));
                break;
        }
    }

    static getTemplateNames(): string[] {
        return GROOVE_TEMPLATES.map((time) => time.name);
    }
}
