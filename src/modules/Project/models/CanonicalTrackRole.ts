/** Derived identity, never persisted in place of the production brief's freeform roles. */
export const CANONICAL_TRACK_ROLES = [
    'kick',
    'snare',
    'hi-hat',
    'tom',
    'cymbal',
    'percussion',
    'drums',
    'bass',
    'lead vocal',
    'backing vocal',
    'guitar',
    'keys',
    'synth',
    'pad',
    'fx',
    'bus',
    'master',
    'unknown',
] as const;

export type CanonicalTrackRole = (typeof CANONICAL_TRACK_ROLES)[number];
export type CanonicalTrackRoleProjection = {
    role: CanonicalTrackRole;
    source: 'authored' | 'name-tags' | 'clip-content' | 'unknown';
    evidence:
        | 'authored-role'
        | 'unsupported-authored-role'
        | 'conflicting-authored-roles'
        | 'structural-kind'
        | 'name-tokens'
        | 'conflicting-name-tags'
        | 'stored-drum-voices'
        | 'missing-instrument-metadata'
        | 'unmapped-drum-voice'
        | 'opaque-content'
        | 'empty-content';
    /** Bounded fingerprint of supplied content, never notes or media in a query receipt. */
    contentRevision?: string;
};
