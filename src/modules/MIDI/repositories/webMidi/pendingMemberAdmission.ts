import type { MidiExpressionDimension } from '../../models/MidiNote';

type TimedMemberExpression = {
    dimension: MidiExpressionDimension;
    value: number;
    eventTime: number;
    bendRangeSemitones?: number;
};

type PendingMemberAdmission = {
    channel: number;
    changes: TimedMemberExpression[];
};

const pendingByChannel = new Map<number, Set<PendingMemberAdmission>>();

function beginPendingMemberAdmission(channel: number): PendingMemberAdmission {
    const admission: PendingMemberAdmission = { channel, changes: [] };
    const pending = pendingByChannel.get(channel) ?? new Set<PendingMemberAdmission>();
    pending.add(admission);
    pendingByChannel.set(channel, pending);
    return admission;
}

function hasPendingMemberAdmission(channel: number): boolean {
    return (pendingByChannel.get(channel)?.size ?? 0) > 0;
}

function recordPendingMemberExpression(channel: number, change: TimedMemberExpression): void {
    for (const admission of pendingByChannel.get(channel) ?? []) {
        admission.changes.push(change);
    }
}

function takePendingMemberAdmission(admission: PendingMemberAdmission | undefined): TimedMemberExpression[] {
    if (!admission) {
        return [];
    }
    const pending = pendingByChannel.get(admission.channel);
    if (!pending?.delete(admission)) {
        return [];
    }
    if (pending.size === 0) {
        pendingByChannel.delete(admission.channel);
    }
    return admission.changes;
}

function clearPendingMemberAdmissions(): void {
    pendingByChannel.clear();
}

export const pendingMemberAdmission = {
    begin: beginPendingMemberAdmission,
    has: hasPendingMemberAdmission,
    record: recordPendingMemberExpression,
    take: takePendingMemberAdmission,
    clear: clearPendingMemberAdmissions,
};
