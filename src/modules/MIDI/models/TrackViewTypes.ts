/**
 * MIDI-local view shape of Arrangement's Clip model (AGENTS.md §95 — model
 * isolation). MIDI writes clip objects for MIDI imports and pattern
 * instances; it duplicates only the fields it populates.
 */

export type StretchMode = 'off' | 'repitch' | 'timestretch';

export type Clip = {
    id: string;
    trackId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    type: 'audio' | 'midi';
    audioBufferId?: string;
    assetHash?: string;
    audioOffsetBeats?: number;
    midiOffsetBeats?: number;
    fadeInBeats: number;
    fadeOutBeats: number;
    gain: number;
    color: string;
    locked: boolean;
    muted: boolean;
    stretchMode?: StretchMode;
    stretchRatio?: number;
    loopEnabled?: boolean;
    loopLength?: number;
    generating?: boolean;
    isGhost?: boolean;
    parentClipId?: string;
    overrides?: Record<string, boolean>;
};
