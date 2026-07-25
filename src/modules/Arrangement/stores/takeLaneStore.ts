import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import { type CompRegion, type Take, type TakeLane } from '../models/TakeLane';

const DOC_PREFIX_ROOT = 'root';

export type TakeLaneStoreState = {
    lanes: TakeLane[];
};

export const defaultTakeLaneStoreState: TakeLaneStoreState = { lanes: [] };

const TAKE_LANE_STORE_STATE_KEYS = ['lanes'] as const;
const TAKE_LANE_REQUIRED_KEYS = ['id', 'trackId', 'takes', 'activeCompRegions'] as const;
const TAKE_LANE_OPTIONAL_KEYS = ['automationLaneId'] as const;
const TAKE_KEYS = ['id', 'clipId', 'name', 'startBeat', 'endBeat', 'selected'] as const;
const COMP_REGION_KEYS = ['startBeat', 'endBeat', 'takeId'] as const;

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

function is_finite_non_negative_number(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function is_unknown_array(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function get_lane_values(value: unknown): unknown[] | null {
    if (value === null || typeof value !== 'object') {
        return null;
    }

    if (!('lanes' in value)) {
        return null;
    }

    if (!is_unknown_array(value.lanes)) {
        return null;
    }

    return value.lanes;
}

function is_valid_take(value: unknown): value is Take {
    return (
        value !== null &&
        typeof value === 'object' &&
        'id' in value &&
        typeof value.id === 'string' &&
        'clipId' in value &&
        typeof value.clipId === 'string' &&
        'name' in value &&
        typeof value.name === 'string' &&
        'startBeat' in value &&
        is_finite_non_negative_number(value.startBeat) &&
        'endBeat' in value &&
        is_finite_non_negative_number(value.endBeat) &&
        value.endBeat >= value.startBeat &&
        'selected' in value &&
        typeof value.selected === 'boolean'
    );
}

function is_exact_take(value: unknown): value is Take {
    return is_valid_take(value) && has_exact_keys({ value, required_keys: TAKE_KEYS });
}

function normalize_take(take: Take): Take {
    return {
        id: take.id,
        clipId: take.clipId,
        name: take.name,
        startBeat: take.startBeat,
        endBeat: take.endBeat,
        selected: take.selected,
    };
}

function is_valid_comp_region(value: unknown): value is CompRegion {
    return (
        value !== null &&
        typeof value === 'object' &&
        'startBeat' in value &&
        is_finite_non_negative_number(value.startBeat) &&
        'endBeat' in value &&
        is_finite_non_negative_number(value.endBeat) &&
        value.endBeat >= value.startBeat &&
        'takeId' in value &&
        typeof value.takeId === 'string'
    );
}

function is_exact_comp_region(value: unknown): value is CompRegion {
    return is_valid_comp_region(value) && has_exact_keys({ value, required_keys: COMP_REGION_KEYS });
}

function normalize_comp_region(region: CompRegion): CompRegion {
    return {
        startBeat: region.startBeat,
        endBeat: region.endBeat,
        takeId: region.takeId,
    };
}

type SanitizableTakeLane = {
    id: string;
    trackId: string;
    automationLaneId?: string;
    takes: unknown[];
    activeCompRegions: unknown[];
};

function get_sanitizable_take_lane(value: unknown): SanitizableTakeLane | null {
    if (value === null || typeof value !== 'object') {
        return null;
    }

    if (!('id' in value) || typeof value.id !== 'string') {
        return null;
    }

    if (!('trackId' in value) || typeof value.trackId !== 'string') {
        return null;
    }

    if (!('takes' in value) || !is_unknown_array(value.takes)) {
        return null;
    }

    if (!('activeCompRegions' in value) || !is_unknown_array(value.activeCompRegions)) {
        return null;
    }

    if ('automationLaneId' in value && typeof value.automationLaneId !== 'string') {
        return null;
    }

    if ('automationLaneId' in value && typeof value.automationLaneId === 'string') {
        return {
            id: value.id,
            trackId: value.trackId,
            automationLaneId: value.automationLaneId,
            takes: value.takes,
            activeCompRegions: value.activeCompRegions,
        };
    }

    return {
        id: value.id,
        trackId: value.trackId,
        takes: value.takes,
        activeCompRegions: value.activeCompRegions,
    };
}

function is_sanitizable_take_lane(value: SanitizableTakeLane | null): value is SanitizableTakeLane {
    return value !== null;
}

function get_normalized_takes(takes: unknown[]): Take[] {
    return takes.filter(is_valid_take).map(normalize_take);
}

function retain_non_overlapping_regions(regions: CompRegion[]): CompRegion[] {
    const retained_regions: CompRegion[] = [];

    for (const region of regions) {
        const previous_region = retained_regions[retained_regions.length - 1];
        if (previous_region === undefined || previous_region.endBeat <= region.startBeat) {
            retained_regions.push(region);
        }
    }

    return retained_regions;
}

function get_normalized_comp_regions(regions: unknown[], take_ids: ReadonlySet<string>): CompRegion[] {
    return retain_non_overlapping_regions(
        regions
            .filter(is_valid_comp_region)
            .filter((region) => take_ids.has(region.takeId))
            .map(normalize_comp_region)
            .sort((alpha, buffer) => alpha.startBeat - buffer.startBeat)
    );
}

function are_sorted_non_overlapping_regions(regions: CompRegion[]): boolean {
    let previous_end_beat = Number.NEGATIVE_INFINITY;

    for (const region of regions) {
        if (region.startBeat < previous_end_beat) {
            return false;
        }
        previous_end_beat = region.endBeat;
    }

    return true;
}

function is_exact_take_lane(value: unknown): value is TakeLane {
    const take_lane = get_sanitizable_take_lane(value);
    const takes = get_normalized_takes(take_lane?.takes ?? []);
    const regions = take_lane?.activeCompRegions.filter(is_exact_comp_region) ?? [];
    const take_ids = new Set(takes.map((take) => take.id));

    return (
        take_lane !== null &&
        value !== null &&
        typeof value === 'object' &&
        (!('automationLaneId' in value) || typeof value.automationLaneId === 'string') &&
        has_exact_keys({
            value,
            required_keys: TAKE_LANE_REQUIRED_KEYS,
            optional_keys: TAKE_LANE_OPTIONAL_KEYS,
        }) &&
        takes.length === take_lane.takes.length &&
        take_lane.takes.every(is_exact_take) &&
        regions.length === take_lane.activeCompRegions.length &&
        regions.every((region) => take_ids.has(region.takeId)) &&
        are_sorted_non_overlapping_regions(regions)
    );
}

function normalize_take_lane(take_lane: SanitizableTakeLane): TakeLane {
    const takes = get_normalized_takes(take_lane.takes);
    const take_ids = new Set(takes.map((take) => take.id));
    const active_comp_regions = get_normalized_comp_regions(take_lane.activeCompRegions, take_ids);

    if (take_lane.automationLaneId !== undefined) {
        return {
            id: take_lane.id,
            trackId: take_lane.trackId,
            automationLaneId: take_lane.automationLaneId,
            takes,
            activeCompRegions: active_comp_regions,
        };
    }

    return {
        id: take_lane.id,
        trackId: take_lane.trackId,
        takes,
        activeCompRegions: active_comp_regions,
    };
}

function is_exact_take_lane_store_state(value: unknown): value is TakeLaneStoreState {
    const lanes = get_lane_values(value);

    return (
        value !== null &&
        typeof value === 'object' &&
        has_exact_keys({ value, required_keys: TAKE_LANE_STORE_STATE_KEYS }) &&
        lanes !== null &&
        lanes.every(is_exact_take_lane)
    );
}

export function sanitize_take_lane_store_state(value: unknown): TakeLaneStoreState {
    if (is_exact_take_lane_store_state(value)) {
        return value;
    }

    const lanes = get_lane_values(value);
    if (lanes === null) {
        return defaultTakeLaneStoreState;
    }

    return {
        lanes: lanes.map(get_sanitizable_take_lane).filter(is_sanitizable_take_lane).map(normalize_take_lane),
    };
}

export const takeLaneStore = createStore<TakeLaneStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'takeLanes', {
        // Audit CC-2 — projection default for a document without this slot, so
        // hydrate never writes the previous project's cache back into truth.
        hydrateMissing: () => defaultTakeLaneStoreState,
    }),
    initialData: defaultTakeLaneStoreState,
    sanitize: sanitize_take_lane_store_state,
});
