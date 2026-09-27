import type { MidiExpressionDimension } from '../../models/MidiNote';

type TimedMemberExpression = {
    dimension: MidiExpressionDimension;
    value: number;
    eventTime: number;
    bendRangeSemitones?: number;
};

export type PendingMemberAdmission = {
    channel: number;
    changes: TimedMemberExpression[];
};

const pendingByChannel = new Map<number, Set<PendingMemberAdmission>>();

export function beginPendingMemberAdmission(channel: number): PendingMemberAdmission {
    const admission: PendingMemberAdmission = { channel, changes: [] };
    const pending = pendingByChannel.get(channel) ?? new Set<PendingMemberAdmission>();
    pending.add(admission);
    pendingByChannel.set(channel, pending);
    return admission;
}

export function hasPendingMemberAdmission(channel: number): boolean {
    return (pendingByChannel.get(channel)?.size ?? 0) > 0;
}

export function recordPendingMemberExpression(channel: number, change: TimedMemberExpression): void {
    for (const admission of pendingByChannel.get(channel) ?? []) {
        admission.changes.push(change);
    }
}

export function takePendingMemberAdmission(admission: PendingMemberAdmission | undefined): TimedMemberExpression[] {
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

export function clearPendingMemberAdmissions(): void {
    pendingByChannel.clear();
}
