// Domain acronyms that must survive camelCase→words humanization with their
// canonical casing instead of being lower-cased ("midi" → "MIDI"). Keyed by
// the lower-cased token the splitter produces.
const ACRONYMS: Record<string, string> = {
    midi: 'MIDI',
    mpe: 'MPE',
    vca: 'VCA',
    cv: 'CV',
    rave: 'RAVE',
    crdt: 'CRDT',
    daw: 'DAW',
    cc: 'CC',
    ai: 'AI',
    bpm: 'BPM',
};

/**
 * Humanize a camelCase action type into a sentence-case label. This is the
 * total fallback used for any action type not in `ACTION_LABELS`, so that the
 * UI never displays a raw enum string (e.g. `setMasterGain` → "Set master
 * gain", `freezeTrack` → "Freeze track", `audioToMidi` → "Audio to MIDI").
 */
export function humanizeActionType(type: string): string {
    // Split camelCase / PascalCase into tokens; also split letter↔digit runs
    // (e.g. `duplicateClipToNextBar`, `setRaveBlend`).
    const tokens = type
        .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replaceAll(/([A-Za-z])([0-9])/g, '$1 $2')
        .replaceAll(/([0-9])([A-Za-z])/g, '$1 $2')
        .split(/\s+/)
        .filter((token) => token.length > 0);
    if (tokens.length === 0) {
        return type;
    }
    const words = tokens.map((token, index) => {
        const lower = token.toLowerCase();
        const acronym = ACRONYMS[lower];
        if (acronym) {
            return acronym;
        }
        if (index === 0) {
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        }
        return lower;
    });
    return words.join(' ');
}
