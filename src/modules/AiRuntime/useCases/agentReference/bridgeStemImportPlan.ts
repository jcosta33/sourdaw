import { type AppAction, type StemImportRole } from '#/utils/handlerContract';

import { type RuntimeAction } from '../../models/RuntimeAction';
import { type StemImportPromptScope, type StemImportProviderCall } from '../../models/StemImportCapability';
import { normalizeSafeProjectName } from '../../validators/normalizeSafeProjectName';

import { getStemImportMix } from './getStemImportMix';

type BridgeStemImportPlanResult =
    { status: 'accepted'; providerAction: RuntimeAction; action: AppAction } | { status: 'rejected'; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAllowedRole(value: string, allowedRoles: readonly StemImportRole[]): value is StemImportRole {
    return allowedRoles.some((role) => role === value);
}

export function bridgeStemImportPlan(
    calls: readonly StemImportProviderCall[],
    scope: StemImportPromptScope
): BridgeStemImportPlanResult {
    if (calls.length !== 1 || calls[0]?.name !== 'importStemSet') {
        return { status: 'rejected', reason: 'The provider must return exactly one importStemSet plan.' };
    }
    const args = calls[0].arguments;
    const groupName = normalizeSafeProjectName(args.groupName);
    if (args.selectionId !== scope.capability.selectionId || !groupName || !Array.isArray(args.stems)) {
        return { status: 'rejected', reason: 'The stem-import plan has invalid selection or group metadata.' };
    }
    const assignments = args.stems;
    if (assignments.length !== scope.capability.stems.length) {
        return { status: 'rejected', reason: 'The provider must classify every selected stem exactly once.' };
    }
    const assignmentById = new Map<string, StemImportRole>();
    const validatedAssignments: Array<{ stemId: string; role: StemImportRole }> = [];
    for (const assignment of assignments) {
        if (!isRecord(assignment) || typeof assignment.stemId !== 'string' || typeof assignment.role !== 'string') {
            return { status: 'rejected', reason: 'Each stem assignment must contain one stemId and role.' };
        }
        if (assignmentById.has(assignment.stemId)) {
            return { status: 'rejected', reason: 'The provider returned a duplicate stem assignment.' };
        }
        if (!isAllowedRole(assignment.role, scope.capability.allowedRoles)) {
            return { status: 'rejected', reason: `Unsupported stem role: ${assignment.role}` };
        }
        assignmentById.set(assignment.stemId, assignment.role);
        validatedAssignments.push({ stemId: assignment.stemId, role: assignment.role });
    }
    const expectedIds = scope.capability.stems.map((stem) => stem.stemId);
    if (expectedIds.some((stemId) => !assignmentById.has(stemId))) {
        return { status: 'rejected', reason: 'The provider omitted or enlarged the selected stem set.' };
    }
    const materializedStems = [];
    for (const stem of scope.actionSeed.stems) {
        const role = assignmentById.get(stem.stemId);
        if (!role) {
            return { status: 'rejected', reason: 'The provider omitted or enlarged the selected stem set.' };
        }
        const mix = getStemImportMix(role);
        materializedStems.push({ ...stem, role, trackGain: mix.gain, trackPan: mix.pan });
    }

    const providerAction: RuntimeAction = {
        type: 'importStemSet',
        payload: {
            selectionId: args.selectionId,
            groupName,
            stems: validatedAssignments,
        },
    };
    return {
        status: 'accepted',
        providerAction,
        action: {
            type: 'importStemSet',
            payload: {
                ...scope.actionSeed,
                groupName,
                stems: materializedStems,
            },
        },
    };
}
