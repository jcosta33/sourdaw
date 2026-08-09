import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

type PunchRegion = {
    punchInBeat: number;
    punchOutBeat: number;
};

type RestorePunchRegionInput = {
    expected: PunchRegion;
    replacement: PunchRegion;
};

type RestorePunchRegionResult = {
    status: 'written' | 'no-write' | 'conflict';
};

function isValidPunchRegion(region: PunchRegion): boolean {
    if (!Number.isFinite(region.punchInBeat) || !Number.isFinite(region.punchOutBeat)) {
        return false;
    }
    return region.punchInBeat >= 0 && region.punchOutBeat > region.punchInBeat;
}

function isSamePunchRegion(left: PunchRegion, right: PunchRegion): boolean {
    return left.punchInBeat === right.punchInBeat && left.punchOutBeat === right.punchOutBeat;
}

export function restorePunchRegion(input: RestorePunchRegionInput): RestorePunchRegionResult {
    if (!isValidPunchRegion(input.expected) || !isValidPunchRegion(input.replacement)) {
        return { status: 'no-write' };
    }

    const current = getTransportState();
    if (!current) {
        return { status: 'no-write' };
    }
    if (!isSamePunchRegion(current, input.expected)) {
        return { status: 'conflict' };
    }
    if (isSamePunchRegion(current, input.replacement)) {
        return { status: 'no-write' };
    }

    updateTransportState(input.replacement);
    return { status: 'written' };
}
