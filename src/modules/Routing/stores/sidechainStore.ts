import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import { type SidechainRoute } from '../models/SidechainRoute';

const DOC_PREFIX_ROOT = 'root';

export type SidechainStoreState = {
    routes: SidechainRoute[];
};

export const defaultSidechainStoreState: SidechainStoreState = { routes: [] };

const SIDECHAIN_STORE_STATE_KEYS = ['routes'] as const;
const SIDECHAIN_ROUTE_KEYS = [
    'id',
    'sourceTrackId',
    'targetTrackId',
    'targetDeviceId',
    'targetParameterId',
    'gain',
] as const;

function has_exact_keys(value: object, keys: readonly string[]): boolean {
    const value_keys = Object.keys(value);
    return value_keys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function is_unknown_array(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function get_record(value: unknown): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object') {
        return null;
    }

    return value as Record<string, unknown>;
}

function get_route_values(value: unknown): unknown[] | null {
    const record = get_record(value);
    if (record === null) {
        return null;
    }

    if (!is_unknown_array(record.routes)) {
        return null;
    }

    return record.routes;
}

function is_valid_sidechain_route(value: unknown): value is SidechainRoute {
    return (
        value !== null &&
        typeof value === 'object' &&
        'id' in value &&
        typeof value.id === 'string' &&
        'sourceTrackId' in value &&
        typeof value.sourceTrackId === 'string' &&
        'targetTrackId' in value &&
        typeof value.targetTrackId === 'string' &&
        'targetDeviceId' in value &&
        typeof value.targetDeviceId === 'string' &&
        'targetParameterId' in value &&
        typeof value.targetParameterId === 'string' &&
        'gain' in value &&
        typeof value.gain === 'number' &&
        Number.isFinite(value.gain)
    );
}

function normalize_sidechain_route(route: SidechainRoute): SidechainRoute {
    return {
        id: route.id,
        sourceTrackId: route.sourceTrackId,
        targetTrackId: route.targetTrackId,
        targetDeviceId: route.targetDeviceId,
        targetParameterId: route.targetParameterId,
        gain: route.gain,
    };
}

function get_sidechain_runtime_key(route: SidechainRoute): string {
    return JSON.stringify([route.sourceTrackId, route.targetDeviceId]);
}

function get_sidechain_route_sort_key(route: SidechainRoute): string {
    return JSON.stringify([
        route.id,
        route.sourceTrackId,
        route.targetTrackId,
        route.targetDeviceId,
        route.targetParameterId,
        route.gain,
    ]);
}

function has_unique_sidechain_routes(routes: readonly SidechainRoute[]): boolean {
    const route_ids = new Set<string>();
    const runtime_keys = new Set<string>();
    for (const route of routes) {
        const runtime_key = get_sidechain_runtime_key(route);
        if (route_ids.has(route.id) || runtime_keys.has(runtime_key)) {
            return false;
        }
        route_ids.add(route.id);
        runtime_keys.add(runtime_key);
    }
    return true;
}

function canonicalize_sidechain_routes(values: readonly unknown[]): SidechainRoute[] {
    const routes = values.filter(is_valid_sidechain_route).map(normalize_sidechain_route);
    if (has_unique_sidechain_routes(routes)) {
        return routes;
    }

    const sorted_routes = [...routes].sort((left, right) => {
        const left_key = get_sidechain_route_sort_key(left);
        const right_key = get_sidechain_route_sort_key(right);
        if (left_key < right_key) {
            return -1;
        }
        if (left_key > right_key) {
            return 1;
        }
        return 0;
    });
    const route_ids = new Set<string>();
    const runtime_keys = new Set<string>();
    return sorted_routes.filter((route) => {
        const runtime_key = get_sidechain_runtime_key(route);
        if (route_ids.has(route.id) || runtime_keys.has(runtime_key)) {
            return false;
        }
        route_ids.add(route.id);
        runtime_keys.add(runtime_key);
        return true;
    });
}

function is_exact_sidechain_route_array(routes: unknown[]): routes is SidechainRoute[] {
    return routes.every((route) => is_valid_sidechain_route(route) && has_exact_keys(route, SIDECHAIN_ROUTE_KEYS));
}

function is_exact_sidechain_store_state(value: unknown): value is SidechainStoreState {
    const routes = get_route_values(value);

    return (
        value !== null &&
        typeof value === 'object' &&
        has_exact_keys(value, SIDECHAIN_STORE_STATE_KEYS) &&
        routes !== null &&
        is_exact_sidechain_route_array(routes) &&
        has_unique_sidechain_routes(routes)
    );
}

export function sanitize_sidechain_store_state(value: unknown): SidechainStoreState {
    if (is_exact_sidechain_store_state(value)) {
        return value;
    }

    const routes = get_route_values(value);
    if (routes === null) {
        return defaultSidechainStoreState;
    }

    return { routes: canonicalize_sidechain_routes(routes) };
}

export const sidechainStore = createStore<SidechainStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'sidechainRoutes', {
        // Audit CC-2 — projection default for a document without this slot, so
        // hydrate never writes the previous project's cache back into truth.
        hydrateMissing: () => defaultSidechainStoreState,
    }),
    initialData: defaultSidechainStoreState,
    sanitize: sanitize_sidechain_store_state,
});
