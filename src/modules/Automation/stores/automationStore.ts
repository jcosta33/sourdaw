import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import {
    type AutomationCurveType,
    type AutomationLane,
    type AutomationObject,
    type AutomationPoint,
    type ClipAutomationMode,
} from '../models/Automation';

export type { AutomationCurveType, AutomationLane };

const DOC_PREFIX_ROOT = 'root';

export type AutomationStoreState = {
    lanes: AutomationLane[];
};

export const defaultAutomationStoreState: AutomationStoreState = { lanes: [] };

const AUTOMATION_STORE_STATE_KEYS = ['lanes'] as const;
const AUTOMATION_LANE_REQUIRED_KEYS = [
    'id',
    'trackId',
    'parameterId',
    'parameterName',
    'points',
    'objects',
    'visible',
    'enabled',
    'collapsed',
    'minValue',
    'maxValue',
] as const;
const AUTOMATION_LANE_OPTIONAL_KEYS = [
    'clipId',
    'clipAutomationMode',
    'trimPoints',
    'ghostPoints',
    'linkedLaneId',
    'linkScale',
    'viewMinValue',
    'viewMaxValue',
    'color',
] as const;
const AUTOMATION_POINT_REQUIRED_KEYS = ['beat', 'value', 'curve', 'tension'] as const;
const AUTOMATION_POINT_OPTIONAL_KEYS = ['id', 'stairSteps', 'cp1', 'cp2'] as const;
const AUTOMATION_CONTROL_POINT_KEYS = ['x', 'y'] as const;
const AUTOMATION_OBJECT_REQUIRED_KEYS = ['id', 'laneId', 'startBeat', 'endBeat', 'points', 'name'] as const;
const AUTOMATION_OBJECT_OPTIONAL_KEYS = ['poolId', 'loopLength', 'overrides'] as const;

type HasExactKeysInput = {
    value: object;
    required_keys: readonly string[];
    optional_keys?: readonly string[];
};

function has_exact_keys({ value, required_keys, optional_keys = [] }: HasExactKeysInput): boolean {
    const value_keys = Object.keys(value);
    const allowed_keys = new Set([...required_keys, ...optional_keys]);

    return required_keys.every((key) => Object.hasOwn(value, key)) && value_keys.every((key) => allowed_keys.has(key));
}

function is_unknown_array(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function is_dense_array<TValue>(
    array: unknown[],
    is_valid_element: (value: unknown) => value is TValue
): array is TValue[] {
    for (let index = 0; index < array.length; index += 1) {
        if (!Object.hasOwn(array, index) || !is_valid_element(array[index])) {
            return false;
        }
    }

    return true;
}

function is_finite_number(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function is_non_empty_string(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function is_finite_non_negative_number(value: unknown): value is number {
    return is_finite_number(value) && value >= 0;
}

/**
 * True when `points` is already ascending by beat. Used by the "already
 * well-formed" exact-shape checks below so that a lane whose fields all
 * validate but whose array order does not — e.g. a project file written by
 * another build, or a lane a remote CRDT sync patch whole-array-replaced —
 * still falls through to `normalize_automation_lane`'s repair path instead
 * of taking the identity fast path in `sanitize_automation_store_state` and
 * skipping `get_normalized_points`'s sort entirely.
 */
function is_sorted_by_beat(points: readonly { beat: number }[]): boolean {
    for (let index = 1; index < points.length; index += 1) {
        if (points[index]!.beat < points[index - 1]!.beat) {
            return false;
        }
    }

    return true;
}

function get_lane_values(value: unknown): unknown[] | null {
    if (value === null || typeof value !== 'object') {
        return null;
    }

    if (!('lanes' in value) || !is_unknown_array(value.lanes)) {
        return null;
    }

    return value.lanes;
}

function is_automation_curve_type(value: unknown): value is AutomationCurveType {
    return (
        value === 'linear' ||
        value === 'exponential' ||
        value === 'step' ||
        value === 's-curve' ||
        value === 'stairs' ||
        value === 'smooth' ||
        value === 'bezier'
    );
}

function is_clip_automation_mode(value: unknown): value is ClipAutomationMode {
    return value === 'additive' || value === 'multiplicative';
}

function is_control_point(value: unknown): value is { x: number; y: number } {
    return (
        value !== null &&
        typeof value === 'object' &&
        'x' in value &&
        is_finite_number(value.x) &&
        'y' in value &&
        is_finite_number(value.y)
    );
}

function is_exact_control_point(value: unknown): value is { x: number; y: number } {
    return is_control_point(value) && has_exact_keys({ value, required_keys: AUTOMATION_CONTROL_POINT_KEYS });
}

function normalize_control_point(value: { x: number; y: number }): { x: number; y: number } {
    return {
        x: value.x,
        y: value.y,
    };
}

function is_valid_automation_point(value: unknown): value is AutomationPoint {
    return (
        value !== null &&
        typeof value === 'object' &&
        'beat' in value &&
        is_finite_non_negative_number(value.beat) &&
        'value' in value &&
        is_finite_number(value.value) &&
        'curve' in value &&
        is_automation_curve_type(value.curve) &&
        'tension' in value &&
        is_finite_number(value.tension)
    );
}

function has_valid_automation_point_optionals(value: AutomationPoint): boolean {
    return (
        (!('id' in value) || is_non_empty_string(value.id)) &&
        (!('stairSteps' in value) || is_finite_non_negative_number(value.stairSteps)) &&
        (!('cp1' in value) || is_control_point(value.cp1)) &&
        (!('cp2' in value) || is_control_point(value.cp2))
    );
}

function is_exact_automation_point(value: unknown): value is AutomationPoint {
    return (
        is_valid_automation_point(value) &&
        has_valid_automation_point_optionals(value) &&
        has_exact_keys({
            value,
            required_keys: AUTOMATION_POINT_REQUIRED_KEYS,
            optional_keys: AUTOMATION_POINT_OPTIONAL_KEYS,
        }) &&
        (!('cp1' in value) || is_exact_control_point(value.cp1)) &&
        (!('cp2' in value) || is_exact_control_point(value.cp2))
    );
}

function normalize_automation_point(point: AutomationPoint): AutomationPoint {
    const normalized_point: AutomationPoint = {
        beat: point.beat,
        value: point.value,
        curve: point.curve,
        tension: point.tension,
    };

    if (is_non_empty_string(point.id)) {
        normalized_point.id = point.id;
    }

    if (is_finite_non_negative_number(point.stairSteps)) {
        normalized_point.stairSteps = point.stairSteps;
    }
    if (is_control_point(point.cp1)) {
        normalized_point.cp1 = normalize_control_point(point.cp1);
    }
    if (is_control_point(point.cp2)) {
        normalized_point.cp2 = normalize_control_point(point.cp2);
    }

    return normalized_point;
}

function get_normalized_points(points: unknown[]): AutomationPoint[] {
    // Every reader of `lane.points` (and `trimPoints`/`ghostPoints`) downstream
    // — this module's own binary-search insert in `addAutomationPoint.ts` and
    // the batched merge in `batchAddAutomationPoints.ts` — assumes the array is
    // ascending by beat and never re-sorts on entry. This is the only place to
    // enforce that: it is the inbound boundary every external source of truth
    // (a project file, a legacy import, or a remote peer's CRDT sync patch
    // during collaboration — `AutomationPoint` carries no id, so the CRDT
    // reconciler whole-array-replaces `points` verbatim) passes through before
    // any reader sees it.
    //
    // `Array.prototype.sort` is stable (guaranteed since ES2019), so two points
    // with an identical beat keep their original relative array order rather
    // than being shuffled. That is safe for every current reader: both binary
    // searches above only require non-decreasing beats and never depend on a
    // particular tie-break among equal beats.
    return points
        .filter(is_valid_automation_point)
        .map(normalize_automation_point)
        .sort((left, right) => left.beat - right.beat);
}

function is_boolean_overrides(value: unknown): value is { [key: string]: boolean } {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    return Object.values(value).every((override) => typeof override === 'boolean');
}

function normalize_overrides(value: { [key: string]: boolean }): { [key: string]: boolean } {
    return Object.fromEntries(Object.entries(value));
}

function is_valid_automation_object(value: unknown): value is AutomationObject {
    return (
        value !== null &&
        typeof value === 'object' &&
        'id' in value &&
        typeof value.id === 'string' &&
        'laneId' in value &&
        typeof value.laneId === 'string' &&
        'startBeat' in value &&
        is_finite_non_negative_number(value.startBeat) &&
        'endBeat' in value &&
        is_finite_non_negative_number(value.endBeat) &&
        value.endBeat >= value.startBeat &&
        'points' in value &&
        is_unknown_array(value.points) &&
        'name' in value &&
        typeof value.name === 'string'
    );
}

function has_valid_automation_object_optionals(value: AutomationObject): boolean {
    return (
        (!('poolId' in value) || typeof value.poolId === 'string') &&
        (!('loopLength' in value) || is_finite_non_negative_number(value.loopLength)) &&
        (!('overrides' in value) || is_boolean_overrides(value.overrides))
    );
}

function is_exact_automation_object(value: unknown): value is AutomationObject {
    return (
        is_valid_automation_object(value) &&
        has_valid_automation_object_optionals(value) &&
        has_exact_keys({
            value,
            required_keys: AUTOMATION_OBJECT_REQUIRED_KEYS,
            optional_keys: AUTOMATION_OBJECT_OPTIONAL_KEYS,
        }) &&
        is_dense_array(value.points, is_exact_automation_point) &&
        is_sorted_by_beat(value.points)
    );
}

function normalize_automation_object(object: AutomationObject): AutomationObject {
    const normalized_object: AutomationObject = {
        id: object.id,
        laneId: object.laneId,
        startBeat: object.startBeat,
        endBeat: object.endBeat,
        points: get_normalized_points(object.points),
        name: object.name,
    };

    if (typeof object.poolId === 'string') {
        normalized_object.poolId = object.poolId;
    }
    if (is_finite_non_negative_number(object.loopLength)) {
        normalized_object.loopLength = object.loopLength;
    }
    if (is_boolean_overrides(object.overrides)) {
        normalized_object.overrides = normalize_overrides(object.overrides);
    }

    return normalized_object;
}

function get_normalized_objects(objects: unknown[]): AutomationObject[] {
    return objects.filter(is_valid_automation_object).map(normalize_automation_object);
}

function is_valid_automation_lane(value: unknown): value is AutomationLane {
    return (
        value !== null &&
        typeof value === 'object' &&
        'id' in value &&
        typeof value.id === 'string' &&
        'trackId' in value &&
        typeof value.trackId === 'string' &&
        'parameterId' in value &&
        typeof value.parameterId === 'string' &&
        'parameterName' in value &&
        typeof value.parameterName === 'string' &&
        'points' in value &&
        is_unknown_array(value.points) &&
        'objects' in value &&
        is_unknown_array(value.objects) &&
        'visible' in value &&
        typeof value.visible === 'boolean' &&
        'enabled' in value &&
        typeof value.enabled === 'boolean' &&
        'collapsed' in value &&
        typeof value.collapsed === 'boolean' &&
        'minValue' in value &&
        is_finite_number(value.minValue) &&
        'maxValue' in value &&
        is_finite_number(value.maxValue) &&
        value.maxValue >= value.minValue
    );
}

function has_valid_automation_lane_optionals(value: AutomationLane): boolean {
    return (
        (!('clipId' in value) || typeof value.clipId === 'string') &&
        (!('clipAutomationMode' in value) || is_clip_automation_mode(value.clipAutomationMode)) &&
        (!('trimPoints' in value) || is_unknown_array(value.trimPoints)) &&
        (!('ghostPoints' in value) || is_unknown_array(value.ghostPoints)) &&
        (!('linkedLaneId' in value) || typeof value.linkedLaneId === 'string') &&
        (!('linkScale' in value) || is_finite_number(value.linkScale)) &&
        (!('viewMinValue' in value) || is_finite_number(value.viewMinValue)) &&
        (!('viewMaxValue' in value) || is_finite_number(value.viewMaxValue)) &&
        (!('color' in value) || typeof value.color === 'string')
    );
}

export function is_exact_automation_lane(value: unknown): value is AutomationLane {
    return (
        is_valid_automation_lane(value) &&
        has_valid_automation_lane_optionals(value) &&
        has_exact_keys({
            value,
            required_keys: AUTOMATION_LANE_REQUIRED_KEYS,
            optional_keys: AUTOMATION_LANE_OPTIONAL_KEYS,
        }) &&
        is_dense_array(value.points, is_exact_automation_point) &&
        is_sorted_by_beat(value.points) &&
        is_dense_array(value.objects, is_exact_automation_object) &&
        (!('trimPoints' in value) ||
            (is_unknown_array(value.trimPoints) &&
                is_dense_array(value.trimPoints, is_exact_automation_point) &&
                is_sorted_by_beat(value.trimPoints))) &&
        (!('ghostPoints' in value) ||
            (is_unknown_array(value.ghostPoints) &&
                is_dense_array(value.ghostPoints, is_exact_automation_point) &&
                is_sorted_by_beat(value.ghostPoints)))
    );
}

function normalize_automation_lane(lane: AutomationLane): AutomationLane {
    const normalized_lane: AutomationLane = {
        id: lane.id,
        trackId: lane.trackId,
        parameterId: lane.parameterId,
        parameterName: lane.parameterName,
        points: get_normalized_points(lane.points),
        objects: get_normalized_objects(lane.objects),
        visible: lane.visible,
        enabled: lane.enabled,
        collapsed: lane.collapsed,
        minValue: lane.minValue,
        maxValue: lane.maxValue,
    };

    if (typeof lane.clipId === 'string') {
        normalized_lane.clipId = lane.clipId;
    }
    if (is_clip_automation_mode(lane.clipAutomationMode)) {
        normalized_lane.clipAutomationMode = lane.clipAutomationMode;
    }
    if (is_unknown_array(lane.trimPoints)) {
        normalized_lane.trimPoints = get_normalized_points(lane.trimPoints);
    }
    if (is_unknown_array(lane.ghostPoints)) {
        normalized_lane.ghostPoints = get_normalized_points(lane.ghostPoints);
    }
    if (typeof lane.linkedLaneId === 'string') {
        normalized_lane.linkedLaneId = lane.linkedLaneId;
    }
    if (is_finite_number(lane.linkScale)) {
        normalized_lane.linkScale = lane.linkScale;
    }
    if (is_finite_number(lane.viewMinValue)) {
        normalized_lane.viewMinValue = lane.viewMinValue;
    }
    if (is_finite_number(lane.viewMaxValue)) {
        normalized_lane.viewMaxValue = lane.viewMaxValue;
    }
    if (typeof lane.color === 'string') {
        normalized_lane.color = lane.color;
    }

    return normalized_lane;
}

function is_exact_automation_store_state(value: unknown): value is AutomationStoreState {
    const lanes = get_lane_values(value);

    return (
        value !== null &&
        typeof value === 'object' &&
        has_exact_keys({ value, required_keys: AUTOMATION_STORE_STATE_KEYS }) &&
        lanes !== null &&
        is_dense_array(lanes, is_exact_automation_lane)
    );
}

export function sanitize_automation_store_state(value: unknown): AutomationStoreState {
    if (is_exact_automation_store_state(value)) {
        return value;
    }

    const lanes = get_lane_values(value);
    if (lanes === null) {
        return defaultAutomationStoreState;
    }

    return { lanes: lanes.filter(is_valid_automation_lane).map(normalize_automation_lane) };
}

export const automationStore = createStore<AutomationStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'automation', {
        // Audit CC-2 — projection default for a document without this slot, so
        // hydrate never writes the previous project's cache back into truth.
        hydrateMissing: () => defaultAutomationStoreState,
    }),
    initialData: defaultAutomationStoreState,
    sanitize: sanitize_automation_store_state,
});
