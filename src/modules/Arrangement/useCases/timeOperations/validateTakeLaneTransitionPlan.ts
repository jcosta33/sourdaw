import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

import { decodeExactTakeLaneSnapshots } from '../../stores/takeLaneStore';

import { type TakeLaneTransitionPlan } from './takeLaneTransitionPlan';

const TAKE_LANE_TRANSITION_KEYS = ['version', 'appliedEffect', 'removedClipIds', 'retiredLanes'] as const;

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

/**
 * Decode the take-lane slot of a restore plan, or null when it is not exactly
 * the shape `createTakeLaneTransitionPlan` wrote.
 */
export function validateTakeLaneTransitionPlan(value: unknown): TakeLaneTransitionPlan | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    if (
        Reflect.ownKeys(value).length !== TAKE_LANE_TRANSITION_KEYS.length ||
        !TAKE_LANE_TRANSITION_KEYS.every((key) => Object.hasOwn(value, key))
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
    return {
        version: 1,
        appliedEffect,
        removedClipIds,
        retiredLanes,
    };
}
