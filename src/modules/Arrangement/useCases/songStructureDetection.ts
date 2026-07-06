/** Standard song section names with associated colors */
export const SECTION_PALETTE = [
    { name: 'Intro', color: 'oklch(0.42 0.10 200)' },
    { name: 'Verse', color: 'oklch(0.40 0.10 140)' },
    { name: 'Pre-Chorus', color: 'oklch(0.42 0.10 60)' },
    { name: 'Chorus', color: 'oklch(0.45 0.12 330)' },
    { name: 'Bridge', color: 'oklch(0.40 0.10 280)' },
    { name: 'Outro', color: 'oklch(0.38 0.08 200)' },
    { name: 'Break', color: 'oklch(0.35 0.07 100)' },
    { name: 'Drop', color: 'oklch(0.45 0.14 20)' },
    { name: 'Build', color: 'oklch(0.42 0.12 40)' },
    { name: 'Solo', color: 'oklch(0.45 0.12 90)' },
] as const;

export type DetectedSection = {
    startBeat: number;
    endBeat: number;
    name: string;
    color: string;
    confidence: number;
};
