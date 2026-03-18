import { type AppAction } from '#/modules/Command/models/AppAction';
import { type OperationEntry, type PeerId } from '../models/CollaborationTypes';
import { type VectorClock, increment, merge, happensBefore } from './vectorClock';

let operations: OperationEntry[] = [];
let localClock: VectorClock = {};
let nextOpId = 1;

export function appendLocalOperation(peerId: PeerId, action: AppAction): OperationEntry {
    localClock = increment(localClock, peerId);
    const entry: OperationEntry = {
        id: `op-${String(nextOpId++)}`,
        peerId,
        action,
        timestamp: Date.now(),
        vectorClock: { ...localClock },
    };
    operations.push(entry);
    return entry;
}

export function appendRemoteOperation(entry: OperationEntry): void {
    localClock = merge(localClock, entry.vectorClock);
    operations.push(entry);
    operations.sort((a, b) => {
        if (happensBefore(a.vectorClock, b.vectorClock)) {
            return -1;
        }
        if (happensBefore(b.vectorClock, a.vectorClock)) {
            return 1;
        }
        return a.timestamp - b.timestamp;
    });
}

export function getOperations(): readonly OperationEntry[] {
    return operations;
}

export function getLocalClock(): VectorClock {
    return { ...localClock };
}

export function clearOperations(): void {
    operations = [];
    localClock = {};
    nextOpId = 1;
}
