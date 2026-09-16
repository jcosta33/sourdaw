import { agentProjectRepairStateStore, type AgentProjectRepairState } from '#/modules/CrdtDocument/stores';
import { DOC_PREFIX_ROOT, mutateCrdtDoc, projectCrdtToStores } from '#/modules/CrdtDocument/useCases';
import { createHandler } from '#/utils/createHandler';

type ConflictRepairCandidate = Extract<
    AgentProjectRepairState['repairCandidates'][number],
    { kind: 'choose-automerge-conflict-value' }
>;

type FieldContainer = Record<string | number, unknown>;

function isContainer(value: unknown): value is FieldContainer {
    return typeof value === 'object' && value !== null;
}

/**
 * Write the value a conflicted field already resolved to back onto that field.
 *
 * A conflicted path stays conflicted until some change names a successor, so
 * re-asserting the current value closes the conflict without choosing between
 * the concurrent alternatives — the winner was already picked when the document
 * resolved; this only records that pick as a deliberate change. The copy is
 * structural: assigning a document object onto itself would re-import it as a
 * new subtree anyway, and a plain copy keeps that explicit.
 */
function reassertResolvedValue(draft: FieldContainer, path: readonly (number | string)[]): void {
    const key = path[path.length - 1];
    if (key === undefined) {
        return;
    }
    let container: unknown = draft;
    for (const segment of path.slice(0, -1)) {
        if (!isContainer(container)) {
            return;
        }
        container = container[segment];
    }
    if (!isContainer(container)) {
        return;
    }
    const current = container[key];
    if (current === undefined) {
        return;
    }
    container[key] = isContainer(current) ? structuredClone(current) : current;
}

/**
 * The user-facing repair route for a repair-required project (issue #3573).
 *
 * Closes every unresolved Automerge conflict by keeping the value each
 * conflicted field already resolved to, then re-projects the whole document:
 * the re-inspection decides whether the project is editable again, and the
 * slots hydrate only once it is. The repair deliberately changes no musical
 * content — which is also why it is not undoable: there is no earlier state to
 * restore to, and clearing the undo history for it would throw away the user's
 * real history to no end.
 */
export const handleRepairProjectData = createHandler<'repairProjectData'>({
    execute: () => {
        const repairState = agentProjectRepairStateStore.value;
        if (!repairState) {
            return { status: 'no-write' };
        }

        const conflictPaths = repairState.repairCandidates
            .filter(
                (candidate): candidate is ConflictRepairCandidate =>
                    candidate.kind === 'choose-automerge-conflict-value'
            )
            .map((candidate) => candidate.path);
        if (conflictPaths.length > 0) {
            mutateCrdtDoc<Record<string, unknown>>({
                id: DOC_PREFIX_ROOT,
                message: 'Repair project data: keep the resolved value of each conflicted field',
                changeFn: (draft) => {
                    for (const path of conflictPaths) {
                        reassertResolvedValue(draft, path);
                    }
                },
            });
        }

        projectCrdtToStores({ resetProjections: true });

        // A repair that leaves the gate up fixed nothing the user can act on:
        // report it as a conflict so the dispatch refuses rather than claiming
        // success over a project that still cannot be edited.
        return agentProjectRepairStateStore.value === null ? { status: 'written' } : { status: 'conflict' };
    },
    describe: () => ({ label: 'Repair project data' }),
    batchExecution: 'singleton',
    undoable: false,
});
