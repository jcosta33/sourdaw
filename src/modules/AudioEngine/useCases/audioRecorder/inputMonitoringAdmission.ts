import { createHmrPersistentState } from '#/utils/HMR/createHmrPersistentState';

export type ReadIntent = () => {
    inputId: string | null;
    inputMonitoring: 'auto' | 'on';
    canAttach?: boolean;
} | null;
export type Admission = {
    selectorInputId: string | null;
    captureInputId: string | null;
    readIntent: ReadIntent;
    captureRetired?: true;
};

// Retain the authority reader, not a project snapshot, when a selected input changes.
export const inputMonitoringAdmissions = createHmrPersistentState<Map<string, Admission>>(
    'audioEngine.inputMonitoringIntents.v1',
    () => new Map()
);
