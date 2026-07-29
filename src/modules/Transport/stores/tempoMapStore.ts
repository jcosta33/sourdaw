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

/**
 * Tempo range a stored *tempo-map change* must fall in.
 *
 * Deliberately its own name and not Transport's `MIN_TEMPO`/`MAX_TEMPO`, because
 * the two ranges are genuinely different: the transport's base tempo is capped
 * at 300, a tempo-map change at 999. They already disagree, so collapsing them
 * would be wrong.
 *
 * The minimum is exported because it is one of the two floors the
 * unknown-frozen-tail derivation has to clear — a project's slowest legal tempo
 * is the slowest either validator will accept, and that derivation used to be
 * checked against Transport's copy alone. `frozenTailAnchor.spec.ts` pins it
 * against both. That cross-check is the point: a value duplicated across a
 * boundary with no test spanning it is invisible precisely while the copies
 * agree.
 */
export const MIN_TEMPO_MAP_TEMPO = 20;
const MAX_TEMPO_MAP_TEMPO = 999;
const TEMPO_MAP_KEYS = ['changes'] as const;
const TEMPO_CHANGE_KEYS = ['id', 'beat', 'tempo', 'curve'] as const;

function create_empty_tempo_map_state(): TempoMapStoreState {
    return { changes: [] };
}

function has_exact_keys(value: object, keys: readonly string[]): boolean {
    const value_keys = Object.keys(value);
    return value_keys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
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
        value.tempo >= MIN_TEMPO_MAP_TEMPO &&
        value.tempo <= MAX_TEMPO_MAP_TEMPO &&
        'curve' in value &&
        is_tempo_curve(value.curve)
    );
}

function normalize_tempo_change(change: TempoChange): TempoChange {
    return {
        id: change.id,
        beat: change.beat,
        tempo: change.tempo,
        curve: change.curve,
    };
}

function is_exact_tempo_map_state(value: unknown): value is TempoMapStoreState {
    const changes = get_tempo_change_values(value);
    return (
        value !== null &&
        typeof value === 'object' &&
        has_exact_keys(value, TEMPO_MAP_KEYS) &&
        changes !== null &&
        changes.every((change) => is_valid_tempo_change(change) && has_exact_keys(change, TEMPO_CHANGE_KEYS))
    );
}

export function sanitize_tempo_map_state(value: unknown): TempoMapStoreState {
    if (is_exact_tempo_map_state(value)) {
        return value;
    }

    const changes = get_tempo_change_values(value);
    if (changes === null) {
        return create_empty_tempo_map_state();
    }

    return { changes: changes.filter(is_valid_tempo_change).map(normalize_tempo_change) };
}

export const tempoMapStore = createStore<TempoMapStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'tempoMap', {
        // Audit CC-2 — projection default for a document without this slot, so
        // hydrate never writes the previous project's cache back into truth.
        hydrateMissing: () => create_empty_tempo_map_state(),
    }),
    initialData: create_empty_tempo_map_state(),
    sanitize: sanitize_tempo_map_state,
});
