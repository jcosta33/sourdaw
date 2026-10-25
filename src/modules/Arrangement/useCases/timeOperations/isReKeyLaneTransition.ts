import { decodeExactTakeLaneSnapshots } from '../../stores/takeLaneStore';
import { type TakeReKeyLaneTransition } from '../comping/takeReKeyTransition';

const RE_KEY_LANE_TRANSITION_KEYS = [
    'laneId',
    'trackId',
    'takesBefore',
    'takesAfter',
    'regionsBefore',
    'regionsAfter',
] as const;

function isExactFacetPair(
    value: object,
    laneId: string,
    trackId: string,
    takesKey: string,
    regionsKey: string
): boolean {
    // The store decoder enforces exact takes and lawful, sorted comp regions.
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

export function isReKeyLaneTransition(value: unknown): value is TakeReKeyLaneTransition {
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
    if (
        typeof laneId !== 'string' ||
        laneId.trim().length === 0 ||
        typeof trackId !== 'string' ||
        trackId.trim().length === 0
    ) {
        return false;
    }
    return (
        isExactFacetPair(value, laneId, trackId, 'takesBefore', 'regionsBefore') &&
        isExactFacetPair(value, laneId, trackId, 'takesAfter', 'regionsAfter')
    );
}
