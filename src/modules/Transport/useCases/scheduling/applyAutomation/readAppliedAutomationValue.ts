import { appliedAutomationBases } from './appliedAutomationBases';

/**
 * The value the live automation pass delivered for a device parameter on the latest scheduler tick,
 * or `undefined` when no lane drove it that tick. A read for display; nothing may write through it.
 */
export function readAppliedAutomationValue(deviceId: string, parameterId: string): number | undefined {
    return appliedAutomationBases.get(deviceId)?.get(parameterId);
}
