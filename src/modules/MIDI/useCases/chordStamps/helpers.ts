export const CHORD_TYPES = {
    major: [0, 4, 7],
    minor: [0, 3, 7],
    dim: [0, 3, 6],
    aug: [0, 4, 8],
    sus2: [0, 2, 7],
    sus4: [0, 5, 7],
    '7': [0, 4, 7, 10],
    maj7: [0, 4, 7, 11],
    min7: [0, 3, 7, 10],
    dim7: [0, 3, 6, 9],
    aug7: [0, 4, 8, 10],
    '6': [0, 4, 7, 9],
    min6: [0, 3, 7, 9],
    '9': [0, 4, 7, 10, 14],
    add9: [0, 4, 7, 14],
    min9: [0, 3, 7, 10, 14],
    '7sus4': [0, 5, 7, 10],
} as const;

export type ChordType = keyof typeof CHORD_TYPES;