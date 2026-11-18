import { getObjectId } from '@automerge/automerge';

import { captureProjectRootIdentity, getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { createHandler } from '#/utils/createHandler';
import { type HandlerMaterializationContext } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type AutomationPointSnapshot } from '../../events/automationSnapshots';
import { findRawAutomationLane } from '../../services/findRawAutomationLane';
import { restoreAutomationLanePoints } from '../../useCases/automation/restoreAutomationLanePoints';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

import {
    type InsertAutomationLanePoints,
    type InsertionCapture,
    type InsertionOwner,
    isCapturedLaneInsertion,
    isInsertionOwner,
    isLaneInsertion,
    isLaneInsertionSessionEntry,
    planLaneInsertion,
} from './automationLaneInsertionCapture';
import { automationPointSnapshotsMatch as pointsMatch } from './automationPointSnapshotsMatch';
import { findFollowerLaneRefusal } from './followerLaneRefusal';
import { isRestorableAutomationPointSet } from './validateRangeWriteSessionEntries';

const ROOT_DOCUMENT = 'root';
// The command kernel clones materialized arguments. Authenticate the original
// replay object at that seam, then retain the installed root for its clone.
const replayInverses = new WeakSet<InsertAutomationLanePoints>();
type PreparedAuthority = { rootIdentity: string; isCurrent: (() => boolean) | undefined };
const preparedAuthorities = new WeakMap<InsertAutomationLanePoints, PreparedAuthority>();

function hasOwner(lane: Readonly<Record<string, unknown>>, owner: InsertionOwner): boolean {
    return lane.trackId === owner.trackId && lane.parameterId === owner.parameterId && lane.clipId === owner.clipId;
}

function matchesLane(
    lane: Readonly<Record<string, unknown>>,
    owner: InsertionOwner,
    capture: InsertionCapture,
    points: readonly AutomationPointSnapshot[]
): boolean {
    return (
        hasOwner(lane, owner) &&
        lane.minValue === capture.minValue &&
        lane.maxValue === capture.maxValue &&
        lane.linkedLaneId === undefined &&
        isRestorableAutomationPointSet(lane.points) &&
        pointsMatch(lane.points, points)
    );
}

function canReplay(action: InsertAutomationLanePoints, context: HandlerMaterializationContext | undefined): boolean {
    if (context?.undoEntryId === undefined) {
        return false;
    }
    const requested = context.actions[context.actionIndex];
    if (requested?.type !== action.type) {
        return false;
    }
    if (action.payload.direction === 'undo') {
        return replayInverses.has(requested);
    }
    return canReplayRedo(action, context.recordedRedo);
}

function canReplayRedo(
    action: InsertAutomationLanePoints,
    redo: HandlerMaterializationContext['recordedRedo']
): boolean {
    const inverse = redo?.inverseAction;
    return (
        redo?.isCurrent() === true &&
        inverse?.type === action.type &&
        replayInverses.has(inverse) &&
        valuesEqual(inverse.payload, { ...action.payload, direction: 'undo' })
    );
}

function rememberPreparedAuthority(action: InsertAutomationLanePoints, context?: HandlerMaterializationContext): void {
    preparedAuthorities.set(action, {
        rootIdentity: captureProjectRootIdentity(),
        isCurrent: context?.recordedRedo?.isCurrent,
    });
}

function readWritableLane(laneId: string, owner: InsertionOwner) {
    const root = getCrdtDoc(ROOT_DOCUMENT);
    const rawLane = root ? findRawAutomationLane(root, laneId) : undefined;
    const lane = getAutomationStoreState()?.lanes.find((candidate) => candidate.id === laneId);
    const laneObjectId = rawLane && getObjectId(rawLane);
    if (!lane || !rawLane || !laneObjectId || lane.linkedLaneId !== undefined || !hasOwner(lane, owner)) {
        return undefined;
    }
    return { lane, rawLane, laneObjectId };
}

function materializeInsertion(action: InsertAutomationLanePoints, context?: HandlerMaterializationContext): void {
    const payload = action.payload;
    if (Object.hasOwn(payload, 'capture') || Object.hasOwn(payload, 'direction')) {
        if (canReplay(action, context) && isCapturedLaneInsertion(payload)) {
            rememberPreparedAuthority(action, context);
        }
        return;
    }
    if (
        !isLaneInsertion(payload.insertion) ||
        !isInsertionOwner(payload.owner) ||
        (context !== undefined && context.actions.length !== 1)
    ) {
        return;
    }

    const { owner } = payload;
    const source = readWritableLane(payload.laneId, owner);
    if (!source) {
        return;
    }
    const { lane, rawLane, laneObjectId } = source;
    const { minValue, maxValue } = lane;
    const before = structuredClone(lane.points);
    const editId = crypto.randomUUID();
    const planned = planLaneInsertion({ ...owner, minValue, maxValue }, before, payload.insertion, editId);
    if (!planned) {
        return;
    }
    const capture = { minValue, maxValue, laneObjectId, before, editId, ...planned };
    if (matchesLane(rawLane, owner, capture, before)) {
        payload.capture = capture;
        rememberPreparedAuthority(action);
    }
}

export const handleInsertAutomationLanePoints = createHandler<'insertAutomationLanePoints'>({
    materializeCommandArguments: materializeInsertion,
    materializeCommandArgumentsAt: 'execution',
    describe: (action) => {
        const { insertion } = action.payload;
        const label =
            isLaneInsertion(insertion) && insertion.kind === 'shape'
                ? 'Insert automation shape'
                : 'Add automation point';
        if (action.payload.direction !== undefined || !preparedAuthorities.has(action)) {
            return { label };
        }
        const inverseAction: InsertAutomationLanePoints = {
            type: action.type,
            payload: { ...action.payload, direction: 'undo' },
        };
        replayInverses.add(inverseAction);
        return { label, inverseAction };
    },
    execute: (action) => {
        const { laneId, owner, capture, direction } = action.payload;
        const followerRefusal = findFollowerLaneRefusal(laneId);
        if (followerRefusal) {
            return { status: 'conflict', reason: followerRefusal };
        }
        const authority = preparedAuthorities.get(action);
        if (authority === undefined || !capture) {
            return { status: 'conflict' };
        }

        const expected = direction === 'undo' ? capture.after : capture.before;
        const replacement = direction === 'undo' ? capture.before : capture.after;
        const conflict = 'The automation lane changed before its point insertion could be applied.';
        const check = (document: Readonly<Record<string, unknown>>, points: readonly AutomationPointSnapshot[]) => {
            const lane = findRawAutomationLane(document, laneId);
            return lane &&
                captureProjectRootIdentity() === authority.rootIdentity &&
                (authority.isCurrent?.() ?? true) &&
                getObjectId(lane) === capture.laneObjectId &&
                matchesLane(lane, owner, capture, points)
                ? null
                : conflict;
        };
        const root = getCrdtDoc(ROOT_DOCUMENT);
        const lane = getAutomationStoreState()?.lanes.find((candidate) => candidate.id === laneId);
        if (
            !root ||
            check(root, expected) ||
            !lane ||
            !matchesLane(lane, owner, capture, expected) ||
            !isRestorableAutomationPointSet(replacement)
        ) {
            return { status: 'conflict', reason: conflict };
        }

        restoreAutomationLanePoints(laneId, replacement);
        return {
            status: 'written',
            commitValidation: {
                documentId: ROOT_DOCUMENT,
                beforeCommit: () => {
                    const current = getCrdtDoc(ROOT_DOCUMENT);
                    return current ? check(current, expected) : conflict;
                },
                beforeMutation: (document) => check(document, expected),
                validateDocument: (document) => check(document, replacement),
                release: () => undefined,
            },
        };
    },
    validateSessionActionArguments: isCapturedLaneInsertion,
    validateSessionEntry: isLaneInsertionSessionEntry,
    restoreSessionEntry: (entry) => {
        if (entry.inverseAction?.type === 'insertAutomationLanePoints' && isLaneInsertionSessionEntry(entry)) {
            replayInverses.add(entry.inverseAction);
        }
    },
    previewExecution: 'unsupported-external',
    batchExecution: 'singleton',
    canReportConflict: true,
    requiresAbortCompensation: false,
    undoable: true,
});
