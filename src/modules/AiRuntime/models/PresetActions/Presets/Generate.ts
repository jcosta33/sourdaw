import { type PresetAction } from './Types';

export const generatePresets: readonly PresetAction[] = [
    // ─── Drum patterns ──────────────────────────────────────────────────
    {
        id: 'gen-drum-rock',
        label: 'Generate Rock Drums',
        keywords: ['rock drums', 'rock beat', 'rock pattern'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateDrumPattern',
            payload: { style: 'rock', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-drum-4floor',
        label: 'Generate Four-on-Floor',
        keywords: ['four on floor', 'four on the floor', 'house beat', 'disco'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateDrumPattern',
            payload: { style: 'four-on-floor', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-drum-trap',
        label: 'Generate Trap Beat',
        keywords: ['trap drums', 'trap beat', 'trap pattern', '808'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateDrumPattern',
            payload: { style: 'trap', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-drum-jazz',
        label: 'Generate Jazz Drums',
        keywords: ['jazz drums', 'jazz beat', 'jazz pattern', 'bebop'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateDrumPattern',
            payload: { style: 'jazz', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-drum-dnb',
        label: 'Generate DnB Beat',
        keywords: ['dnb', 'drum and bass', 'jungle', 'breakbeat'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateDrumPattern',
            payload: { style: 'dnb', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-drum-latin',
        label: 'Generate Latin Drums',
        keywords: ['latin drums', 'bossa', 'samba', 'clave'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateDrumPattern',
            payload: { style: 'latin', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-drum-halftime',
        label: 'Generate Half-Time Beat',
        keywords: ['half time', 'halftime', 'half-time'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateDrumPattern',
            payload: { style: 'half-time', trackId: ctx.selectedTrackId },
        }),
    },

    // ─── Melody ─────────────────────────────────────────────────────────
    {
        id: 'gen-melody',
        label: 'Generate Melody',
        keywords: ['generate melody', 'create melody', 'random melody'],
        category: 'Generate',
        buildAction: (ctx) => ({ type: 'generateMelody', payload: { style: 'simple', trackId: ctx.selectedTrackId } }),
    },
    {
        id: 'gen-melody-arp',
        label: 'Generate Arpeggiated Melody',
        keywords: ['arpeggiated melody', 'arp melody'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateMelody',
            payload: { style: 'arpeggiated', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-melody-ambient',
        label: 'Generate Ambient Melody',
        keywords: ['ambient melody', 'pad melody', 'atmospheric'],
        category: 'Generate',
        buildAction: (ctx) => ({ type: 'generateMelody', payload: { style: 'ambient', trackId: ctx.selectedTrackId } }),
    },

    // ─── Chord progressions ─────────────────────────────────────────────
    {
        id: 'gen-chords-pop',
        label: 'Generate Pop Chords',
        keywords: ['pop chords', 'chord progression', 'pop progression'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateChordProgression',
            payload: { style: 'pop', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-chords-jazz',
        label: 'Generate Jazz Chords',
        keywords: ['jazz chords', 'jazz progression', '7th chords'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateChordProgression',
            payload: { style: 'jazz', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-chords-edm',
        label: 'Generate EDM Chords',
        keywords: ['edm chords', 'edm progression', 'trance chords'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateChordProgression',
            payload: { style: 'edm', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-chords-cinematic',
        label: 'Generate Cinematic Chords',
        keywords: ['cinematic chords', 'epic chords', 'film chords', 'orchestral'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateChordProgression',
            payload: { style: 'cinematic', trackId: ctx.selectedTrackId },
        }),
    },
    {
        id: 'gen-chords-blues',
        label: 'Generate Blues Chords',
        keywords: ['blues chords', 'blues progression', '12 bar blues'],
        category: 'Generate',
        buildAction: (ctx) => ({
            type: 'generateChordProgression',
            payload: { style: 'blues', trackId: ctx.selectedTrackId },
        }),
    },
];
