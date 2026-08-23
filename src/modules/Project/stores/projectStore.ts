import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';
import { SCALE_PATTERNS } from '#/utils/Music/MusicalScale';

import { createDefaultProductionBrief, isProductionBrief, type ProductionBrief } from '../models/ProductionBrief';
import { createProjectId, isCanonicalProjectId } from '../models/ProjectData';

const DOC_PREFIX_ROOT = 'root';
const TUNING_FREQUENCY_COUNT = 128;

export type ProjectStoreState = {
    /** Present on every sanitized state; optional here so legacy-shaped project activators migrate on set. */
    projectId?: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    dirty: boolean;
    loading: boolean;
    /** Ephemeral publication barrier while a newly minted identity is becoming durable. */
    identityMigrationPending?: boolean;
    keyRoot: number; // 0-11 (C=0)
    scaleName: string;
    /** Current project-wide tuning table (128 frequencies).
     * Defaults to standard 12-TET. */
    tuning: {
        name: string;
        frequencies: number[];
    };
    productionBrief: ProductionBrief;
    /** True once the user has explicitly started or loaded a project session.
     *  Ephemeral — not written to CRDT. Resets to false on every cold start.
     *  Controls whether the full-screen LaunchScreen is shown. */
    initialized: boolean;
};

const DEFAULT_PROJECT_CREATED_AT = Date.now();

export const defaultProjectStoreState: ProjectStoreState = {
    projectId: createProjectId(),
    name: 'Untitled Project',
    createdAt: DEFAULT_PROJECT_CREATED_AT,
    updatedAt: DEFAULT_PROJECT_CREATED_AT,
    dirty: false,
    loading: true,
    identityMigrationPending: false,
    keyRoot: 0,
    scaleName: 'chromatic',
    tuning: {
        name: 'Equal Temperament',
        frequencies: Array.from({ length: TUNING_FREQUENCY_COUNT }, (_, index) => 440 * 2 ** ((index - 69) / 12)),
    },
    productionBrief: createDefaultProductionBrief(DEFAULT_PROJECT_CREATED_AT),
    initialized: false,
};

const DURABLE_PROJECT_META_KEYS = [
    'projectId',
    'name',
    'createdAt',
    'updatedAt',
    'keyRoot',
    'scaleName',
    'tuning',
    'productionBrief',
] as const;
const TRANSIENT_PROJECT_META_KEYS = ['dirty', 'loading', 'identityMigrationPending', 'initialized'] as const;
const PROJECT_STORE_STATE_KEYS = [...DURABLE_PROJECT_META_KEYS, ...TRANSIENT_PROJECT_META_KEYS] as const;
const TUNING_KEYS = ['name', 'frequencies'] as const;

type PlainObject = {
    [key: string]: unknown;
};

type OwnValue = { found: true; value: unknown } | { found: false };

type GetOwnValueInput = {
    value: object;
    key: string;
};

type HasExactKeysInput = {
    value: object;
    keys: readonly string[];
};

type HasProjectStoreStateValuesInput = {
    value: object;
    state: ProjectStoreState;
};

type ProjectTransientState = {
    dirty: boolean;
    loading: boolean;
    identityMigrationPending: boolean;
    initialized: boolean;
};

const defaultProjectTransientState: ProjectTransientState = {
    dirty: defaultProjectStoreState.dirty,
    loading: defaultProjectStoreState.loading,
    identityMigrationPending: defaultProjectStoreState.identityMigrationPending ?? false,
    initialized: defaultProjectStoreState.initialized,
};

function create_default_project_store_state(): ProjectStoreState {
    return {
        ...defaultProjectStoreState,
        tuning: {
            ...defaultProjectStoreState.tuning,
            frequencies: [...defaultProjectStoreState.tuning.frequencies],
        },
        productionBrief: structuredClone(defaultProjectStoreState.productionBrief),
    };
}

function is_plain_object(value: unknown): value is PlainObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function get_own_value(input: GetOwnValueInput): OwnValue {
    const descriptor = Object.getOwnPropertyDescriptor(input.value, input.key);
    if (!descriptor) {
        return { found: false };
    }

    if (!('value' in descriptor)) {
        return { found: true, value: undefined };
    }

    return { found: true, value: descriptor.value };
}

function has_exact_keys(input: HasExactKeysInput): boolean {
    const value_keys = Object.keys(input.value);
    return value_keys.length === input.keys.length && input.keys.every((key) => Object.hasOwn(input.value, key));
}

function is_finite_number(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function is_boolean(value: unknown): value is boolean {
    return typeof value === 'boolean';
}

function is_valid_timestamp(value: unknown): value is number {
    return is_finite_number(value) && value >= 0;
}

function is_valid_key_root(value: unknown): value is number {
    return is_finite_number(value) && Number.isInteger(value) && value >= 0 && value <= 11;
}

function is_valid_scale_name(value: unknown): value is string {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SCALE_PATTERNS, value);
}

function is_valid_tuning_frequencies(value: unknown): value is number[] {
    return (
        Array.isArray(value) &&
        value.length === TUNING_FREQUENCY_COUNT &&
        value.every((frequency) => is_finite_number(frequency) && frequency > 0)
    );
}

function is_valid_tuning(value: unknown): value is ProjectStoreState['tuning'] {
    return is_plain_object(value) && typeof value.name === 'string' && is_valid_tuning_frequencies(value.frequencies);
}

function is_exact_tuning(value: unknown): value is ProjectStoreState['tuning'] {
    return is_valid_tuning(value) && has_exact_keys({ value, keys: TUNING_KEYS });
}

function normalize_tuning(value: unknown): ProjectStoreState['tuning'] | null {
    if (is_exact_tuning(value)) {
        return value;
    }

    if (!is_valid_tuning(value)) {
        return null;
    }

    return {
        name: value.name,
        frequencies: [...value.frequencies],
    };
}

function apply_name(source: object, next_state: ProjectStoreState): void {
    const property = get_own_value({ value: source, key: 'name' });
    if (property.found && typeof property.value === 'string') {
        next_state.name = property.value;
    }
}

function apply_created_at(source: object, next_state: ProjectStoreState): void {
    const property = get_own_value({ value: source, key: 'createdAt' });
    if (property.found && is_valid_timestamp(property.value)) {
        next_state.createdAt = property.value;
    }
}

function apply_updated_at(source: object, next_state: ProjectStoreState): void {
    const property = get_own_value({ value: source, key: 'updatedAt' });
    if (property.found && is_valid_timestamp(property.value)) {
        next_state.updatedAt = property.value;
    }
}

function apply_key_root(source: object, next_state: ProjectStoreState): void {
    const property = get_own_value({ value: source, key: 'keyRoot' });
    if (property.found && is_valid_key_root(property.value)) {
        next_state.keyRoot = property.value;
    }
}

function apply_scale_name(source: object, next_state: ProjectStoreState): void {
    const property = get_own_value({ value: source, key: 'scaleName' });
    if (property.found && is_valid_scale_name(property.value)) {
        next_state.scaleName = property.value;
    }
}

function apply_tuning(source: object, next_state: ProjectStoreState): void {
    const property = get_own_value({ value: source, key: 'tuning' });
    if (!property.found) {
        return;
    }

    const tuning = normalize_tuning(property.value);
    if (tuning) {
        next_state.tuning = tuning;
    }
}

function apply_production_brief(source: object, next_state: ProjectStoreState): void {
    const property = get_own_value({ value: source, key: 'productionBrief' });
    if (property.found && isProductionBrief(property.value)) {
        next_state.productionBrief = structuredClone(property.value);
    }
}

function apply_project_id(source: object, next_state: ProjectStoreState): void {
    const property = get_own_value({ value: source, key: 'projectId' });
    if (property.found && typeof property.value === 'string') {
        next_state.projectId = property.value;
        return;
    }
    next_state.projectId = undefined;
}

function get_valid_transient_state(value: unknown): ProjectTransientState | null {
    if (!is_plain_object(value)) {
        return null;
    }

    if (
        !is_boolean(value.dirty) ||
        !is_boolean(value.loading) ||
        !is_boolean(value.identityMigrationPending) ||
        !is_boolean(value.initialized)
    ) {
        return null;
    }

    return {
        dirty: value.dirty,
        loading: value.loading,
        identityMigrationPending: value.identityMigrationPending,
        initialized: value.initialized,
    };
}

function get_current_project_transient_state(): ProjectTransientState {
    return get_valid_transient_state(projectStore.value) ?? defaultProjectTransientState;
}

function normalize_project_store_state(
    value: object,
    transient_state: ProjectTransientState = defaultProjectTransientState
): ProjectStoreState {
    const next_state = create_default_project_store_state();

    next_state.dirty = transient_state.dirty;
    next_state.loading = transient_state.loading;
    next_state.identityMigrationPending = transient_state.identityMigrationPending;
    next_state.initialized = transient_state.initialized;

    apply_name(value, next_state);
    apply_created_at(value, next_state);
    apply_updated_at(value, next_state);
    apply_key_root(value, next_state);
    apply_scale_name(value, next_state);
    apply_tuning(value, next_state);
    apply_production_brief(value, next_state);
    apply_project_id(value, next_state);

    return next_state;
}

function has_project_store_state_values(input: HasProjectStoreStateValuesInput): boolean {
    return PROJECT_STORE_STATE_KEYS.every((key) => {
        const property = get_own_value({ value: input.value, key });
        return property.found && Object.is(property.value, input.state[key]);
    });
}

function is_exact_clean_project_store_state(value: unknown): value is ProjectStoreState {
    if (!is_plain_object(value)) {
        return false;
    }

    if (!has_exact_keys({ value, keys: PROJECT_STORE_STATE_KEYS })) {
        return false;
    }

    const transient_state = get_valid_transient_state(value);
    if (!transient_state) {
        return false;
    }

    const normalized = normalize_project_store_state(value, transient_state);
    return has_project_store_state_values({ value, state: normalized });
}

function normalize_project_meta_from_crdt(value: unknown): ProjectStoreState {
    if (!is_plain_object(value)) {
        return normalize_project_store_state({}, get_current_project_transient_state());
    }

    return normalize_project_store_state(value, get_current_project_transient_state());
}

function sanitize_project_store_state(value: unknown): ProjectStoreState {
    if (is_exact_clean_project_store_state(value)) {
        return value;
    }

    if (!is_plain_object(value)) {
        return create_default_project_store_state();
    }

    return normalize_project_store_state(value, get_valid_transient_state(value) ?? defaultProjectTransientState);
}

export const projectStore = createStore<ProjectStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'projectMeta', {
        toCrdt: (state) => {
            const { projectId, name, createdAt, updatedAt, keyRoot, scaleName, tuning, productionBrief } = state;
            const durableState = {
                name,
                createdAt,
                updatedAt,
                keyRoot,
                scaleName,
                tuning,
                productionBrief,
            };
            return isCanonicalProjectId(projectId) ? { projectId, ...durableState } : durableState;
        },
        fromCrdt: normalize_project_meta_from_crdt,
        // Audit CC-2 — projection default for a document without this slot, so
        // hydrate never writes the previous project's cache back into truth.
        hydrateMissing: () => ({ ...create_default_project_store_state(), projectId: undefined }),
    }),
    initialData: defaultProjectStoreState,
    sanitize: sanitize_project_store_state,
});

/** Return the durable project identity only after canonical migration has settled. */
export function getSettledProjectId(): string | undefined {
    return readSettledProjectId(projectStore.value);
}

export type SettledProjectIdentity = Readonly<{ projectId: string }>;

/** Capture the complete public identity contract used by foreign modules. */
export function getSettledProjectIdentity(): SettledProjectIdentity | undefined {
    return readSettledProjectIdentity(projectStore.value);
}

/** Read a canonical, migration-settled project identity from an exact snapshot. */
export function readSettledProjectIdentity(value: unknown): SettledProjectIdentity | undefined {
    const projectId = readSettledProjectId(value);
    return projectId ? { projectId } : undefined;
}

/** Read the same settled identity contract from an exact persisted project-meta snapshot. */
export function readSettledProjectId(value: unknown): string | undefined {
    if (!is_plain_object(value)) {
        return undefined;
    }
    const projectId = get_own_value({ value, key: 'projectId' });
    const migrationPending = get_own_value({ value, key: 'identityMigrationPending' });
    if (
        !projectId.found ||
        !isCanonicalProjectId(projectId.value) ||
        (migrationPending.found && migrationPending.value !== false)
    ) {
        return undefined;
    }
    return projectId.value;
}
