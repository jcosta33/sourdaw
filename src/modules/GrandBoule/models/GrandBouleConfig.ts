/**
 * Plain configuration values for the Grand Boule piano plugin.
 * These are serializable project-state values — no runtime handles.
 */

export type GrandBouleConfig = {
    /** Master output gain (0.0 – 2.0, 1.0 = unity). */
    masterGain: number;
    /** Currently loaded preset id, or null if default. */
    activePresetId: string | null;
    /** Soundboard send amount (0.0 – 1.0). */
    soundboardSend: number;
    /** Sympathetic-resonance send amount (0.0 – 1.0). */
    sympatheticSend: number;
    /** Grand-piano lid position (0.0 closed – 1.0 fully open). */
    lidPosition: number;
    /** Radiation perspective: 0 close, 1 player, 2 room. */
    micPosition: number;
    /** Whether the hybrid sampled-attack pathway is active. */
    sampledAttackEnabled: boolean;
    /**
     * Stretched-tuning amount (0.0 – 2.0). Scales the smooth Steinway D
     * Railsback curve baked into the engine. 0 = equal temperament (with
     * per-note jitter still applied), 1 = the full project curve, and
     * 2 = exaggerated stretch. The curve uses Jaatinen & Pätynen 2022 anchors.
     */
    stretchAmount: number;
    /**
     * Attack bite (0.0 – 2.0). Velocity multiplier for the longitudinal
     * "string precursor" noise burst that gives the attack its bright chirp.
     * 0 = no bite, 1 = neutral, and 2 = exaggerated.
     */
    attackBite: number;
};

export function createDefaultGrandBouleConfig(): GrandBouleConfig {
    return {
        masterGain: 0.7,
        activePresetId: null,
        soundboardSend: 0.6,
        sympatheticSend: 0.25,
        lidPosition: 1.0,
        micPosition: 1,
        sampledAttackEnabled: false,
        stretchAmount: 1.0,
        attackBite: 1.0,
    };
}
