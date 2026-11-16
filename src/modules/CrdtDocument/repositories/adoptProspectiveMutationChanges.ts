import {
    type ChangeMetadata,
    type Doc,
    type Heads,
    applyChanges,
    free,
    getActorId,
    getChangesMetaSince,
    getHeads,
    getMissingDeps,
} from '@automerge/automerge';

import { type ProspectiveMutationWorkerResult } from '../models/ProspectiveMutationWorkerProtocol';

type Input<TDoc> = {
    candidate: Doc<TDoc>;
    doc: Doc<TDoc>;
    result: ProspectiveMutationWorkerResult;
    actor: string;
    previousHeads: Heads;
    message: string | undefined;
    key: string | undefined;
    assertCurrent(): void;
    releaseClone(): void;
};

type AuthorityInput<TDoc> = Pick<
    Input<TDoc>,
    'doc' | 'result' | 'actor' | 'previousHeads' | 'message' | 'assertCurrent'
>;

type AdditionAuthorityInput<TDoc> = Pick<Input<TDoc>, 'doc' | 'actor' | 'previousHeads' | 'message'>;

function assertDefaultAdditionAuthority<TDoc>(
    addition: ChangeMetadata,
    { doc, actor, previousHeads, message }: AdditionAuthorityInput<TDoc>
): void {
    const previousOwnChange = getChangesMetaSince(doc, []).reduce<ChangeMetadata | undefined>(
        (latest, entry) => (entry.actor === actor && (!latest || entry.seq > latest.seq) ? entry : latest),
        undefined
    );
    const nextSequence = (previousOwnChange?.seq ?? 0) + 1;
    const expectedDependencies = new Set(previousHeads);
    // Native transactions also name this actor's last change when it is no longer a head.
    if (previousOwnChange) {
        expectedDependencies.add(previousOwnChange.hash);
    }
    const dependencies = new Set(addition.deps);
    if (
        addition.actor !== actor ||
        addition.seq !== nextSequence ||
        addition.message !== (message || null) ||
        addition.deps.length !== dependencies.size ||
        dependencies.size !== expectedDependencies.size ||
        addition.deps.some((head) => !expectedDependencies.has(head))
    ) {
        throw new Error('Prospective mutation Worker changed native authority');
    }
}

function assertDefaultNativeAuthority<TDoc>(
    loaded: Doc<TDoc>,
    { doc, result: { heads }, actor, previousHeads, message, assertCurrent }: AuthorityInput<TDoc>
): void {
    if (getMissingDeps(loaded, []).length > 0) {
        throw new Error('Prospective mutation Worker left missing native dependencies');
    }
    if (getMissingDeps(loaded, previousHeads).length > 0) {
        throw new Error('Prospective mutation Worker lost the native frontier');
    }
    const additions = getChangesMetaSince(loaded, previousHeads);
    if (additions.length > 1) {
        throw new Error('Prospective mutation Worker changed native authorship');
    }
    const addition = additions[0];
    if (addition) {
        assertDefaultAdditionAuthority(addition, { doc, actor, previousHeads, message });
    }
    const expectedHeads = addition ? [addition.hash] : previousHeads;
    const installedHeads = getHeads(loaded);
    if (
        heads.length !== expectedHeads.length ||
        heads.some((head) => !expectedHeads.includes(head)) ||
        installedHeads.length !== expectedHeads.length ||
        installedHeads.some((head) => !expectedHeads.includes(head))
    ) {
        throw new Error('Prospective mutation Worker changed native heads');
    }
    if (getActorId(loaded) !== actor) {
        throw new Error('Prospective mutation Worker changed native authority');
    }
    assertCurrent();
}

/** The ordinary one-change adoption path, with its existing native and slot authority checks. */
export function adoptProspectiveMutationChanges<TDoc>({
    candidate,
    doc,
    result,
    actor,
    previousHeads,
    message,
    key,
    assertCurrent,
    releaseClone,
}: Input<TDoc>): Doc<TDoc> {
    let loaded: Doc<TDoc> | undefined;
    try {
        const { changes } = result;
        // The returned JS root shares this private native handle. Transfer
        // ownership before apply, so cleanup never frees its consumed alias.
        loaded = candidate;
        const applyStarted = performance.now();
        try {
            if (changes.length > 0) {
                // TypeScript does not track writes to captured locals through the native callback.
                const application = { ownedSlotChanged: false, retiredEvidence: false };
                [loaded] = applyChanges(loaded, changes, {
                    patchCallback: (patches) => {
                        for (const patch of patches) {
                            const retiresEvidence =
                                patch.action === 'del' &&
                                patch.path.length === 1 &&
                                patch.path[0] === '_storagePublicationEvidence';
                            if (patch.path[0] !== key && !retiresEvidence) {
                                throw new Error('Prospective mutation Worker changed an unowned slot');
                            }
                            application.ownedSlotChanged ||= patch.path[0] === key;
                            application.retiredEvidence ||= retiresEvidence;
                        }
                    },
                });
                // Native patch order need not place the owned slot before metadata retirement.
                if (application.retiredEvidence && !application.ownedSlotChanged) {
                    throw new Error('Prospective mutation Worker changed an unowned slot');
                }
            }
        } finally {
            performance.measure('automerge-prospective-apply-task', {
                start: applyStarted,
                end: performance.now(),
            });
            performance.clearMeasures('automerge-prospective-apply-task');
        }
        const authorityStarted = performance.now();
        try {
            assertDefaultNativeAuthority(loaded, { doc, result, actor, previousHeads, message, assertCurrent });
        } finally {
            performance.measure('automerge-prospective-authority-task', {
                start: authorityStarted,
                end: performance.now(),
            });
            performance.clearMeasures('automerge-prospective-authority-task');
        }
        releaseClone();
        const updated = loaded;
        loaded = undefined;
        return updated;
    } catch (error) {
        if (loaded) {
            free(loaded);
        }
        releaseClone();
        throw error;
    }
}
