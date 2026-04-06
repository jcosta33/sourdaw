/**
 * Plain configuration values for the Grand Boule piano plugin.
 * These are serializable project-state values — no runtime handles.
 */

export type GrandBoulePolyphonyTier = 'wasm' | 'native' | 'native-hq';

export type GrandBouleConfig = {
    /** Master output gain (0.0 – 2.0, 1.0 = unity). */
    masterGain: number;
    /** Maximum simultaneous voices. Capped by the engine at construction time. */
    voiceCount: number;
    /** Quality tier — selects voice budget and oversampling factors. */
    polyphonyTier: GrandBoulePolyphonyTier;
    /** Currently loaded preset id, or null if default. */
    activePresetId: string | null;
    /** Soundboard send amount (0.0 – 1.0). */
    soundboardSend: number;
    /** Sympathetic-resonance send amount (0.0 – 1.0). */
    sympatheticSend: number;
    /** Whether the hybrid sampled-attack pathway is active. */
    sampledAttackEnabled: boolean;
};

export const createDefaultGrandBouleConfig = (): GrandBouleConfig => ({
    masterGain: 0.7,
    voiceCount: 32,
    polyphonyTier: 'wasm',
    activePresetId: null,
    soundboardSend: 0.6,
    sympatheticSend: 0.25,
    sampledAttackEnabled: false,
});
