import { makeKey } from './makeKey';
import { activeRecording, pendingOwners, pendingPoints, touchActive } from './recordingSessionState';

export function discardTouchAutomation(trackId: string, parameterId: string, recordingOwner?: symbol): void {
    const key = makeKey(trackId, parameterId);
    const session = activeRecording.get(key);
    if (recordingOwner !== undefined && session?.recordingOwner !== recordingOwner) {
        return;
    }

    const points = pendingPoints.get(key) ?? [];
    const owners = pendingOwners.get(key);
    const ledgerAligned = owners !== undefined && owners.length === points.length;

    if (!ledgerAligned) {
        // Unreachable under this module's contract: the ledger is created,
        // pushed, and cleared index-for-index with the buffer everywhere.
        // With no trustworthy ownership information there is no narrower
        // correct removal, so fall back to the legacy whole-buffer clear.
        pendingPoints.set(key, []);
        pendingOwners.set(key, []);
        touchActive.delete(key);
        if (session) {
            session.lastValue = null;
        }
        return;
    }

    // Remove only the discarding producer's own samples. An undefined owner
    // is its own class: an ownerless discarding authority removes only
    // ownerless points, never another producer's.
    const keptPoints: typeof points = [];
    const keptOwners: typeof owners = [];
    for (let index = 0; index < points.length; index += 1) {
        if (owners[index] !== recordingOwner) {
            keptPoints.push(points[index]!);
            keptOwners.push(owners[index]);
        }
    }

    if (keptPoints.length === 0) {
        // The buffer held nothing but the discarding producer's samples —
        // the whole discard applies.
        pendingPoints.set(key, []);
        pendingOwners.set(key, []);
        touchActive.delete(key);
        if (session) {
            session.lastValue = null;
        }
        return;
    }

    // Foreign samples remain in flight: keep the buffer and the touch arm —
    // another producer is still touching this lane — and re-anchor the latch
    // window to the remaining tail instead of ending it.
    pendingPoints.set(key, keptPoints);
    pendingOwners.set(key, keptOwners);
    if (session) {
        session.lastValue = keptPoints[keptPoints.length - 1]!.value;
    }
}
