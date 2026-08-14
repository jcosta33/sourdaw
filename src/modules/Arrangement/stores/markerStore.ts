import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import { type ArrangementSection, type Marker } from '../models/Marker';

const DOC_PREFIX_ROOT = 'root';

// F14: `Marker`/`ArrangementSection` are the single source of truth in
// `models/Marker.ts` — re-exported here (rather than redeclared) so a field
// added to one no longer compiles independently of the other.
export type { ArrangementSection, Marker };

export type MarkerStoreState = {
    markers: Marker[];
    sections: ArrangementSection[];
};

export const defaultMarkerStoreState: MarkerStoreState = { markers: [], sections: [] };

const MARKER_STORE_STATE_KEYS = ['markers', 'sections'] as const;
const MARKER_KEYS = ['id', 'beat', 'name', 'color'] as const;
const ARRANGEMENT_SECTION_KEYS = ['id', 'startBeat', 'endBeat', 'name', 'color'] as const;

function has_exact_keys(value: object, keys: readonly string[]): boolean {
    const value_keys = Object.keys(value);
    return value_keys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function is_finite_non_negative_number(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
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

function get_marker_values(value: unknown): unknown[] | null {
    const record = get_record(value);
    if (record === null) {
        return null;
    }

    if (!is_unknown_array(record.markers)) {
        return null;
    }

    return record.markers;
}

function get_section_values(value: unknown): unknown[] | null {
    const record = get_record(value);
    if (record === null) {
        return null;
    }

    if (!is_unknown_array(record.sections)) {
        return null;
    }

    return record.sections;
}

function is_valid_marker(value: unknown): value is Marker {
    return (
        value !== null &&
        typeof value === 'object' &&
        'id' in value &&
        typeof value.id === 'string' &&
        'beat' in value &&
        is_finite_non_negative_number(value.beat) &&
        'name' in value &&
        typeof value.name === 'string' &&
        'color' in value &&
        typeof value.color === 'string'
    );
}

function is_valid_arrangement_section(value: unknown): value is ArrangementSection {
    return (
        value !== null &&
        typeof value === 'object' &&
        'id' in value &&
        typeof value.id === 'string' &&
        'startBeat' in value &&
        is_finite_non_negative_number(value.startBeat) &&
        'endBeat' in value &&
        is_finite_non_negative_number(value.endBeat) &&
        value.endBeat >= value.startBeat &&
        'name' in value &&
        typeof value.name === 'string' &&
        'color' in value &&
        typeof value.color === 'string'
    );
}

function normalize_marker(marker: Marker): Marker {
    return {
        id: marker.id,
        beat: marker.beat,
        name: marker.name,
        color: marker.color,
    };
}

function normalize_arrangement_section(section: ArrangementSection): ArrangementSection {
    return {
        id: section.id,
        startBeat: section.startBeat,
        endBeat: section.endBeat,
        name: section.name,
        color: section.color,
    };
}

function is_exact_marker_store_state(value: unknown): value is MarkerStoreState {
    const markers = get_marker_values(value);
    const sections = get_section_values(value);

    return (
        value !== null &&
        typeof value === 'object' &&
        has_exact_keys(value, MARKER_STORE_STATE_KEYS) &&
        markers !== null &&
        markers.every((marker) => is_valid_marker(marker) && has_exact_keys(marker, MARKER_KEYS)) &&
        sections !== null &&
        sections.every(
            (section) => is_valid_arrangement_section(section) && has_exact_keys(section, ARRANGEMENT_SECTION_KEYS)
        )
    );
}

export function sanitize_marker_store_state(value: unknown): MarkerStoreState {
    if (is_exact_marker_store_state(value)) {
        return value;
    }

    const markers = get_marker_values(value) ?? [];
    const sections = get_section_values(value) ?? [];

    if (markers.length === 0 && sections.length === 0) {
        return defaultMarkerStoreState;
    }

    return {
        markers: markers.filter(is_valid_marker).map(normalize_marker),
        sections: sections.filter(is_valid_arrangement_section).map(normalize_arrangement_section),
    };
}

export const markerStore = createStore<MarkerStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'markers', {
        // Audit CC-2 — projection default for a document without this slot, so
        // hydrate never writes the previous project's cache back into truth.
        hydrateMissing: () => defaultMarkerStoreState,
    }),
    initialData: defaultMarkerStoreState,
    sanitize: sanitize_marker_store_state,
});
