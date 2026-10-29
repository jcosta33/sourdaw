import { resolveTempoMapNoopRows } from '#/modules/Transport/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { type TempoMapEdit, type TempoMapRow, type TempoMapRowPlan } from '#/utils/tempoMapRowPlan';

import { AppActionConflictError } from '../../errors/AppActionExecutionError';
import { executeAppAction, type ExecuteAppActionOptions } from '../executeAppAction';
import { getCommandHandler } from '../getCommandHandler';

type MapAction = Extract<AppAction, { type: 'editTempoMap' | 'restoreTempoMapEdit' }>;
type Intent = { edit: TempoMapEdit; destination: readonly TempoMapRow[] };

function mappedEdit(edit: TempoMapEdit, ids: ReadonlyMap<string, string>): TempoMapEdit {
    if (edit.type === 'update' || edit.type === 'remove') {
        return { ...edit, id: ids.get(edit.id) ?? edit.id };
    }
    return structuredClone(edit);
}

function restoredEdit(plan: TempoMapRowPlan, direction: 'apply' | 'restore', ids: ReadonlyMap<string, string>): Intent {
    const destination = direction === 'restore' ? plan.before : plan.after;
    const source = direction === 'restore' ? plan.after : plan.before;
    if (plan.operation === 'replace') {
        return {
            edit: { type: 'replace', changes: destination.map(({ beat, tempo, curve }) => ({ beat, tempo, curve })) },
            destination,
        };
    }
    const row = destination[0];
    if (!row) {
        const original = source[0];
        if (!original) {
            throw new Error('Captured tempo operation has no target');
        }
        return { edit: { type: 'remove', id: ids.get(original.id) ?? original.id }, destination };
    }
    if (plan.operation === 'update') {
        return { edit: { type: 'update', id: ids.get(row.id) ?? row.id, tempo: row.tempo }, destination };
    }
    return { edit: { type: 'add', beat: row.beat, tempo: row.tempo, curve: row.curve }, destination };
}

function readIntent(action: MapAction, ids: ReadonlyMap<string, string>): Intent {
    const captured =
        action.type === 'restoreTempoMapEdit' ||
        Object.hasOwn(action.payload, 'rowPlan') ||
        Object.hasOwn(action.payload, 'audioSourcePromotion');
    if (captured && !getCommandHandler(action)?.validateSessionActionArguments?.(action.payload)) {
        throw new AppActionConflictError(action.type, 'Invalid captured macro tempo action');
    }
    if (action.type === 'restoreTempoMapEdit') {
        return restoredEdit(action.payload.rowPlan, action.payload.rowDirection, ids);
    }
    return { edit: mappedEdit(action.payload.edit, ids), destination: action.payload.rowPlan?.after ?? [] };
}

/** Rebinding one logical row also retains older aliases restored by an inverse add or replace. */
function bindRow(ids: Map<string, string>, recorded: string, actual: string): void {
    const previous = ids.get(recorded) ?? recorded;
    for (const [alias, target] of ids) {
        if (target === previous) {
            ids.set(alias, actual);
        }
    }
    ids.set(recorded, actual);
}

export async function replayTempoMapMacroAction(
    action: MapAction,
    ids: Map<string, string>,
    options: ExecuteAppActionOptions
): Promise<void> {
    const intent = readIntent(action, ids);
    const observation: { rows?: readonly TempoMapRow[] | null } = {};
    await executeAppAction(
        { type: 'editTempoMap', payload: { edit: intent.edit } },
        {
            ...options,
            observeMaterializedAction: (canonical) => {
                if (canonical.type === 'editTempoMap') {
                    // Noop admission has no plan. Read its actual owner in this same
                    // synchronous phase, before dispatch can yield to later edits.
                    observation.rows =
                        canonical.payload.rowPlan?.after ?? resolveTempoMapNoopRows(canonical.payload.edit);
                }
            },
        }
    );
    // Cancellation has no observation. Failure throws before aliases can change.
    const actual = observation.rows;
    if (!actual || actual.length !== intent.destination.length) {
        return;
    }
    for (const [index, recorded] of intent.destination.entries()) {
        const row = actual[index];
        if (row) {
            bindRow(ids, recorded.id, row.id);
        }
    }
}
