/**
 * Immutable main-thread-to-worklet control protocol for device controls that
 * cannot use a native AudioParam. This is runtime state, not project truth.
 */
export type RuntimeDeviceControl = Readonly<{
    schemaVersion: 1;
    command: 'set-fallback-param';
    target: Readonly<{
        trackId: string;
        deviceId: string;
        deviceType: string;
        parameterId: string;
    }>;
    value: number;
    correlation: Readonly<{
        workletGeneration: number;
        controlSequence: number;
    }>;
    scheduling: Readonly<{
        targetFrame: number | null;
        deadlineFrame: number | null;
    }>;
}>;

export type RuntimeDeviceControlInitialization = Readonly<{
    schemaVersion: 1;
    command: 'initialize-fallback-control';
    target: RuntimeDeviceControlTarget;
    correlation: Readonly<{
        workletGeneration: number;
    }>;
}>;

export type RuntimeDeviceControlCompilation =
    Readonly<{ status: 'compiled'; control: RuntimeDeviceControl }> | Readonly<{ status: 'invalid'; reason: string }>;

export type RuntimeDeviceControlTarget = Readonly<{
    trackId: string;
    deviceId: string;
    deviceType: string;
    parameterIds: readonly string[];
}>;
