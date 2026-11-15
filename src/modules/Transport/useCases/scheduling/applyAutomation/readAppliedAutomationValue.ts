import {
    appliedAutomationBases,
    appliedAutomationWriteSequences,
    readLastAutomationWriteSequence,
} from './appliedAutomationBases';

type AppliedAutomationValue = {
    value: number;
    /** Changes whenever the scheduler writes the parameter, including a write of an unchanged value. */
    writeSequence: number;
};

/**
 * The value the live automation pass delivered for a device parameter on the latest scheduler tick,
 * with the sequence of the scheduler's latest write to it, or `undefined` when no lane drove it that
 * tick. A read for display; nothing may write through it.
 */
export function readAppliedAutomationValue(deviceId: string, parameterId: string): AppliedAutomationValue | undefined {
    const value = appliedAutomationBases.get(deviceId)?.get(parameterId);
    if (value === undefined) {
        return undefined;
    }
    return {
        value,
        writeSequence: appliedAutomationWriteSequences.get(deviceId)?.get(parameterId) ?? 0,
    };
}

/**
 * The sequence of the scheduler's latest write to any device parameter. Every later write numbers above
 * it, so a caller that records it when it starts slow work can tell whether a write came after.
 */
export function readLatestAutomationWriteSequence(): number {
    return readLastAutomationWriteSequence();
}
