/**
 * Immutable main-thread-to-worklet neural-state protocol for Grinder.
 * Runtime state only; Grinder remains the owner of project patch truth.
 */
export type RuntimeGrinderNeuralPatch = Readonly<{
    schemaVersion: 1;
    command: 'apply-grinder-neural-patch';
    target: Readonly<{
        trackId: string;
        deviceId: string;
        deviceType: 'grinder';
    }>;
    patch: RuntimeGrinderNeuralPatchPayload;
    correlation: Readonly<{
        workletGeneration: number;
        controlSequence: number;
    }>;
    scheduling: Readonly<{
        targetFrame: null;
        deadlineFrame: null;
    }>;
}>;

export type RuntimeGrinderNeuralPatchPayload =
    | Readonly<{ neuralModelMode: 'builtin' }>
    | Readonly<{
          neuralModelMode: 'imported';
          profile: Readonly<{
              preferredTier: 'standard' | 'lite' | 'nano' | 'recurrent';
              inputDrive: number | null;
              asymmetry: number | null;
              outputTrim: number | null;
              contourMix: number | null;
              recurrentBias: number | null;
              convWeights: readonly (readonly [number, number, number])[];
          }>;
      }>;

export type RuntimeGrinderNeuralPatchCompilation =
    | Readonly<{ status: 'compiled'; patch: RuntimeGrinderNeuralPatch }>
    | Readonly<{ status: 'invalid'; reason: string }>;
