export type ProofChamberAlgorithm = 'Dattorro Plate' | 'FDN Room' | 'Spring' | 'Convolution';

export interface ProofChamberEngineState {
    algorithm: ProofChamberAlgorithm;
    
    // Level 1 Parameters
    mix: number; // 0.0 - 1.0
    size: number; // 0.0 - 1.0 (abstract dial scaling decay & mod)
    decaySeconds: number; // 0.1s to 30.0s
    
    // Level 2 Parameters (Shape)
    preDelayMs: number; // 0 - 500ms
    diffusion: number; // 0.0 - 1.0
    modulationRateHz: number; // 0.1 - 5.0
    modulationDepth: number; // 0.0 - 1.0
    bandwidth: number; // 0.0 - 0.999999
    damping: number; // 0.0 - 0.999999
}

export interface ProofChamberPluginState {
    id: string;
    engineState: ProofChamberEngineState;
    uiLevel: 1 | 2 | 3 | 4 | 5; // Progressive disclosure level
    isBypassed: boolean;
}

export function createDefaultChamberState(id: string): ProofChamberPluginState {
    return {
        id,
        isBypassed: false,
        uiLevel: 1,
        engineState: {
            algorithm: 'Dattorro Plate',
            mix: 0.25,
            size: 0.5,
            decaySeconds: 1.8,
            preDelayMs: 15.0,
            diffusion: 0.75,
            modulationRateHz: 1.0,
            modulationDepth: 0.3,
            bandwidth: 0.9995,
            damping: 0.0005,
        }
    };
}
