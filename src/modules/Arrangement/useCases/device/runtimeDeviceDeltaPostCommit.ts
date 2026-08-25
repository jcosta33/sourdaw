import {
    type ApplyDeviceChainRuntimeDeltaResult,
    type DeviceChainRuntimeDeltaDischarged,
    type DeviceChainRuntimeDeltaSuperseded,
} from './applyDeviceChainRuntimeDelta';

type DeviceChainRuntimeDeltaWithoutFailure = DeviceChainRuntimeDeltaSuperseded | DeviceChainRuntimeDeltaDischarged;

/**
 * Every device-chain outcome that still owes the caller runtime work.
 *
 * `superseded` is excluded deliberately. Neither a void removed-host delta nor
 * an exact live-chain discharge is a failure. The type refuses both so callers
 * must decide whether their remaining parameter/plugin obligations still run
 * before asking whether the topology step failed.
 */
export type RuntimeDeviceDeltaFailure = Exclude<
    ApplyDeviceChainRuntimeDeltaResult,
    Readonly<{ acceptance: 'accepted'; application: 'applied' }> | DeviceChainRuntimeDeltaWithoutFailure
>;

type RuntimeDeltaSubject = 'Device' | 'Preset';

export class RuntimeDeviceDeltaPostCommitError extends Error {
    public readonly outcome: RuntimeDeviceDeltaFailure;
    public readonly pendingEffect: Readonly<{
        kind: 'runtime-graph';
        reason: string;
        remediation: 'retry' | 'repair';
        state: 'pending';
    }>;
    public readonly remediation: 'retry' | 'repair';

    constructor(outcome: RuntimeDeviceDeltaFailure, subject: RuntimeDeltaSubject = 'Device') {
        const remediation = outcome.acceptance === 'rejected' ? 'retry' : 'repair';
        super(
            outcome.acceptance === 'rejected'
                ? `${subject} runtime delta was rejected after project commit and requires ${remediation}: ${outcome.reason}`
                : `${subject} runtime delta requires ${remediation} after project commit: ${outcome.reason}`
        );
        this.name = subject === 'Preset' ? 'RuntimePresetDeltaPostCommitError' : 'RuntimeDeviceDeltaPostCommitError';
        this.outcome = outcome;
        this.remediation = remediation;
        this.pendingEffect = Object.freeze({
            kind: 'runtime-graph',
            reason: outcome.reason,
            remediation,
            state: 'pending',
        });
    }
}

/**
 * The repair this outcome demands, or `undefined` when the delta landed.
 *
 * Callers must resolve `superseded` before reaching here; the parameter type
 * enforces it.
 */
export function getRuntimeDeviceDeltaPostCommitFailure(
    result: Exclude<ApplyDeviceChainRuntimeDeltaResult, DeviceChainRuntimeDeltaWithoutFailure>,
    subject: RuntimeDeltaSubject = 'Device'
): RuntimeDeviceDeltaPostCommitError | undefined {
    if (result.acceptance === 'accepted' && result.application === 'applied') {
        return undefined;
    }
    return new RuntimeDeviceDeltaPostCommitError(result, subject);
}
