import { automationTimeStateCodec } from './automationTimeStateCodec';

/** Validate persisted owner syntax without consulting the current automation store. */
export function isValidAutomationTimeStateRestorePlan(value: unknown): boolean {
    try {
        return automationTimeStateCodec.decodeRestorePlan(value) !== null;
    } catch {
        return false;
    }
}
