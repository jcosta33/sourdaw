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

function is_exact_sidechain_store_state(value: unknown): value is SidechainStoreState {
    const routes = get_route_values(value);

    return (
        value !== null &&
        typeof value === 'object' &&
        has_exact_keys(value, SIDECHAIN_STORE_STATE_KEYS) &&
        routes !== null &&
        routes.every((route) => is_valid_sidechain_route(route) && has_exact_keys(route, SIDECHAIN_ROUTE_KEYS))
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

    return { routes: routes.filter(is_valid_sidechain_route).map(normalize_sidechain_route) };
}

export const sidechainStore = createStore<SidechainStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'sidechainRoutes'),
    initialData: defaultSidechainStoreState,
    sanitize: sanitize_sidechain_store_state,
});
