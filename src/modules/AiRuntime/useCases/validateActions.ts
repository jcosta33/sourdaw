import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { trackStore, vcaGroupStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { isLinearGainAutomationLane } from '#/modules/Automation/useCases';

import {
    RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS,
    RUNTIME_ACTION_OVERRIDE_REQUIRED_PAYLOAD_KEYS,
    RUNTIME_ACTION_TYPES,
    type RuntimeAction,
    type RuntimeActionType,
} from '../models/RuntimeAction';

import { PAYLOAD_VALIDATORS, type PayloadValidator } from './validateActionPayload';

const KNOWN_ACTION_TYPES: ReadonlySet<RuntimeActionType> = new Set(RUNTIME_ACTION_TYPES);

type RuntimePayloadOverrideType = keyof typeof RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS;

function isRuntimePayloadOverrideType(actionType: RuntimeActionType): actionType is RuntimePayloadOverrideType {
    return actionType in RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS;
}

function hasOnlyInitiatingPayloadKeys(action: RuntimeAction): boolean {
    if (!isRuntimePayloadOverrideType(action.type)) {
        return true;
    }

    const payload: unknown = action.payload;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return false;
    }

    const requiredKeys: readonly string[] = RUNTIME_ACTION_OVERRIDE_REQUIRED_PAYLOAD_KEYS[action.type];
    if (!requiredKeys.every((key) => Object.hasOwn(payload, key))) {
        return false;
    }

    const allowedKeys: readonly string[] = RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS[action.type];
    return Reflect.ownKeys(payload).every((key) => typeof key === 'string' && allowedKeys.includes(key));
}

/**
 * Decibels describe a gain amplitude and nothing else. A lane holding pan
 * positions, a cutoff in hertz, or a time in milliseconds has no decibel
 * reading, and a lane whose gain is *already* stored in decibels would take the
 * conversion twice. Only the payload validator's own view is too narrow to see
 * which of those a `laneId` names, so the lane is resolved here, where the
 * stores are.
 */
function addressesGainLaneForDecibels(action: RuntimeAction): boolean {
    if (action.type !== 'addAutomationPoint') {
        return true;
    }
    if (action.payload.valueDb === undefined && action.payload.deltaDb === undefined) {
        return true;
    }
    const lane = automationStore.value?.lanes.find((candidate) => candidate.id === action.payload.laneId);
    return lane !== undefined && isLinearGainAutomationLane(lane);
}

const UNAWAITED_AI_ACTION_TYPES: ReadonlySet<RuntimeActionType> = new Set([
    'exportProject',
    'importAudioFile',
    'importMidiFile',
    'leaveCollabSession',
    'newProject',
    'saveProject',
]);

function hasAvailableVcaTargets(action: RuntimeAction): boolean {
    const tracks = trackStore.value?.tracks ?? [];
    const groups = vcaGroupStore.value?.groups ?? [];

    if (action.type === 'createVcaGroup') {
        return action.payload.trackIds.every((trackId) => tracks.some((track) => track.id === trackId));
    }

    if (action.type === 'assignToVca') {
        const trackExists = tracks.some((track) => track.id === action.payload.trackId);
        const groupExists = groups.some((group) => group.id === action.payload.vcaGroupId);
        return trackExists && groupExists;
    }

    if (action.type === 'removeFromVca') {
        return tracks.some((track) => track.id === action.payload.trackId);
    }

    if (action.type === 'setVcaGain') {
        return groups.some((group) => group.id === action.payload.vcaGroupId);
    }

    return true;
}

export const validateActions = inject({ logger })(
    ({ logger }) =>
        function validateActions(actions: RuntimeAction[]): RuntimeAction[] {
            return actions.filter((action) => {
                if (!KNOWN_ACTION_TYPES.has(action.type)) {
                    logger.warn(`Unknown action type rejected: ${action.type}`);
                    return false;
                }

                if (UNAWAITED_AI_ACTION_TYPES.has(action.type)) {
                    logger.warn(`Unawaited AI action rejected: ${action.type}`);
                    return false;
                }

                if (!hasOnlyInitiatingPayloadKeys(action)) {
                    logger.warn(`Command-owned payload fields rejected for action ${action.type}`);
                    return false;
                }

                // §91.1 — Per-action payload validation. PAYLOAD_VALIDATORS
                // is a \`satisfies Record<RuntimeActionType, ...>\` so every
                // action type is either paired with a real runtime guard
                // or explicitly marked 'unchecked'. This replaces the
                // three inline checks that used to cover setTempo,
                // setMasterGain, and setMetronomeVolume — now each of the
                // ~230 action types has an explicit, compile-time-enforced
                // decision about whether its payload is validated.
                const validator = PAYLOAD_VALIDATORS[action.type];
                if (validator !== 'unchecked') {
                    // Keep the type-guard signature so the narrowing isn't
                    // discarded: indexing PAYLOAD_VALIDATORS with the `action.type`
                    // union yields a union of `PayloadValidator<…>`; widen only the
                    // *parameter* to `unknown` (validators accept `unknown` already)
                    // while preserving the `payload is …` predicate. A bare
                    // `(p: unknown) => boolean` cast would throw away the guard.
                    const guard = validator as PayloadValidator<RuntimeActionType>;
                    if (!guard(action.payload)) {
                        logger.warn(`Invalid payload for action ${action.type}`);
                        return false;
                    }
                }

                if (!hasAvailableVcaTargets(action)) {
                    logger.warn(`Unavailable target for action ${action.type}`);
                    return false;
                }

                if (!addressesGainLaneForDecibels(action)) {
                    logger.warn(`Decibel value rejected for a non-gain automation lane: ${action.type}`);
                    return false;
                }

                return true;
            });
        }
);
