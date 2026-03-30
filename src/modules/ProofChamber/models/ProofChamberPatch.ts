/**
 * Dutch Oven reverb parameter types and space presets.
 */

export type AlgorithmType = 'plate' | 'fdn-8' | 'fdn-16' | 'spring';

export type SpaceType = 'hall' | 'room' | 'plate' | 'chamber' | 'cathedral' | 'shimmer' | 'infinite' | 'spring';

export type ProofChamberParams = {
    algorithm: AlgorithmType;
    space: SpaceType;
    mix: number;
    decay: number;
    damping: number;
    predelay: number;
    size: number;
    modRate: number;
    modDepth: number;
    diffusion: number;
    highCut: number;
    lowCut: number;
    width: number;
    freeze: boolean;
    shimmer: boolean;
    shimmerAmount: number;
    shimmerPitch: number; // 0=fifth, 1=octave
    gravity: number;
    saturation: boolean;
    earlyLateBalance: number;
    vintage: number; // 0=modern, 1=80s, 2=70s
};

export const DEFAULT_PARAMS: ProofChamberParams = {
    algorithm: 'plate',
    space: 'hall',
    mix: 0.3,
    decay: 0.5,
    damping: 0.3,
    predelay: 15,
    size: 0.75,
    modRate: 1.0,
    modDepth: 0.3,
    diffusion: 0.75,
    highCut: 12000,
    lowCut: 80,
    width: 1.0,
    freeze: false,
    shimmer: false,
    shimmerAmount: 0.2,
    shimmerPitch: 1,
    gravity: 0.5,
    saturation: false,
    earlyLateBalance: 0.4,
    vintage: 0,
};

export const ALGORITHM_MAP: Record<AlgorithmType, number> = {
    plate: 0,
    'fdn-8': 1,
    'fdn-16': 2,
    spring: 3,
};

export const SPACE_PRESETS: Record<SpaceType, Partial<ProofChamberParams>> = {
    hall: { size: 0.75, decay: 0.7, damping: 0.3, diffusion: 0.75, modDepth: 0.3, predelay: 20 },
    room: { size: 0.35, decay: 0.4, damping: 0.5, diffusion: 0.6, modDepth: 0.2, predelay: 5 },
    plate: { size: 0.5, decay: 0.6, damping: 0.15, diffusion: 0.85, modDepth: 0.5, predelay: 0 },
    chamber: { size: 0.45, decay: 0.5, damping: 0.4, diffusion: 0.7, modDepth: 0.25, predelay: 10 },
    cathedral: { size: 1.0, decay: 0.85, damping: 0.2, diffusion: 0.9, modDepth: 0.4, predelay: 40 },
    shimmer: {
        size: 0.8,
        decay: 0.75,
        damping: 0.1,
        diffusion: 0.8,
        modDepth: 0.5,
        shimmer: true,
        shimmerAmount: 0.3,
        predelay: 25,
    },
    infinite: { size: 0.6, decay: 0.999, damping: 0.0, diffusion: 0.75, modDepth: 0.0, freeze: true, predelay: 0 },
    spring: {
        algorithm: 'spring' as AlgorithmType,
        size: 0.5,
        decay: 0.7,
        damping: 0.3,
        diffusion: 0.5,
        modDepth: 0.3,
        predelay: 0,
    },
};

/** Map UI param name to Rust engine param name */
export const PARAM_MAP: Record<string, string> = {
    mix: 'mix',
    decay: 'decay',
    damping: 'damping',
    predelay: 'predelay',
    size: 'size',
    modRate: 'mod_rate',
    modDepth: 'mod_depth',
    diffusion: 'diffusion',
    highCut: 'high_cut',
    lowCut: 'low_cut',
    width: 'width',
    freeze: 'freeze',
    shimmer: 'shimmer',
    shimmerAmount: 'shimmer_amount',
    shimmerPitch: 'shimmer_pitch',
    gravity: 'gravity',
    saturation: 'saturation',
    earlyLateBalance: 'early_late',
    algorithm: 'algorithm',
    vintage: 'vintage',
};
