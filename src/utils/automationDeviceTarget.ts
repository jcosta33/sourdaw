type DeviceAutomationCandidate = { deviceId: string; deviceType: string } | { id: string; type: string };

export const NO_DEVICE_AUTOMATION_TARGET = -1,
    UNRESOLVED_DEVICE_AUTOMATION_TARGET = -2;

function getCandidateId(candidate: DeviceAutomationCandidate): string {
    return 'deviceId' in candidate ? candidate.deviceId : candidate.id;
}

function getCandidateType(candidate: DeviceAutomationCandidate): string {
    return 'deviceType' in candidate ? candidate.deviceType : candidate.type;
}

export function createDeviceAutomationTargetId(deviceId: string, parameterId: string): string {
    return `${deviceId}:${parameterId}`;
}

export function getDeviceAutomationParameterId(targetId: string): string | null {
    const separatorIndex = targetId.indexOf(':');
    const parameterId = separatorIndex < 0 ? targetId : targetId.slice(separatorIndex + 1);
    return parameterId.length > 0 ? parameterId : null;
}

export function resolveDeviceAutomationTargetIndex<Candidate extends DeviceAutomationCandidate>(
    targetId: string,
    candidates: readonly Candidate[],
    acceptsParameter: (candidate: Candidate, parameterId: string) => boolean
): number {
    const separatorIndex = targetId.indexOf(':');
    const parameterId = getDeviceAutomationParameterId(targetId);
    if (!parameterId) {
        return UNRESOLVED_DEVICE_AUTOMATION_TARGET;
    }
    if (separatorIndex >= 0) {
        const ownerId = targetId.slice(0, separatorIndex);
        if (ownerId.length === 0) {
            return UNRESOLVED_DEVICE_AUTOMATION_TARGET;
        }

        let canonicalIndex = NO_DEVICE_AUTOMATION_TARGET;
        let legacyIndex = NO_DEVICE_AUTOMATION_TARGET;
        for (let index = 0; index < candidates.length; index++) {
            const candidate = candidates[index]!;
            if (getCandidateId(candidate) === ownerId) {
                if (canonicalIndex >= 0) {
                    return UNRESOLVED_DEVICE_AUTOMATION_TARGET;
                }
                canonicalIndex = index;
            }
            if (getCandidateType(candidate) === ownerId) {
                legacyIndex = legacyIndex === NO_DEVICE_AUTOMATION_TARGET ? index : UNRESOLVED_DEVICE_AUTOMATION_TARGET;
            }
        }
        const targetIndex = canonicalIndex >= 0 ? canonicalIndex : legacyIndex;
        if (targetIndex < 0 || !acceptsParameter(candidates[targetIndex]!, parameterId)) {
            return UNRESOLVED_DEVICE_AUTOMATION_TARGET;
        }
        return targetIndex;
    }

    let legacyIndex = NO_DEVICE_AUTOMATION_TARGET;
    for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index]!;
        if (acceptsParameter(candidate, parameterId)) {
            if (legacyIndex >= 0) {
                return UNRESOLVED_DEVICE_AUTOMATION_TARGET;
            }
            legacyIndex = index;
        }
    }
    return legacyIndex;
}
