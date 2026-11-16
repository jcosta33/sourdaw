import { takeNextObservationSequence } from '#/infra/ordering/observationSequence';

import { appliedAutomationWriteSequences } from './appliedAutomationBases';

export function recordAppliedAutomationWrite(deviceId: string, parameterId: string): void {
    let byParameter = appliedAutomationWriteSequences.get(deviceId);
    if (!byParameter) {
        byParameter = new Map<string, number>();
        appliedAutomationWriteSequences.set(deviceId, byParameter);
    }
    byParameter.set(parameterId, takeNextObservationSequence());
}
