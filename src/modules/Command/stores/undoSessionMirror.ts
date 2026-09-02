import { type AppAction } from '#/utils/handlerContract';

import { type ActionUndoEntry, isActionEntry, type UndoEntry, type UndoSource } from '../models/UndoEntry';

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const MAX_UNDO_PERSIST = 100;

/**
 * What the live command registry says one action type currently is: the
 * operation version it executes at, and whether a stored argument payload
 * still matches its argument contract. Injected at hydration because
 * `stores/` may not import `useCases/`, where the generated schemas live.
 */
export type SessionActionContract = {
    readonly actionType: string;
    readonly operationVersion: number;
    readonly validateArguments: (payload: unknown) => boolean;
};

export type UndoSessionStacks = {
    past: UndoEntry[];
    future: UndoEntry[];
    /** The project these stacks were hydrated against, or `undefined` for a
     *  mirror written before identity tagging existed or with no known owner. */
    projectId: string | undefined;
    /** The document witness (see `CrdtDocument`'s `captureDurableDocumentWitness`)
     *  recorded alongside `projectId`; `undefined` under the same conditions. */
    witness: string | undefined;
};

type PersistableUndoStacks = {
    readonly past: readonly UndoEntry[];
    readonly future: readonly UndoEntry[];
    readonly projectId: string | undefined;
    readonly witness: string | undefined;
};

type SerializedActionUndoEntry = ActionUndoEntry & {
    actionOperationVersion: number;
    inverseActionOperationVersion?: number;
    redoActionOperationVersion?: number;
};

let sessionActionContracts: ReadonlyMap<string, SessionActionContract> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUndoSource(value: unknown): value is UndoSource {
    return value === 'manual' || value === 'prompt' || value === 'voice' || value === 'ai';
}

function getActionContract(action: unknown): SessionActionContract | null {
    if (!isRecord(action) || typeof action.type !== 'string') {
        return null;
    }
    return sessionActionContracts?.get(action.type) ?? null;
}

function getCurrentOperationVersion(action: unknown): number | null {
    return getActionContract(action)?.operationVersion ?? null;
}

function getStoredOperationVersion(value: Record<string, unknown>, key: string): number | null | undefined {
    const version = value[key];
    if (version === undefined) {
        return undefined;
    }
    if (!Number.isSafeInteger(version) || (version as number) < 1) {
        return null;
    }
    return version as number;
}

/**
 * A stored action is replayable only when the registry still executes its type
 * at the recorded operation version AND its arguments still satisfy that
 * type's current argument contract. The version alone proves nothing: an
 * argument shape can change without anyone bumping a version, and replaying an
 * inverse whose payload no longer parses corrupts the project it claims to
 * restore. An action declared without a payload validates against the empty
 * argument record its schema describes.
 */
function actionMatchesCurrentContract(action: unknown, storedVersion: number | undefined): action is AppAction {
    if (!isRecord(action)) {
        return false;
    }
    const contract = getActionContract(action);
    if (contract === null || (storedVersion ?? 1) !== contract.operationVersion) {
        return false;
    }
    return contract.validateArguments(action.payload === undefined ? {} : action.payload);
}

function serializeSessionActionEntry(entry: UndoEntry): SerializedActionUndoEntry | null {
    if (!isActionEntry(entry)) {
        return null;
    }
    const actionOperationVersion = getCurrentOperationVersion(entry.action);
    if (actionOperationVersion === null) {
        return null;
    }
    const inverseActionOperationVersion =
        entry.inverseAction === null ? null : getCurrentOperationVersion(entry.inverseAction);
    if (entry.inverseAction !== null && inverseActionOperationVersion === null) {
        return null;
    }
    const redoActionOperationVersion =
        entry.redoAction === undefined ? null : getCurrentOperationVersion(entry.redoAction);
    if (entry.redoAction !== undefined && redoActionOperationVersion === null) {
        return null;
    }

    return {
        ...entry,
        actionOperationVersion,
        ...(inverseActionOperationVersion === null ? {} : { inverseActionOperationVersion }),
        ...(redoActionOperationVersion === null ? {} : { redoActionOperationVersion }),
    };
}

function getOptionalString(value: Record<string, unknown>, key: string): string | null | undefined {
    const maybeString = value[key];
    if (maybeString === undefined) {
        return undefined;
    }
    if (typeof maybeString !== 'string') {
        return null;
    }
    return maybeString;
}

function sanitizeStoredEntry(value: unknown): ActionUndoEntry | null {
    if (!isRecord(value)) {
        return null;
    }
    if (value.kind !== undefined && value.kind !== 'action') {
        return null;
    }
    if (typeof value.id !== 'string' || typeof value.label !== 'string') {
        return null;
    }
    if (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) {
        return null;
    }

    const action = value.action;
    const actionOperationVersion = getStoredOperationVersion(value, 'actionOperationVersion');
    if (actionOperationVersion === null || !actionMatchesCurrentContract(action, actionOperationVersion)) {
        return null;
    }

    const storedInverseAction = value.inverseAction;
    const inverseActionOperationVersion = getStoredOperationVersion(value, 'inverseActionOperationVersion');
    if (inverseActionOperationVersion === null) {
        return null;
    }
    let inverseAction: AppAction | null;
    if (storedInverseAction === null) {
        if (inverseActionOperationVersion !== undefined) {
            return null;
        }
        inverseAction = null;
    } else if (actionMatchesCurrentContract(storedInverseAction, inverseActionOperationVersion)) {
        inverseAction = storedInverseAction;
    } else {
        return null;
    }

    const storedRedoAction = value.redoAction;
    const redoActionOperationVersion = getStoredOperationVersion(value, 'redoActionOperationVersion');
    if (redoActionOperationVersion === null) {
        return null;
    }
    let redoAction: AppAction | undefined;
    if (storedRedoAction === undefined) {
        if (redoActionOperationVersion !== undefined) {
            return null;
        }
        redoAction = undefined;
    } else if (actionMatchesCurrentContract(storedRedoAction, redoActionOperationVersion)) {
        redoAction = storedRedoAction;
    } else {
        return null;
    }

    const source = value.source ?? 'manual';
    if (!isUndoSource(source)) {
        return null;
    }

    const groupId = getOptionalString(value, 'groupId');
    if (groupId === null) {
        return null;
    }

    const groupLabel = getOptionalString(value, 'groupLabel');
    if (groupLabel === null) {
        return null;
    }

    const entry: ActionUndoEntry = {
        id: value.id,
        kind: 'action',
        label: value.label,
        action,
        inverseAction,
        timestamp: value.timestamp,
        source,
    };

    if (groupId !== undefined) {
        entry.groupId = groupId;
    }
    if (groupLabel !== undefined) {
        entry.groupLabel = groupLabel;
    }
    if (redoAction !== undefined) {
        entry.redoAction = redoAction;
    }

    return entry;
}

/**
 * Both stacks are consumed from the end nearest the present: undo pops the
 * tail of `past`, redo takes the head of `future`. An entry that fails to
 * convert therefore strands everything beyond it — stepping over the hole
 * would apply an inverse out of order — so only the unbroken run adjacent to
 * the present is kept, on both the read side (an entry that no longer
 * parses) and the write side (an entry, e.g. a `kind: 'callback'` entry, that
 * has no serializable form at all).
 */
function reachableRunFromPresent<TInput, TOutput>(
    values: readonly TInput[],
    nearestFirst: boolean,
    toOutput: (value: TInput) => TOutput | null
): TOutput[] {
    const ordered = nearestFirst ? values : [...values].reverse();
    const reachable: TOutput[] = [];
    for (const value of ordered) {
        const output = toOutput(value);
        if (output === null) {
            break;
        }
        reachable.push(output);
    }
    return nearestFirst ? reachable : reachable.reverse();
}

function sanitizeReachableEntries(values: unknown[], nearestFirst: boolean): ActionUndoEntry[] {
    return reachableRunFromPresent(values, nearestFirst, sanitizeStoredEntry);
}

function readStoredProjectId(value: Record<string, unknown>): string | undefined {
    const projectId = value.projectId;
    return typeof projectId === 'string' && projectId.length > 0 ? projectId : undefined;
}

function readStoredWitness(value: Record<string, unknown>): string | undefined {
    const witness = value.witness;
    return typeof witness === 'string' && witness.length > 0 ? witness : undefined;
}

function readStoredStacks(): UndoSessionStacks {
    try {
        const raw = sessionStorage.getItem(UNDO_SESSION_KEY);
        if (raw) {
            const parsed: unknown = JSON.parse(raw);
            if (isRecord(parsed) && Array.isArray(parsed.past) && Array.isArray(parsed.future)) {
                return {
                    past: sanitizeReachableEntries(parsed.past, false),
                    future: sanitizeReachableEntries(parsed.future, true),
                    // A mirror with no recorded identity predates identity tagging or
                    // never had one; the caller treats it as belonging to no project.
                    projectId: readStoredProjectId(parsed),
                    witness: readStoredWitness(parsed),
                };
            }
        }
    } catch {
        /* unreadable or unparseable: there is nothing this build can trust */
    }
    return { past: [], future: [], projectId: undefined, witness: undefined };
}

/**
 * Establishes the current executable action set, then restores whatever the
 * mirror still proves replayable under it. Called after production handler
 * registration so unknown, retired, and re-shaped actions never enter the live
 * stacks.
 */
export function hydrateSessionMirror(actionContracts: Iterable<SessionActionContract>): UndoSessionStacks {
    sessionActionContracts = new Map([...actionContracts].map((contract) => [contract.actionType, contract] as const));
    return readStoredStacks();
}

function serializeSessionStacks(stacks: PersistableUndoStacks, limit: number): string {
    // `past` is stored oldest-first (nearest the present at the tail); `future`
    // is stored nearest-first. Walking each with `reachableRunFromPresent`
    // stops at the first entry with no serializable form (e.g. a `kind:
    // 'callback'` entry — a clip drag, slip, split, or import — which never
    // serializes), so an unserializable entry buried in the middle of a stack
    // strands everything behind it instead of leaving an invisible hole that
    // would silently misorder a later undo/redo.
    const persistablePast = reachableRunFromPresent(stacks.past, false, serializeSessionActionEntry);
    const persistableFuture = reachableRunFromPresent(stacks.future, true, serializeSessionActionEntry);
    // Trim from the end furthest from the present, so a truncated mirror keeps
    // the entries the next session reaches first: the newest of `past`, the
    // nearest of `future`. `JSON.stringify` omits an `undefined` projectId and
    // witness, so an untagged write round-trips back to the same "no known
    // owner" state.
    return JSON.stringify({
        past: persistablePast.slice(-limit),
        future: persistableFuture.slice(0, limit),
        projectId: stacks.projectId,
        witness: stacks.witness,
    });
}

function trySetSessionMirror(stacks: PersistableUndoStacks, limit: number): boolean {
    try {
        sessionStorage.setItem(UNDO_SESSION_KEY, serializeSessionStacks(stacks, limit));
        return true;
    } catch {
        return false;
    }
}

function discardSessionMirror(): void {
    try {
        sessionStorage.removeItem(UNDO_SESSION_KEY);
    } catch {
        /* storage is unreachable, so hydration will not read one either */
    }
}

/**
 * Mirrors the live stacks, observing the write. `setItem` throws before it
 * mutates, so a refused write leaves the previous, smaller mirror intact —
 * serving that after a reload replays an inverse over edits made since, the
 * failure class ADR 0013 retired. A refusal therefore shrinks the mirror until
 * one fits, and removes it outright when none does. Every entry a surviving
 * mirror holds is from this state; an absent mirror hydrates to nothing.
 *
 * Only the failing path re-serializes: a mirror that fits is written once.
 */
export function writeSessionMirror(stacks: PersistableUndoStacks): void {
    let limit = MAX_UNDO_PERSIST;
    while (limit > 0) {
        if (trySetSessionMirror(stacks, limit)) {
            return;
        }
        limit = Math.floor(limit / 2);
    }
    discardSessionMirror();
}
