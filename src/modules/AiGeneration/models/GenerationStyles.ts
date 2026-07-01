/**
 * Shared generation-style type unions.
 *
 * These unions are the single source of truth for the melody / chord /
 * drum style identifiers accepted by `AiGeneration` algorithm implementations.
 */

export type MelodyStyle = 'simple' | 'arpeggiated' | 'stepwise' | 'rhythmic' | 'ambient';

export type ScaleType =
    | 'major'
    | 'minor'
    | 'pentatonic'
    | 'minor-pentatonic'
    | 'blues'
    | 'dorian'
    | 'mixolydian'
    | 'lydian'
    | 'phrygian'
    | 'locrian'
    | 'harmonic-minor'
    | 'melodic-minor'
    | 'whole-tone'
    | 'chromatic';

export type ChordProgressionStyle =
    | 'pop'
    | 'jazz'
    | 'classical'
    | 'edm'
    | 'blues'
    | 'rnb'
    | 'folk'
    | 'cinematic'
    | 'neo-soul'
    | 'gospel'
    | 'rock'
    | 'lofi';

export type ChordVoicing = 'close' | 'open' | 'spread' | 'power';

export type DrumPatternStyle =
    | 'four-on-floor'
    | 'breakbeat'
    | 'trap'
    | 'jazz'
    | 'latin'
    | 'rock'
    | 'dnb'
    | 'half-time'
    | 'blues'
    | 'reggae'
    | 'lofi'
    | 'house'
    | 'techno'
    | 'synthwave'
    | 'afrobeat'
    | 'metal'
    | 'punk';
