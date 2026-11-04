import { resolveLevelArgument, TRACK_FADER_LAW } from '#/utils/audioLevelLaw';

/** Interprets one entered master-fader level as a linear gain. */
export function parseMasterGainEntry(input: string): number | null {
    const text = input.trim();
    if (/^-(?:inf|infinity|∞)(?:\s*dB)?$/iu.test(text)) {
        return 0;
    }
    const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:\s*dB)?$/iu.exec(text);
    if (!match) {
        return null;
    }
    const result = resolveLevelArgument({ absoluteDb: Number(match[1]) }, 0, TRACK_FADER_LAW);
    return result.ok ? result.linear : null;
}
