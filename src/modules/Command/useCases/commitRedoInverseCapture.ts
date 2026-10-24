import { getHeads, hasHeads } from '@automerge/automerge';

import { getCurrentAutomergeStorageMutationOwner } from '#/infra/store/storage/createAutomergeStorage';
import {
    captureDurableDocumentWitness,
    captureProjectIdentity,
    getCrdtDoc,
    getCrdtDocIds,
} from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type ActionUndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

type Publication = {
    actions: readonly AppAction[];
    identity: string;
    documents: { id: string; heads: string[] }[];
};

type StagedCapture = {
    entry: ActionUndoEntry;
    inverseAction: AppAction;
    owner: object;
    identity: string;
    before: string;
    ownsPublication: () => boolean;
    publication?: Publication;
};

type CaptureLifecycle =
    | { phase: 'stage'; action: AppAction; inverseAction: AppAction; ownsPublication: () => boolean }
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
        captureProjectIdentity() === publication.identity &&
        publication.actions.length === actions.length &&
        publication.actions.every((action, index) => action === actions[index]) &&
        publication.documents.every(({ id, heads }) => {
            const document = getCrdtDoc(id);
            return document !== undefined && hasHeads(document, heads);
        })
    );
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
            identity: captureProjectIdentity(),
            before: captureDurableDocumentWitness(),
            ownsPublication: input.ownsPublication,
        });
        return;
    }
    const actions = input.actions;
    const captures = actions.flatMap((action) => {
        const capture = stagedCaptures.get(action);
        return capture ? [capture] : [];
    });
    if (input.phase === 'published' && captures.length > 0) {
        const identity = captureProjectIdentity();
        const witness = captureDurableDocumentWitness();
        const first = captures[0]!;
        if (
            captures.every(
                (capture) =>
                    capture.owner === first.owner &&
                    capture.identity === identity &&
                    capture.before !== witness &&
                    capture.ownsPublication()
            )
        ) {
            const publication: Publication = {
                actions: [...actions],
                identity,
                documents: getCrdtDocIds().map((id) => ({ id, heads: getHeads(getCrdtDoc(id)!) })),
            };
            for (const capture of captures) {
                capture.publication = publication;
            }
            return;
        }
    }
    if (
        input.phase === 'settle' &&
        captures.length > 0 &&
        captures.every(
            (capture) =>
                capture.publication !== undefined &&
                publicationIsCurrent(capture.publication, actions) &&
                undoStore.value?.future.includes(capture.entry) === true &&
                capture.entry.inverseAction?.type === capture.inverseAction.type
        )
    ) {
        // Validate the entire group before changing any of its paired captures.
        for (const capture of captures) {
            capture.entry.inverseAction = capture.inverseAction;
        }
    }
    discardStagedCaptures(actions, captures);
}
