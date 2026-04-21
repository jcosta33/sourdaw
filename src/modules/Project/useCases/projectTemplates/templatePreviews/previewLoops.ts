export type PreviewVoice = 'kick' | 'snare' | 'hat' | 'bass' | 'lead' | 'pad' | 'chord' | 'pluck';

export type PreviewEvent = {
    beat: number;
    duration: number;
    pitch: number;
    velocity?: number;
    voice: PreviewVoice;
};

export type TemplatePreview = {
    templateId: string;
    bpm: number;
    bars: number;
    events: PreviewEvent[];
};

const popSong: TemplatePreview = {
    templateId: 'pop-song',
    bpm: 100,
    bars: 2,
    events: [
        { beat: 0, duration: 0.25, pitch: 36, velocity: 110, voice: 'kick' },
        { beat: 1, duration: 0.25, pitch: 38, velocity: 100, voice: 'snare' },
        { beat: 2, duration: 0.25, pitch: 36, velocity: 105, voice: 'kick' },
        { beat: 3, duration: 0.25, pitch: 38, velocity: 100, voice: 'snare' },
        { beat: 4, duration: 0.25, pitch: 36, velocity: 110, voice: 'kick' },
        { beat: 5, duration: 0.25, pitch: 38, velocity: 100, voice: 'snare' },
        { beat: 6, duration: 0.25, pitch: 36, velocity: 105, voice: 'kick' },
        { beat: 7, duration: 0.25, pitch: 38, velocity: 100, voice: 'snare' },
        { beat: 0, duration: 0.5, pitch: 42, velocity: 70, voice: 'hat' },
        { beat: 0.5, duration: 0.5, pitch: 42, velocity: 60, voice: 'hat' },
        { beat: 1, duration: 0.5, pitch: 42, velocity: 70, voice: 'hat' },
        { beat: 1.5, duration: 0.5, pitch: 42, velocity: 60, voice: 'hat' },
        { beat: 2, duration: 0.5, pitch: 42, velocity: 70, voice: 'hat' },
        { beat: 2.5, duration: 0.5, pitch: 42, velocity: 60, voice: 'hat' },
        { beat: 3, duration: 0.5, pitch: 42, velocity: 70, voice: 'hat' },
        { beat: 3.5, duration: 0.5, pitch: 42, velocity: 60, voice: 'hat' },
        { beat: 0, duration: 1, pitch: 36, velocity: 95, voice: 'bass' },
        { beat: 2, duration: 1, pitch: 43, velocity: 90, voice: 'bass' },
        { beat: 4, duration: 1, pitch: 41, velocity: 90, voice: 'bass' },
        { beat: 6, duration: 1, pitch: 38, velocity: 90, voice: 'bass' },
        { beat: 0, duration: 0.5, pitch: 60, velocity: 85, voice: 'chord' },
        { beat: 2, duration: 0.5, pitch: 65, velocity: 85, voice: 'chord' },
        { beat: 4, duration: 0.5, pitch: 64, velocity: 85, voice: 'chord' },
        { beat: 6, duration: 0.5, pitch: 62, velocity: 85, voice: 'chord' },
        { beat: 1.5, duration: 0.5, pitch: 72, velocity: 95, voice: 'lead' },
        { beat: 2.5, duration: 0.5, pitch: 74, velocity: 95, voice: 'lead' },
        { beat: 5.5, duration: 0.5, pitch: 76, velocity: 95, voice: 'lead' },
        { beat: 6.5, duration: 1, pitch: 72, velocity: 90, voice: 'lead' },
    ],
};

const hipHopTrap: TemplatePreview = {
    templateId: 'hiphop-trap',
    bpm: 140,
    bars: 2,
    events: [
        { beat: 0, duration: 0.25, pitch: 36, velocity: 115, voice: 'kick' },
        { beat: 2, duration: 0.25, pitch: 38, velocity: 105, voice: 'snare' },
        { beat: 3.5, duration: 0.25, pitch: 36, velocity: 100, voice: 'kick' },
        { beat: 4.5, duration: 0.25, pitch: 36, velocity: 115, voice: 'kick' },
        { beat: 6, duration: 0.25, pitch: 38, velocity: 105, voice: 'snare' },
        { beat: 0, duration: 0.25, pitch: 42, velocity: 70, voice: 'hat' },
        { beat: 0.5, duration: 0.25, pitch: 42, velocity: 55, voice: 'hat' },
        { beat: 1, duration: 0.125, pitch: 42, velocity: 70, voice: 'hat' },
        { beat: 1.25, duration: 0.125, pitch: 42, velocity: 55, voice: 'hat' },
        { beat: 1.5, duration: 0.125, pitch: 42, velocity: 75, voice: 'hat' },
        { beat: 1.625, duration: 0.0625, pitch: 42, velocity: 60, voice: 'hat' },
        { beat: 1.6875, duration: 0.0625, pitch: 42, velocity: 55, voice: 'hat' },
        { beat: 1.75, duration: 0.125, pitch: 42, velocity: 65, voice: 'hat' },
        { beat: 2.5, duration: 0.25, pitch: 42, velocity: 60, voice: 'hat' },
        { beat: 3, duration: 0.25, pitch: 42, velocity: 70, voice: 'hat' },
        { beat: 4, duration: 0.25, pitch: 42, velocity: 70, voice: 'hat' },
        { beat: 5, duration: 0.25, pitch: 42, velocity: 70, voice: 'hat' },
        { beat: 5.5, duration: 0.25, pitch: 42, velocity: 60, voice: 'hat' },
        { beat: 0, duration: 1.5, pitch: 29, velocity: 120, voice: 'bass' },
        { beat: 3.5, duration: 0.5, pitch: 29, velocity: 110, voice: 'bass' },
        { beat: 4, duration: 1.5, pitch: 34, velocity: 115, voice: 'bass' },
        { beat: 6, duration: 2, pitch: 32, velocity: 110, voice: 'bass' },
    ],
};

const edm: TemplatePreview = {
    templateId: 'edm',
    bpm: 128,
    bars: 2,
    events: [
        { beat: 0, duration: 0.25, pitch: 36, velocity: 120, voice: 'kick' },
        { beat: 1, duration: 0.25, pitch: 36, velocity: 120, voice: 'kick' },
        { beat: 2, duration: 0.25, pitch: 36, velocity: 120, voice: 'kick' },
        { beat: 3, duration: 0.25, pitch: 36, velocity: 120, voice: 'kick' },
        { beat: 4, duration: 0.25, pitch: 36, velocity: 120, voice: 'kick' },
        { beat: 5, duration: 0.25, pitch: 36, velocity: 120, voice: 'kick' },
        { beat: 6, duration: 0.25, pitch: 36, velocity: 120, voice: 'kick' },
        { beat: 7, duration: 0.25, pitch: 36, velocity: 120, voice: 'kick' },
        { beat: 1, duration: 0.25, pitch: 38, velocity: 105, voice: 'snare' },
        { beat: 3, duration: 0.25, pitch: 38, velocity: 105, voice: 'snare' },
        { beat: 5, duration: 0.25, pitch: 38, velocity: 105, voice: 'snare' },
        { beat: 7, duration: 0.25, pitch: 38, velocity: 105, voice: 'snare' },
        { beat: 0.5, duration: 0.5, pitch: 36, velocity: 40, voice: 'bass' },
        { beat: 1.5, duration: 0.5, pitch: 36, velocity: 90, voice: 'bass' },
        { beat: 2.5, duration: 0.5, pitch: 36, velocity: 40, voice: 'bass' },
        { beat: 3.5, duration: 0.5, pitch: 36, velocity: 90, voice: 'bass' },
        { beat: 4.5, duration: 0.5, pitch: 36, velocity: 40, voice: 'bass' },
        { beat: 5.5, duration: 0.5, pitch: 36, velocity: 90, voice: 'bass' },
        { beat: 6.5, duration: 0.5, pitch: 36, velocity: 40, voice: 'bass' },
        { beat: 7.5, duration: 0.5, pitch: 36, velocity: 90, voice: 'bass' },
        { beat: 0, duration: 1, pitch: 72, velocity: 95, voice: 'lead' },
        { beat: 2, duration: 1, pitch: 75, velocity: 95, voice: 'lead' },
        { beat: 4, duration: 1, pitch: 74, velocity: 95, voice: 'lead' },
        { beat: 6, duration: 2, pitch: 72, velocity: 100, voice: 'lead' },
    ],
};

const rockBand: TemplatePreview = {
    templateId: 'rock-band',
    bpm: 120,
    bars: 2,
    events: [
        { beat: 0, duration: 0.25, pitch: 36, velocity: 115, voice: 'kick' },
        { beat: 0.75, duration: 0.25, pitch: 36, velocity: 100, voice: 'kick' },
        { beat: 1, duration: 0.25, pitch: 38, velocity: 110, voice: 'snare' },
        { beat: 2, duration: 0.25, pitch: 36, velocity: 115, voice: 'kick' },
        { beat: 3, duration: 0.25, pitch: 38, velocity: 110, voice: 'snare' },
        { beat: 4, duration: 0.25, pitch: 36, velocity: 115, voice: 'kick' },
        { beat: 4.75, duration: 0.25, pitch: 36, velocity: 100, voice: 'kick' },
        { beat: 5, duration: 0.25, pitch: 38, velocity: 110, voice: 'snare' },
        { beat: 6, duration: 0.25, pitch: 36, velocity: 115, voice: 'kick' },
        { beat: 7, duration: 0.25, pitch: 38, velocity: 110, voice: 'snare' },
        { beat: 0, duration: 0.5, pitch: 46, velocity: 80, voice: 'hat' },
        { beat: 1, duration: 0.5, pitch: 46, velocity: 80, voice: 'hat' },
        { beat: 2, duration: 0.5, pitch: 46, velocity: 80, voice: 'hat' },
        { beat: 3, duration: 0.5, pitch: 46, velocity: 80, voice: 'hat' },
        { beat: 4, duration: 0.5, pitch: 46, velocity: 80, voice: 'hat' },
        { beat: 5, duration: 0.5, pitch: 46, velocity: 80, voice: 'hat' },
        { beat: 6, duration: 0.5, pitch: 46, velocity: 80, voice: 'hat' },
        { beat: 7, duration: 0.5, pitch: 46, velocity: 80, voice: 'hat' },
        { beat: 0, duration: 0.5, pitch: 40, velocity: 100, voice: 'bass' },
        { beat: 1, duration: 0.5, pitch: 40, velocity: 95, voice: 'bass' },
        { beat: 2, duration: 0.5, pitch: 40, velocity: 100, voice: 'bass' },
        { beat: 3, duration: 0.5, pitch: 40, velocity: 95, voice: 'bass' },
        { beat: 4, duration: 0.5, pitch: 45, velocity: 100, voice: 'bass' },
        { beat: 5, duration: 0.5, pitch: 45, velocity: 95, voice: 'bass' },
        { beat: 6, duration: 0.5, pitch: 43, velocity: 100, voice: 'bass' },
        { beat: 7, duration: 0.5, pitch: 43, velocity: 95, voice: 'bass' },
        { beat: 0, duration: 0.75, pitch: 52, velocity: 100, voice: 'chord' },
        { beat: 2, duration: 0.75, pitch: 52, velocity: 100, voice: 'chord' },
        { beat: 4, duration: 0.75, pitch: 57, velocity: 100, voice: 'chord' },
        { beat: 6, duration: 0.75, pitch: 55, velocity: 100, voice: 'chord' },
    ],
};

const lofi: TemplatePreview = {
    templateId: 'lofi',
    bpm: 80,
    bars: 2,
    events: [
        { beat: 0, duration: 0.25, pitch: 36, velocity: 95, voice: 'kick' },
        { beat: 1.08, duration: 0.25, pitch: 38, velocity: 85, voice: 'snare' },
        { beat: 2.33, duration: 0.25, pitch: 36, velocity: 90, voice: 'kick' },
        { beat: 3.08, duration: 0.25, pitch: 38, velocity: 85, voice: 'snare' },
        { beat: 4, duration: 0.25, pitch: 36, velocity: 95, voice: 'kick' },
        { beat: 5.08, duration: 0.25, pitch: 38, velocity: 85, voice: 'snare' },
        { beat: 6.5, duration: 0.25, pitch: 36, velocity: 85, voice: 'kick' },
        { beat: 7.08, duration: 0.25, pitch: 38, velocity: 85, voice: 'snare' },
        { beat: 0.5, duration: 0.4, pitch: 42, velocity: 55, voice: 'hat' },
        { beat: 1.5, duration: 0.4, pitch: 42, velocity: 50, voice: 'hat' },
        { beat: 2.5, duration: 0.4, pitch: 42, velocity: 55, voice: 'hat' },
        { beat: 3.5, duration: 0.4, pitch: 42, velocity: 50, voice: 'hat' },
        { beat: 4.5, duration: 0.4, pitch: 42, velocity: 55, voice: 'hat' },
        { beat: 5.5, duration: 0.4, pitch: 42, velocity: 50, voice: 'hat' },
        { beat: 6.5, duration: 0.4, pitch: 42, velocity: 55, voice: 'hat' },
        { beat: 7.5, duration: 0.4, pitch: 42, velocity: 50, voice: 'hat' },
        { beat: 0, duration: 2, pitch: 38, velocity: 90, voice: 'bass' },
        { beat: 2, duration: 2, pitch: 43, velocity: 85, voice: 'bass' },
        { beat: 4, duration: 2, pitch: 41, velocity: 85, voice: 'bass' },
        { beat: 6, duration: 2, pitch: 36, velocity: 85, voice: 'bass' },
        { beat: 0, duration: 2, pitch: 62, velocity: 75, voice: 'chord' },
        { beat: 2, duration: 2, pitch: 65, velocity: 75, voice: 'chord' },
        { beat: 4, duration: 2, pitch: 69, velocity: 75, voice: 'chord' },
        { beat: 6, duration: 2, pitch: 67, velocity: 75, voice: 'chord' },
    ],
};

const cinematic: TemplatePreview = {
    templateId: 'cinematic',
    bpm: 90,
    bars: 2,
    events: [
        { beat: 0, duration: 0.5, pitch: 38, velocity: 110, voice: 'kick' },
        { beat: 4, duration: 0.5, pitch: 38, velocity: 115, voice: 'kick' },
        { beat: 0, duration: 4, pitch: 62, velocity: 55, voice: 'pad' },
        { beat: 0, duration: 4, pitch: 69, velocity: 50, voice: 'pad' },
        { beat: 4, duration: 4, pitch: 65, velocity: 70, voice: 'pad' },
        { beat: 4, duration: 4, pitch: 72, velocity: 65, voice: 'pad' },
        { beat: 1, duration: 0.5, pitch: 74, velocity: 85, voice: 'lead' },
        { beat: 1.5, duration: 0.5, pitch: 77, velocity: 90, voice: 'lead' },
        { beat: 2, duration: 1, pitch: 81, velocity: 95, voice: 'lead' },
        { beat: 5, duration: 0.5, pitch: 77, velocity: 85, voice: 'lead' },
        { beat: 5.5, duration: 0.5, pitch: 74, velocity: 80, voice: 'lead' },
        { beat: 6, duration: 2, pitch: 69, velocity: 90, voice: 'lead' },
        { beat: 0, duration: 1, pitch: 26, velocity: 95, voice: 'bass' },
        { beat: 4, duration: 1, pitch: 24, velocity: 100, voice: 'bass' },
    ],
};

const podcast: TemplatePreview = {
    templateId: 'podcast',
    bpm: 100,
    bars: 2,
    events: [
        { beat: 0, duration: 0.5, pitch: 72, velocity: 85, voice: 'pluck' },
        { beat: 0.5, duration: 0.5, pitch: 76, velocity: 90, voice: 'pluck' },
        { beat: 1, duration: 2, pitch: 79, velocity: 95, voice: 'pluck' },
        { beat: 0, duration: 4, pitch: 48, velocity: 50, voice: 'pad' },
    ],
};

const singerSongwriter: TemplatePreview = {
    templateId: 'singer-songwriter',
    bpm: 90,
    bars: 2,
    events: [
        { beat: 0, duration: 0.5, pitch: 43, velocity: 85, voice: 'pluck' },
        { beat: 0.5, duration: 0.5, pitch: 55, velocity: 75, voice: 'pluck' },
        { beat: 1, duration: 0.5, pitch: 59, velocity: 80, voice: 'pluck' },
        { beat: 1.5, duration: 0.5, pitch: 62, velocity: 80, voice: 'pluck' },
        { beat: 2, duration: 0.5, pitch: 55, velocity: 75, voice: 'pluck' },
        { beat: 2.5, duration: 0.5, pitch: 59, velocity: 80, voice: 'pluck' },
        { beat: 3, duration: 0.5, pitch: 62, velocity: 85, voice: 'pluck' },
        { beat: 3.5, duration: 0.5, pitch: 67, velocity: 90, voice: 'pluck' },
        { beat: 4, duration: 0.5, pitch: 41, velocity: 85, voice: 'pluck' },
        { beat: 4.5, duration: 0.5, pitch: 53, velocity: 75, voice: 'pluck' },
        { beat: 5, duration: 0.5, pitch: 57, velocity: 80, voice: 'pluck' },
        { beat: 5.5, duration: 0.5, pitch: 60, velocity: 80, voice: 'pluck' },
        { beat: 6, duration: 0.5, pitch: 53, velocity: 75, voice: 'pluck' },
        { beat: 6.5, duration: 0.5, pitch: 57, velocity: 80, voice: 'pluck' },
        { beat: 7, duration: 1, pitch: 60, velocity: 85, voice: 'pluck' },
        { beat: 2, duration: 2, pitch: 74, velocity: 75, voice: 'lead' },
        { beat: 6, duration: 2, pitch: 72, velocity: 75, voice: 'lead' },
    ],
};

const ambient: TemplatePreview = {
    templateId: 'ambient',
    bpm: 60,
    bars: 2,
    events: [
        { beat: 0, duration: 8, pitch: 36, velocity: 70, voice: 'pad' },
        { beat: 0, duration: 8, pitch: 43, velocity: 60, voice: 'pad' },
        { beat: 0, duration: 8, pitch: 50, velocity: 55, voice: 'pad' },
        { beat: 0, duration: 4, pitch: 79, velocity: 75, voice: 'pluck' },
        { beat: 2, duration: 4, pitch: 83, velocity: 70, voice: 'pluck' },
        { beat: 4, duration: 4, pitch: 86, velocity: 65, voice: 'pluck' },
        { beat: 6, duration: 2, pitch: 81, velocity: 70, voice: 'pluck' },
    ],
};

const resonance: TemplatePreview = {
    templateId: 'demo-complete',
    bpm: 85,
    bars: 2,
    events: [
        { beat: 0, duration: 4, pitch: 38, velocity: 85, voice: 'bass' },
        { beat: 4, duration: 4, pitch: 43, velocity: 85, voice: 'bass' },
        { beat: 0, duration: 4, pitch: 62, velocity: 70, voice: 'chord' },
        { beat: 0, duration: 4, pitch: 65, velocity: 70, voice: 'chord' },
        { beat: 0, duration: 4, pitch: 69, velocity: 70, voice: 'chord' },
        { beat: 0, duration: 4, pitch: 72, velocity: 65, voice: 'chord' },
        { beat: 4, duration: 4, pitch: 67, velocity: 70, voice: 'chord' },
        { beat: 4, duration: 4, pitch: 70, velocity: 70, voice: 'chord' },
        { beat: 4, duration: 4, pitch: 74, velocity: 70, voice: 'chord' },
        { beat: 4, duration: 4, pitch: 77, velocity: 65, voice: 'chord' },
        { beat: 1, duration: 0.5, pitch: 74, velocity: 85, voice: 'pluck' },
        { beat: 2, duration: 0.5, pitch: 77, velocity: 80, voice: 'pluck' },
        { beat: 3, duration: 0.5, pitch: 81, velocity: 85, voice: 'pluck' },
        { beat: 5, duration: 0.5, pitch: 79, velocity: 85, voice: 'pluck' },
        { beat: 6, duration: 0.5, pitch: 82, velocity: 80, voice: 'pluck' },
        { beat: 7, duration: 0.5, pitch: 86, velocity: 90, voice: 'pluck' },
    ],
};

const nebulaDrift: TemplatePreview = {
    templateId: 'demo-nebula-drift',
    bpm: 95,
    bars: 2,
    events: [
        { beat: 0, duration: 8, pitch: 31, velocity: 75, voice: 'pad' },
        { beat: 0, duration: 8, pitch: 38, velocity: 65, voice: 'pad' },
        { beat: 0, duration: 0.5, pitch: 66, velocity: 95, voice: 'lead' },
        { beat: 0.5, duration: 0.5, pitch: 69, velocity: 90, voice: 'lead' },
        { beat: 1, duration: 0.5, pitch: 71, velocity: 95, voice: 'lead' },
        { beat: 1.5, duration: 0.5, pitch: 74, velocity: 100, voice: 'lead' },
        { beat: 2, duration: 1, pitch: 73, velocity: 95, voice: 'lead' },
        { beat: 3, duration: 1, pitch: 71, velocity: 90, voice: 'lead' },
        { beat: 4, duration: 0.5, pitch: 69, velocity: 90, voice: 'lead' },
        { beat: 4.5, duration: 0.5, pitch: 71, velocity: 90, voice: 'lead' },
        { beat: 5, duration: 0.5, pitch: 74, velocity: 95, voice: 'lead' },
        { beat: 5.5, duration: 0.5, pitch: 78, velocity: 100, voice: 'lead' },
        { beat: 6, duration: 2, pitch: 76, velocity: 95, voice: 'lead' },
        { beat: 0, duration: 1, pitch: 31, velocity: 95, voice: 'bass' },
        { beat: 2, duration: 1, pitch: 31, velocity: 90, voice: 'bass' },
        { beat: 4, duration: 1, pitch: 34, velocity: 95, voice: 'bass' },
        { beat: 6, duration: 1, pitch: 34, velocity: 90, voice: 'bass' },
    ],
};

export const previewLoops: Record<string, TemplatePreview> = {
    'pop-song': popSong,
    'hiphop-trap': hipHopTrap,
    edm,
    'rock-band': rockBand,
    lofi,
    cinematic,
    podcast,
    'singer-songwriter': singerSongwriter,
    ambient,
    'demo-complete': resonance,
    'demo-nebula-drift': nebulaDrift,
};

export function getPreviewLoop(templateId: string): TemplatePreview | null {
    return previewLoops[templateId] ?? null;
}
