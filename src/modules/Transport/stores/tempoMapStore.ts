import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

export type TempoChange = {
    id: string;
    beat: number;
    tempo: number;
    curve: 'instant' | 'linear';
};

export type TempoMapStoreState = {
    changes: TempoChange[];
};

const MIN_TEMPO = 20;
const MAX_TEMPO = 999;

function create_empty_tempo_map_state(): TempoMapStoreState {
    return { changes: [] };
}

function is_unknown_array(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function get_tempo_change_values(value: unknown): unknown[] | null {
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

function is_tempo_curve(value: unknown): value is TempoChange['curve'] {
    return value === 'instant' || value === 'linear';
}

function is_valid_tempo_change(value: unknown): value is TempoChange {
    return (
        value !== null &&
        typeof value === 'object' &&
        'id' in value &&
        typeof value.id === 'string' &&
        'beat' in value &&
        typeof value.beat === 'number' &&
        Number.isFinite(value.beat) &&
        value.beat >= 0 &&
        'tempo' in value &&
        typeof value.tempo === 'number' &&
        Number.isFinite(value.tempo) &&
        value.tempo >= MIN_TEMPO &&
        value.tempo <= MAX_TEMPO &&
        'curve' in value &&
        is_tempo_curve(value.curve)
    );
}

function is_tempo_map_state(value: unknown): value is TempoMapStoreState {
    const changes = get_tempo_change_values(value);
    return changes !== null && changes.every(is_valid_tempo_change);
}

function sanitize_tempo_map_state(value: unknown): TempoMapStoreState {
    if (is_tempo_map_state(value)) {
        return value;
    }

    const changes = get_tempo_change_values(value);
    if (changes === null) {
        return create_empty_tempo_map_state();
    }

    return { changes: changes.filter(is_valid_tempo_change) };
}

export const tempoMapStore = createStore<TempoMapStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'tempoMap'),
    initialData: create_empty_tempo_map_state(),
    sanitize: sanitize_tempo_map_state,
});
