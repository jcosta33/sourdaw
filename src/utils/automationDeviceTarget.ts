type DeviceAutomationCandidate = { deviceId: string; deviceType: string } | { id: string; type: string };

export const NO_DEVICE_AUTOMATION_TARGET = -1;
export const UNRESOLVED_DEVICE_AUTOMATION_TARGET = -2;

function getCandidateId(candidate: DeviceAutomationCandidate): string {
    if ('deviceId' in candidate) {
        return candidate.deviceId;
    }
    return candidate.id;
}

function getCandidateType(candidate: DeviceAutomationCandidate): string {
    if ('deviceType' in candidate) {
        return candidate.deviceType;
    }
    return candidate.type;
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
        let canonicalCount = 0;
        for (let index = 0; index < candidates.length; index++) {
            const candidate = candidates[index]!;
            if (getCandidateId(candidate) === ownerId) {
                canonicalCount += 1;
                canonicalIndex = index;
            }
        }
        if (canonicalCount > 0) {
            if (canonicalCount !== 1 || !acceptsParameter(candidates[canonicalIndex]!, parameterId)) {
                return UNRESOLVED_DEVICE_AUTOMATION_TARGET;
            }
            return canonicalIndex;
        }

        let legacyIndex = NO_DEVICE_AUTOMATION_TARGET;
        let legacyCount = 0;
        for (let index = 0; index < candidates.length; index++) {
            const candidate = candidates[index]!;
            if (getCandidateType(candidate) === ownerId && acceptsParameter(candidate, parameterId)) {
                legacyCount += 1;
                legacyIndex = index;
            }
        }
        return legacyCount === 1 ? legacyIndex : UNRESOLVED_DEVICE_AUTOMATION_TARGET;
    }

    let legacyIndex = NO_DEVICE_AUTOMATION_TARGET;
    let legacyCount = 0;
    for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index]!;
        if (acceptsParameter(candidate, parameterId)) {
            legacyCount += 1;
            legacyIndex = index;
        }
    }
    if (legacyCount === 0) {
        return NO_DEVICE_AUTOMATION_TARGET;
    }
    return legacyCount === 1 ? legacyIndex : UNRESOLVED_DEVICE_AUTOMATION_TARGET;
}
