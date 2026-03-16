import type { AppAction } from "#/modules/Command/models/AppAction";
import type { OperationEntry, PeerId } from "../models/CollaborationTypes";
import type { VectorClock } from "./vectorClock";
import { increment, merge, happensBefore } from "./vectorClock";

let operations: OperationEntry[] = [];
let localClock: VectorClock = {};
let nextOpId = 1;

export const appendLocalOperation = (peerId: PeerId, action: AppAction): OperationEntry => {
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
};

export const appendRemoteOperation = (entry: OperationEntry): void => {
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
};

export const getOperations = (): readonly OperationEntry[] => operations;

export const getLocalClock = (): VectorClock => ({ ...localClock });

export const clearOperations = (): void => {
    operations = [];
    localClock = {};
    nextOpId = 1;
};
