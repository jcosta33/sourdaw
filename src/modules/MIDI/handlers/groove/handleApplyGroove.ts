import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { assignGrooveTemplate } from '../../useCases/grooveTemplates/assignGrooveTemplate';
import { canonicalizeGrooveTemplateAssignment } from '../../useCases/grooveTemplates/canonicalizeGrooveTemplateAssignment';
import { describeUnwritableGrooveClip } from '../../useCases/grooveTemplates/describeUnwritableGrooveClip';
import { getGrooveAssignment } from '../../useCases/grooveTemplates/getGrooveAssignment';
import { markGrooveTemplateProjectWrite } from '../../useCases/grooveTemplates/markGrooveTemplateProjectWrite';
import { planGrooveApplication } from '../../useCases/grooveTemplates/planGrooveApplication';
import { getWritableMidiClipReplayGuardForBatch } from '../getWritableMidiClipReplayGuard';

import { isApplyGrooveSessionEntry } from './validateApplyGrooveCommand';

type ApplyGrooveAction = Extract<AppAction, { type: 'applyGroove' }>;

function getAssignmentInput(action: ApplyGrooveAction) {
    return {
        consumerType: 'clip' as const,
        consumerId: action.payload.clipId,
        templateId: action.payload.grooveId,
        amount: action.payload.amount ?? 1,
    };
}

function planInBatch(action: ApplyGrooveAction, context?: HandlerValidationContext) {
    return planGrooveApplication(action.payload, context ? context.actions.slice(0, context.actionIndex) : []);
}

/**
 * Why the target clip cannot take a groove. With a batch context the clip may be one an earlier
 * action creates; without one it is read as the earlier actions of the batch have left it live.
 */
function findTargetClipRefusal(clipId: string, context?: HandlerValidationContext): string | null {
    return getWritableMidiClipReplayGuardForBatch(clipId, context) === null
        ? describeUnwritableGrooveClip(clipId)
        : null;
}

function findApplicationRefusal(action: ApplyGrooveAction, context: HandlerValidationContext): string | null {
    return findTargetClipRefusal(action.payload.clipId, context) ?? planInBatch(action, context).refusal;
}

export const handleApplyGroove = createHandler<'applyGroove'>({
    validateSessionEntry: isApplyGrooveSessionEntry,
    validate: (action, context) => findApplicationRefusal(action, context) === null,
    validationRefusalReason: findApplicationRefusal,
    isNoop: (action) => {
        const expected = canonicalizeGrooveTemplateAssignment(getAssignmentInput(action));
        const current = getGrooveAssignment(getAssignmentInput(action));
        return (
            expected !== null &&
            current?.consumerType === expected.consumerType &&
            current.consumerId === expected.consumerId &&
            current.templateId === expected.templateId &&
            current.amount === expected.amount
        );
    },
    execute: (action, context) => {
        // Batch validation ran before any action did; an earlier one may have removed the clip
        // since, so the clip is read again as it is now. A lone dispatch keeps its unvalidated path.
        const ranAfterEarlierActions = (context?.actionIndex ?? 0) > 0;
        const targetRefusal = ranAfterEarlierActions ? findTargetClipRefusal(action.payload.clipId) : null;
        if (targetRefusal !== null) {
            return { status: 'conflict', reason: targetRefusal };
        }
        const result = assignGrooveTemplate(getAssignmentInput(action));
        if (!result.ok) {
            throw new Error(`Groove assignment rejected: ${result.error.code}`);
        }
        if (result.status === 'no-write') {
            return { status: 'no-write' };
        }
        return {
            status: 'written',
            afterCommit: markGrooveTemplateProjectWrite,
            afterAmbiguousCommit: markGrooveTemplateProjectWrite,
        };
    },
    describe: (action, context) => {
        // The assignment this application replaces is the one the earlier actions of its batch leave.
        const { assignment, priorAssignment } = planInBatch(action, context);
        return {
            label: `Assign groove "${action.payload.grooveId}"`,
            inverseAction: assignment
                ? {
                      type: 'restoreGrooveAssignment',
                      payload: {
                          consumerType: 'clip',
                          consumerId: assignment.consumerId,
                          assignment: priorAssignment,
                          expectedAssignment: assignment,
                      },
                  }
                : null,
        };
    },
    undoable: true,
});
