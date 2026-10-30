import { getCurrentAutomergeStorageMutationOwner } from '#/infra/store/storage/createAutomergeStorage';
import { type AppAction } from '#/utils/handlerContract';

import { type ActionUndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

// Project owners supply this read capability; Command must not import their
// document/runtime composition back into its execution kernel.
type PublicationAuthority = {
    captureIdentity: () => string;
    captureWitness: () => string;
    captureOwnedPublication: (owner: object) => () => (() => boolean) | null;
};

type Publication = {
    actions: readonly AppAction[];
    guards: readonly (() => boolean)[];
};

type StagedCapture = {
    entry: ActionUndoEntry;
    inverseAction: AppAction;
    owner: object;
    identity: string;
    before: string;
    readOwnedPublication: () => (() => boolean) | null;
    authority: PublicationAuthority;
    publication?: Publication;
};

type CaptureLifecycle =
    | {
          phase: 'stage';
          action: AppAction;
          inverseAction: AppAction;
          publicationAuthority: PublicationAuthority;
      }
    | { phase: 'published' | 'settle' | 'discard'; actions: readonly AppAction[] };

// Execution-local intents only. They never enter the document or session mirror.
const stagedCaptures = new WeakMap<AppAction, StagedCapture>();

function findEntry(replayAction: AppAction): ActionUndoEntry | undefined {
    const entry = undoStore.value?.future.find(
        (candidate) => candidate.kind === 'action' && (candidate.redoAction ?? candidate.action) === replayAction
    );
    return entry?.kind === 'action' ? entry : undefined;
}

function publicationIsCurrent(publication: Publication, actions: readonly AppAction[]): boolean {
    return (
        publication.actions.length === actions.length &&
        publication.actions.every((action, index) => action === actions[index]) &&
        publication.guards.every((isCurrent) => isCurrent())
    );
}

function captureOwnedPublication(
    captures: readonly StagedCapture[],
    actions: readonly AppAction[]
): Publication | null {
    const first = captures[0];
    if (!first) {
        return null;
    }
    const identity = first.authority.captureIdentity();
    const witness = first.authority.captureWitness();
    if (
        !captures.every(
            (capture) =>
                capture.owner === first.owner &&
                capture.identity === identity &&
                capture.authority.captureIdentity() === identity &&
                capture.before !== witness &&
                capture.authority.captureWitness() === witness
        )
    ) {
        return null;
    }
    const guards: Array<() => boolean> = [];
    for (const capture of captures) {
        const guard = capture.readOwnedPublication();
        if (!guard || !guard()) {
            return null;
        }
        guards.push(guard);
    }
    return { actions: [...actions], guards };
}

function discardStagedCaptures(actions: readonly AppAction[], captures: readonly StagedCapture[]): void {
    const discardedActions = new Set(actions);
    for (const capture of captures) {
        // A rejected subset must retire the entire bound publication, or a
        // later settlement could install the members left behind on their own.
        for (const action of capture.publication?.actions ?? []) {
            discardedActions.add(action);
        }
    }
    for (const action of discardedActions) {
        stagedCaptures.delete(action);
    }
}

function settleStagedCaptures(actions: readonly AppAction[], captures: readonly StagedCapture[]): void {
    const publication = captures[0]?.publication;
    if (
        publication === undefined ||
        !publicationIsCurrent(publication, actions) ||
        !captures.every(
            (capture) =>
                capture.publication === publication &&
                undoStore.value?.future.includes(capture.entry) === true &&
                capture.entry.inverseAction?.type === capture.inverseAction.type
        )
    ) {
        return;
    }
    // Validate the entire group before changing any of its paired captures.
    for (const capture of captures) {
        capture.entry.inverseAction = capture.inverseAction;
    }
}

/** Install a caller-proven capture, or stage removals through the Command commit boundary. */
export function commitRedoInverseCapture(replayAction: AppAction, inverseAction: AppAction): void;
export function commitRedoInverseCapture(lifecycle: CaptureLifecycle): void;
export function commitRedoInverseCapture(input: AppAction | CaptureLifecycle, inverseAction?: AppAction): void {
    if (!('phase' in input)) {
        const entry = findEntry(input);
        if (entry && inverseAction && entry.inverseAction?.type === inverseAction.type) {
            entry.inverseAction = inverseAction;
        }
        return;
    }
    if (input.phase === 'stage') {
        stagedCaptures.delete(input.action);
        const entry = findEntry(input.action);
        const owner = getCurrentAutomergeStorageMutationOwner();
        if (!entry || !owner || entry.inverseAction?.type !== input.inverseAction.type) {
            return;
        }
        stagedCaptures.set(input.action, {
            entry,
            inverseAction: input.inverseAction,
            owner,
            identity: input.publicationAuthority.captureIdentity(),
            before: input.publicationAuthority.captureWitness(),
            readOwnedPublication: input.publicationAuthority.captureOwnedPublication(owner),
            authority: input.publicationAuthority,
        });
        return;
    }
    const actions = input.actions;
    const captures = actions.flatMap((action) => {
        const capture = stagedCaptures.get(action);
        return capture ? [capture] : [];
    });
    if (input.phase === 'published' && captures.length > 0) {
        const publication = captureOwnedPublication(captures, actions);
        if (publication) {
            for (const capture of captures) {
                capture.publication = publication;
            }
            return;
        }
    }
    if (input.phase === 'settle') {
        settleStagedCaptures(actions, captures);
    }
    discardStagedCaptures(actions, captures);
}
