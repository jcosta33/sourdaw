import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

import { decodeExactTakeLaneSnapshots } from '../../stores/takeLaneStore';
import { type TakeReKeyLaneTransition } from '../comping/takeReKeyTransition';

import { type TakeLaneTransitionPlan } from './takeLaneTransitionPlan';

const TAKE_LANE_TRANSITION_KEYS = ['version', 'appliedEffect', 'removedClipIds', 'retiredLanes'] as const;
// Optional so plans written before take re-keying joined the operation (#4841)
// keep their exact-key shape; absent means the operation re-keyed nothing.
const TAKE_LANE_TRANSITION_OPTIONAL_KEYS = ['reKeyedLanes'] as const;
const RE_KEY_LANE_TRANSITION_KEYS = [
    'laneId',
    'trackId',
    'takesBefore',
    'takesAfter',
    'regionsBefore',
    'regionsAfter',
] as const;

function isNonEmptyId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isIdArray(value: unknown): value is readonly string[] {
    return Array.isArray(value) && value.every(isNonEmptyId);
}

function isRetiredLaneSnapshot(value: unknown): value is RetiredTakeLaneSnapshot {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const laneIndex: unknown = Reflect.get(value, 'laneIndex');
    if (typeof laneIndex !== 'number' || !Number.isFinite(laneIndex) || laneIndex < 0) {
        return false;
    }
    // The lane rides the plan into a later session, so it must decode as an
    // exact store-shape lane — the same bar the store's own sanitizer holds
    // hydrated lanes to.
    if (decodeExactTakeLaneSnapshots([Reflect.get(value, 'lane')]) === null) {
        return false;
    }
    const retiredTakeIds: unknown = Reflect.get(value, 'retiredTakeIds');
    return retiredTakeIds === undefined || isIdArray(retiredTakeIds);
}

function isExactFacetPair(
    value: object,
    laneId: string,
    trackId: string,
    takesKey: string,
    regionsKey: string
): boolean {
    // Both facet sides ride the plan, so each must decode against the same bar
    // as a hydrated lane: exact takes, and regions sorted, non-overlapping, and
    // naming only takes the same side holds — the writer's reconcile depends on
    // all three.
    const takes: unknown = Reflect.get(value, takesKey);
    const activeCompRegions: unknown = Reflect.get(value, regionsKey);
    const skeleton = {
        id: laneId,
        trackId,
        takes,
        activeCompRegions,
    };
    return decodeExactTakeLaneSnapshots([skeleton]) !== null;
}

function isReKeyLaneTransition(value: unknown): value is TakeReKeyLaneTransition {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (
        Reflect.ownKeys(value).length !== RE_KEY_LANE_TRANSITION_KEYS.length ||
        !RE_KEY_LANE_TRANSITION_KEYS.every((key) => Object.hasOwn(value, key))
    ) {
        return false;
    }
    const laneId: unknown = Reflect.get(value, 'laneId');
    const trackId: unknown = Reflect.get(value, 'trackId');
    if (!isNonEmptyId(laneId) || !isNonEmptyId(trackId)) {
        return false;
    }
    return (
        isExactFacetPair(value, laneId, trackId, 'takesBefore', 'regionsBefore') &&
        isExactFacetPair(value, laneId, trackId, 'takesAfter', 'regionsAfter')
    );
}

/**
 * Decode the take-lane slot of a restore plan, or null when it is not exactly
 * the shape `createTakeLaneTransitionPlan` wrote.
 */
export function validateTakeLaneTransitionPlan(value: unknown): TakeLaneTransitionPlan | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const keyCount = Reflect.ownKeys(value).length;
    if (
        keyCount < TAKE_LANE_TRANSITION_KEYS.length ||
        keyCount > TAKE_LANE_TRANSITION_KEYS.length + TAKE_LANE_TRANSITION_OPTIONAL_KEYS.length ||
        !TAKE_LANE_TRANSITION_KEYS.every((key) => Object.hasOwn(value, key)) ||
        !Reflect.ownKeys(value).every(
            (key) =>
                (TAKE_LANE_TRANSITION_KEYS as readonly PropertyKey[]).includes(key) ||
                (TAKE_LANE_TRANSITION_OPTIONAL_KEYS as readonly PropertyKey[]).includes(key)
        )
    ) {
        return null;
    }
    if (Reflect.get(value, 'version') !== 1) {
        return null;
    }
    const appliedEffect: unknown = Reflect.get(value, 'appliedEffect');
    if (appliedEffect !== 'restore' && appliedEffect !== 'retire') {
        return null;
    }
    const removedClipIds: unknown = Reflect.get(value, 'removedClipIds');
    const retiredLanes: unknown = Reflect.get(value, 'retiredLanes');
    if (!isIdArray(removedClipIds) || !Array.isArray(retiredLanes) || !retiredLanes.every(isRetiredLaneSnapshot)) {
        return null;
    }
    const reKeyedLanesValue: unknown = Reflect.get(value, 'reKeyedLanes');
    if (reKeyedLanesValue !== undefined) {
        if (!Array.isArray(reKeyedLanesValue) || !reKeyedLanesValue.every(isReKeyLaneTransition)) {
            return null;
        }
    }
    const plan: TakeLaneTransitionPlan = {
        version: 1,
        appliedEffect,
        removedClipIds,
        retiredLanes,
    };
    if (reKeyedLanesValue !== undefined) {
        plan.reKeyedLanes = reKeyedLanesValue;
    }
    return plan;
}
