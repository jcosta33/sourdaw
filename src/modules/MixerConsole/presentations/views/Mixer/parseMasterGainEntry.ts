import { dbToGain, FADER_HEADROOM_DB } from '#/utils/audioLevelLaw';

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
    const db = Number(match[1]);
    if (!Number.isFinite(db) || db > FADER_HEADROOM_DB) {
        return null;
    }
    return dbToGain(db);
}
