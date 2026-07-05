import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

export type TimeSignatureChange = {
    id: string;
    beat: number;
    numerator: number;
    denominator: number;
};

export type TimeSignatureMapStoreState = {
    changes: TimeSignatureChange[];
};

const MIN_TIME_SIGNATURE_PART = 1;
const MAX_TIME_SIGNATURE_PART = 32;

function create_empty_time_signature_map_state(): TimeSignatureMapStoreState {
    return { changes: [] };
}

function is_unknown_array(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function get_time_signature_change_values(value: unknown): unknown[] | null {
    if (value === null || typeof value !== 'object') {
        return null;
    }

    if (!('changes' in value)) {
        return null;
    }

    if (!is_unknown_array(value.changes)) {
        return null;
    }

    return value.changes;
}

function is_valid_time_signature_part(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= MIN_TIME_SIGNATURE_PART &&
        value <= MAX_TIME_SIGNATURE_PART
    );
}

function is_valid_time_signature_change(value: unknown): value is TimeSignatureChange {
    return (
        value !== null &&
        typeof value === 'object' &&
        'id' in value &&
        typeof value.id === 'string' &&
        'beat' in value &&
        typeof value.beat === 'number' &&
        Number.isFinite(value.beat) &&
        value.beat >= 0 &&
        'numerator' in value &&
        is_valid_time_signature_part(value.numerator) &&
        'denominator' in value &&
        is_valid_time_signature_part(value.denominator)
    );
}

function normalize_time_signature_change(change: TimeSignatureChange): TimeSignatureChange {
    return {
        id: change.id,
        beat: change.beat,
        numerator: change.numerator,
        denominator: change.denominator,
    };
}

function sanitize_time_signature_map_state(value: unknown): TimeSignatureMapStoreState {
    const changes = get_time_signature_change_values(value);
    if (changes === null) {
        return create_empty_time_signature_map_state();
    }

    return { changes: changes.filter(is_valid_time_signature_change).map(normalize_time_signature_change) };
}

export const timeSignatureMapStore = createStore<TimeSignatureMapStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'timeSignatureMap'),
    initialData: create_empty_time_signature_map_state(),
    sanitize: sanitize_time_signature_map_state,
});
