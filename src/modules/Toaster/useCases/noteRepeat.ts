/**
 * Note Repeat — hold a pad to retrigger at a tempo-synced rate.
 * MPC-style performance feature. Rate adjustable in real-time.
 */

export type NoteRepeatRate = '1/4' | '1/8' | '1/16' | '1/32' | '1/4t' | '1/8t' | '1/16t' | '1/32t';

export const NOTE_REPEAT_RATES: NoteRepeatRate[] = ['1/4', '1/8', '1/16', '1/32', '1/4t', '1/8t', '1/16t', '1/32t'];

export const NOTE_REPEAT_RATE_BEAT_FACTORS = {
    '1/4': 1,
    '1/8': 1 / 2,
    '1/16': 1 / 4,
    '1/32': 1 / 8,
    '1/4t': 2 / 3,
    '1/8t': 1 / 3,
    '1/16t': 1 / 6,
    '1/32t': 1 / 12,
} satisfies { [rate in NoteRepeatRate]: number };
