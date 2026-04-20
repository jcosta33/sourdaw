export type ProofAudioBridge = {
    setParam: (name: string, value: number) => void;
    reorderModules: (order: [number, number, number, number, number]) => void;
    resetIntegrated: () => void;
};

export const bridges = new Map<string, ProofAudioBridge>();
