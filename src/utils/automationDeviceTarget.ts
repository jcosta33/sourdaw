type DeviceAutomationCandidate = { deviceId: string; deviceType: string } | { id: string; type: string };

type DeviceAutomationTargetResolution<Candidate> =
    | { status: 'resolved'; candidate: Candidate; parameterId: string }
    | { status: 'unresolved' }
    | { status: 'not-device' };

type DeviceAutomationTargetInput<Candidate> = {
    targetId: string;
    candidates: readonly Candidate[];
    isEligible?: (candidate: Candidate) => boolean;
    acceptsParameter: (candidate: Candidate, parameterId: string) => boolean;
};

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

function acceptsTargetParameter<Candidate>(
    input: DeviceAutomationTargetInput<Candidate>,
    candidate: Candidate,
    parameterId: string
): boolean {
    if (input.isEligible && !input.isEligible(candidate)) {
        return false;
    }
    return input.acceptsParameter(candidate, parameterId);
}

export function createDeviceAutomationTargetId(deviceId: string, parameterId: string): string {
    return `${deviceId}:${parameterId}`;
}

export function resolveDeviceAutomationTarget<Candidate extends DeviceAutomationCandidate>(
    input: DeviceAutomationTargetInput<Candidate>
): DeviceAutomationTargetResolution<Candidate> {
    const separatorIndex = input.targetId.indexOf(':');
    if (separatorIndex >= 0) {
        const ownerId = input.targetId.slice(0, separatorIndex);
        const parameterId = input.targetId.slice(separatorIndex + 1);
        if (ownerId.length === 0 || parameterId.length === 0) {
            return { status: 'unresolved' };
        }

        let canonicalMatch: Candidate | undefined;
        let canonicalCount = 0;
        for (const candidate of input.candidates) {
            if (getCandidateId(candidate) === ownerId) {
                canonicalCount += 1;
                canonicalMatch = candidate;
            }
        }
        if (canonicalCount > 0) {
            if (
                canonicalCount !== 1 ||
                !canonicalMatch ||
                !acceptsTargetParameter(input, canonicalMatch, parameterId)
            ) {
                return { status: 'unresolved' };
            }
            return { status: 'resolved', candidate: canonicalMatch, parameterId };
        }

        let legacyMatch: Candidate | undefined;
        let legacyCount = 0;
        for (const candidate of input.candidates) {
            if (getCandidateType(candidate) === ownerId && acceptsTargetParameter(input, candidate, parameterId)) {
                legacyCount += 1;
                legacyMatch = candidate;
            }
        }
        if (legacyCount !== 1 || !legacyMatch) {
            return { status: 'unresolved' };
        }
        return { status: 'resolved', candidate: legacyMatch, parameterId };
    }

    let legacyMatch: Candidate | undefined;
    let legacyCount = 0;
    for (const candidate of input.candidates) {
        if (acceptsTargetParameter(input, candidate, input.targetId)) {
            legacyCount += 1;
            legacyMatch = candidate;
        }
    }
    if (legacyCount === 0) {
        return { status: 'not-device' };
    }
    if (legacyCount > 1 || !legacyMatch) {
        return { status: 'unresolved' };
    }
    return { status: 'resolved', candidate: legacyMatch, parameterId: input.targetId };
}
