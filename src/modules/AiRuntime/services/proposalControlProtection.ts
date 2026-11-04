import { type ProjectContext } from '../models/ProjectContext';
import { type ProposalProtectionFacts } from '../models/ProposalGroundingBasis';

type Control = ProposalProtectionFacts['protectedControls'][number];
type Lane = NonNullable<ProjectContext['automationLanes']>[number];
type Effect = { trackId: string; operations: string[] };
type AddEffect = (trackId: string, operation: string) => void;
type EffectInput = {
    actionType: string;
    payload: Readonly<Record<string, unknown>>;
    context: ProjectContext;
    declaredOwners: readonly string[];
    automation: boolean;
    laneTargetIds: readonly string[];
};

/** Persisted operation names remain readable while equivalent mixer writes compare by one control. */
function canonicalOperation(operation: string): string {
    switch (operation) {
        case 'automateTrackGainRange':
        case 'setVcaGain':
            return 'setTrackGain';
        case 'addSend':
        case 'removeSend':
        case 'automateSendRange':
        case 'automateSendRanges':
            return 'setSend';
        default:
            return operation;
    }
}

function parameterOperation(parameterId: string, fallback: string): string {
    if (parameterId === 'gain') {
        return 'setTrackGain';
    }
    if (parameterId === 'pan') {
        return 'setTrackPan';
    }
    return parameterId.startsWith('send:') ? 'setSend' : fallback;
}

/**
 * Whether this operation changes source points, which linked lanes read instead of their own.
 * Followers read those points independently of the source lane's enabled flag and track automation mode.
 */
function changesLinkedValues(actionType: string): boolean {
    return !['addAutomationLane', 'setAutomationLaneEnabled', 'setAutomationMode'].includes(actionType);
}

function collectParameterRoots(lanes: readonly Lane[], roots: Set<string>, trackId: string, parameterId: string): void {
    for (const lane of lanes) {
        if (lane.clipId === undefined && lane.trackId === trackId && lane.parameterId === parameterId) {
            roots.add(lane.id);
        }
    }
}

function collectAutomationEffects(
    input: EffectInput,
    lanes: readonly Lane[],
    roots: Set<string>,
    add: AddEffect
): void {
    const { actionType, payload, declaredOwners, laneTargetIds } = input;
    const addLane = (lane: Lane) => {
        add(lane.trackId, lane.clipId === undefined ? parameterOperation(lane.parameterId, actionType) : actionType);
        roots.add(lane.id);
    };
    for (const lane of lanes) {
        if (laneTargetIds.includes(lane.id)) {
            addLane(lane);
        }
    }
    if (typeof payload.parameterId === 'string' && typeof payload.trackId === 'string') {
        const trackId = payload.trackId;
        const parameterId = payload.parameterId;
        if (declaredOwners.includes(trackId)) {
            add(trackId, parameterOperation(parameterId, actionType));
            collectParameterRoots(lanes, roots, trackId, parameterId);
        }
    } else if (
        actionType === 'automateTrackGainRange' ||
        actionType === 'automateSendRange' ||
        actionType === 'automateSendRanges'
    ) {
        const parameterId = actionType === 'automateTrackGainRange' ? 'gain' : `send:${String(payload.busId)}`;
        for (const owner of declaredOwners) {
            add(owner, canonicalOperation(actionType));
            collectParameterRoots(lanes, roots, owner, parameterId);
        }
    } else if (actionType === 'setAutomationMode') {
        for (const lane of lanes) {
            if (declaredOwners.includes(lane.trackId)) {
                addLane(lane);
            }
        }
    }
}

function collectLinkedEffects(
    actionType: string,
    lanes: readonly Lane[],
    roots: ReadonlySet<string>,
    add: AddEffect
): void {
    if (changesLinkedValues(actionType)) {
        // The reverse walk is bounded by current lane ids, including malformed cycles.
        const visited = new Set(roots);
        const pending = [...roots];
        for (let index = 0; index < pending.length; index++) {
            const sourceId = pending[index];
            for (const lane of lanes) {
                if (lane.linkedLaneId !== sourceId || visited.has(lane.id)) {
                    continue;
                }
                visited.add(lane.id);
                pending.push(lane.id);
                add(
                    lane.trackId,
                    lane.clipId === undefined ? parameterOperation(lane.parameterId, actionType) : actionType
                );
            }
        }
    }
}

/**
 * Actual controls stay paired with their owner. Registry declarations supply the mutation owners,
 * automation dimension and lane targets; current lane metadata supplies the parameter and links.
 */
function readEffects(input: EffectInput): Effect[] {
    const { actionType, context, declaredOwners, automation } = input;
    const effects = new Map<string, Set<string>>();
    const add = (trackId: string, operation: string) => {
        const operations = effects.get(trackId) ?? new Set<string>();
        operations.add(operation);
        effects.set(trackId, operations);
    };
    if (!automation) {
        for (const owner of declaredOwners) {
            add(owner, canonicalOperation(actionType));
        }
        return Array.from(effects, ([trackId, operations]) => ({ trackId, operations: [...operations] }));
    }

    const lanes = context.automationLanes ?? [];
    const roots = new Set<string>();
    collectAutomationEffects(input, lanes, roots, add);
    collectLinkedEffects(actionType, lanes, roots, add);
    for (const owner of declaredOwners) {
        if (!effects.has(owner)) {
            add(owner, actionType);
        }
    }
    return Array.from(effects, ([trackId, operations]) => ({ trackId, operations: [...operations] }));
}

/** A normal protection forbids any matching effect; an exemption must cover every actual effect. */
function matches(control: Control, actionType: string, operations: readonly string[]): boolean {
    const declared = control.exceptOperations ?? control.operations;
    // Old facts may name a dynamic automation operation itself rather than a mixer control.
    if (declared.includes(actionType)) {
        return control.exceptOperations === undefined;
    }
    const canonical = new Set(declared.map(canonicalOperation));
    if (control.exceptOperations !== undefined) {
        return operations.some((operation) => !canonical.has(canonicalOperation(operation)));
    }
    return operations.some((operation) => canonical.has(canonicalOperation(operation)));
}

export const proposalControlProtection = { readEffects, matches };
