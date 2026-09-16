/**
 * Read surface of the builtin LUFS meter (`builtin-lufs-meter`).
 *
 * The device measures continuously; the UI pulls a snapshot at animation rate
 * (see `getBuiltinLufsMeterReading`), never through pushed state.
 */

/** Descriptor choices for `lufs-window`, by index. */
export const BUILTIN_LUFS_METER_WINDOW_CHOICES = ['Momentary', 'Short-term', 'Integrated'] as const;

export type BuiltinLufsMeterWindow = 'momentary' | 'shortTerm' | 'integrated';

export type BuiltinLufsMeterReading = {
    /** Window the `lufs-window` parameter currently selects. */
    window: BuiltinLufsMeterWindow;
    /** Reading for the selected window, in LUFS. */
    value: number;
    momentary: number;
    shortTerm: number;
    integrated: number;
};

export type BuiltinLufsMeterReader = {
    /** Sample the analyser and return the current readings. */
    read: () => BuiltinLufsMeterReading;
    /** Select the measured window by the `lufs-window` parameter index. */
    setWindow: (windowIndex: number) => void;
    /** The window the `lufs-window` parameter currently selects. */
    window: () => BuiltinLufsMeterWindow;
};
