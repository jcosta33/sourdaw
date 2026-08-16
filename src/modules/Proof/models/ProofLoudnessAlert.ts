/**
 * Loudness-normalization warning copy for the Proof panel.
 *
 * One source for both alert sites (Play desk and Lab bench) so the panel cannot
 * tell a user two different stories about the same master.
 */
import { TARGET_LABELS, type ProofTarget } from './ProofPatch';

/**
 * Loudness every mainstream music streaming service normalizes playback to.
 * Spotify, YouTube, Amazon and Tidal all sit at -14 LUFS; Apple Music is one
 * of the few outliers at -16. This is what "streaming will turn it down"
 * actually measures against — never the user's chosen delivery target, which
 * for CD, club or a custom value no platform has ever heard of.
 */
export const STREAMING_NORMALIZATION_LUFS = -14;

/** Loudness the podcast platforms normalize speech programmes to. */
const PODCAST_NORMALIZATION_LUFS = -16;

/** EBU R128 programme loudness for broadcast delivery. */
const BROADCAST_NORMALIZATION_LUFS = -23;

type TargetNormalization = {
    /** Loudness the platform normalizes to. */
    lufs: number;
    /** Where that normalization happens, as it reads in the sentence. */
    clause: string;
};

/**
 * Exhaustive, because the panel used to fall back to the raw target id and
 * announced "turned down ... on cd" and "on custom" — naming things that
 * normalize nothing as loudness-normalizing platforms. A target with no entry
 * gets no platform clause at all.
 */
const TARGET_NORMALIZATION: Record<ProofTarget, TargetNormalization | null> = {
    streaming: { lufs: STREAMING_NORMALIZATION_LUFS, clause: 'on streaming platforms' },
    podcast: { lufs: PODCAST_NORMALIZATION_LUFS, clause: 'on podcast platforms' },
    broadcast: { lufs: BROADCAST_NORMALIZATION_LUFS, clause: 'for EBU R128 broadcast delivery' },
    cd: null,
    club: null,
    custom: null,
};

type GetProofLoudnessAlertInput = {
    target: ProofTarget;
    targetLufs: number;
    integratedLufs: number;
};

export type ProofLoudnessAlert = {
    /** The complete warning. Stands alone, and is what the Play desk shows. */
    message: string;
    /** The follow-up the Lab bench appends to the warning. */
    advice: string;
};

/** Integrated loudness this far above the target is worth warning about. */
const ALERT_TOLERANCE_LU = 1;

/** Below this the reported turn-down would round to 0.0 dB and say nothing. */
const REPORTABLE_TURN_DOWN_DB = 0.05;

/**
 * The warning for a master that overshoots its target, or `null` when it does
 * not. `integratedLufs` at or below -100 means the integrated measurement has
 * not started yet, which is not an overshoot.
 */
export function getProofLoudnessAlert({
    target,
    targetLufs,
    integratedLufs,
}: GetProofLoudnessAlertInput): ProofLoudnessAlert | null {
    if (integratedLufs <= -100 || integratedLufs <= targetLufs + ALERT_TOLERANCE_LU) {
        return null;
    }

    const master = `Your master at ${integratedLufs.toFixed(1)} LUFS`;
    const advice = `Consider targeting ${targetLufs} LUFS.`;
    const normalization = TARGET_NORMALIZATION[target];
    const turnDown = normalization === null ? 0 : integratedLufs - normalization.lufs;

    if (normalization !== null && turnDown >= REPORTABLE_TURN_DOWN_DB) {
        return {
            message: `${master} will be turned down by ${turnDown.toFixed(1)} dB ${normalization.clause}.`,
            advice,
        };
    }

    // Nothing normalizes this target, so the honest statement is the overshoot
    // against the target the user actually chose. Streaming still normalizes
    // whatever gets uploaded there, so say so separately when it applies.
    const overshoot = `${master} is ${(integratedLufs - targetLufs).toFixed(1)} dB above your ${TARGET_LABELS[target]} target, which no platform normalizes.`;
    const streamingTurnDown = integratedLufs - STREAMING_NORMALIZATION_LUFS;
    if (streamingTurnDown < REPORTABLE_TURN_DOWN_DB) {
        return { message: overshoot, advice };
    }

    return {
        message: `${overshoot} Streaming platforms would still turn it down by ${streamingTurnDown.toFixed(1)} dB.`,
        advice,
    };
}
