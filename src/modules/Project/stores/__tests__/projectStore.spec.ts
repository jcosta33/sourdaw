import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import { defaultProjectStoreState, projectStore, type ProjectStoreState } from '../projectStore';

type TestDoc = {
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

type DurableProjectMeta = Pick<
    ProjectStoreState,
    'name' | 'createdAt' | 'updatedAt' | 'keyRoot' | 'scaleName' | 'tuning' | 'productionBrief'
>;

const fake_doc: TestDoc = {};
let mutation_count = 0;

function clear_fake_doc(): void {
    for (const key of Object.keys(fake_doc)) {
        delete fake_doc[key];
    }
}

function configure_fake_crdt_port(): void {
    const port: TestPort = {
        getDoc: () => fake_doc,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            mutation_count += 1;
            changeFn(fake_doc);
        },
    };

    configureAutomergeStoragePort(port);
}

async function flush_pending_frame(): Promise<void> {
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

function create_default_state(): ProjectStoreState {
    return structuredClone(defaultProjectStoreState);
}

function create_valid_tuning(): ProjectStoreState['tuning'] {
    return {
        name: 'Valid Tuning',
        frequencies: Array.from({ length: 128 }, (_, index) => 220 * 2 ** (index / 12)),
    };
}

function create_valid_meta(): DurableProjectMeta {
    return {
        name: 'Loaded Project',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
        keyRoot: 7,
        scaleName: 'dorian',
        tuning: create_valid_tuning(),
        productionBrief: structuredClone(defaultProjectStoreState.productionBrief),
    };
}

async function reset_store_and_doc(): Promise<void> {
    configureAutomergeStoragePort(null);
    projectStore.set(create_default_state());
    await flush_pending_frame();
    clear_fake_doc();
    mutation_count = 0;
    configure_fake_crdt_port();
}

describe('projectStore', () => {
    beforeEach(async () => {
        await reset_store_and_doc();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('should sanitize malformed persisted project metadata to safe defaults without throwing', () => {
        fake_doc.projectMeta = 'malformed-project-meta';

        expect(() => projectStore.hydrate()).not.toThrow();

        expect(projectStore.value).toEqual(defaultProjectStoreState);
    });

    it('should hydrate valid durable metadata with cold-start transient defaults', () => {
        fake_doc.projectMeta = create_valid_meta();

        projectStore.hydrate();

        expect(projectStore.value).toEqual({
            ...create_valid_meta(),
            dirty: false,
            loading: true,
            initialized: false,
        });
    });

    it('should ignore legacy persisted transient flags on cold-start hydration', () => {
        fake_doc.projectMeta = {
            ...create_valid_meta(),
            dirty: true,
            loading: false,
            initialized: true,
        };

        projectStore.hydrate();

        expect(projectStore.value).toEqual({
            ...create_valid_meta(),
            dirty: false,
            loading: true,
            initialized: false,
        });
    });

    it('should preserve current transient flags when CRDT projection hydrates durable metadata', async () => {
        projectStore.set({
            ...create_default_state(),
            dirty: true,
            loading: false,
            initialized: true,
        });
        await flush_pending_frame();
        clear_fake_doc();
        mutation_count = 0;
        const changed_meta = { ...create_valid_meta(), updatedAt: 1_700_000_002_000 };
        fake_doc.projectMeta = changed_meta;

        projectStore.hydrate();

        expect(projectStore.value).toEqual({
            ...changed_meta,
            dirty: true,
            loading: false,
            initialized: true,
        });
    });

    it('should default malformed durable fields independently while preserving valid neighboring durable fields', () => {
        const valid_meta = create_valid_meta();
        fake_doc.projectMeta = {
            name: valid_meta.name,
            createdAt: 'bad-date',
            updatedAt: valid_meta.updatedAt,
            keyRoot: 99,
            scaleName: valid_meta.scaleName,
            tuning: valid_meta.tuning,
            productionBrief: valid_meta.productionBrief,
        };

        projectStore.hydrate();

        expect(projectStore.value).toEqual({
            name: valid_meta.name,
            createdAt: defaultProjectStoreState.createdAt,
            updatedAt: valid_meta.updatedAt,
            dirty: false,
            loading: true,
            keyRoot: defaultProjectStoreState.keyRoot,
            scaleName: valid_meta.scaleName,
            tuning: valid_meta.tuning,
            productionBrief: valid_meta.productionBrief,
            initialized: false,
        });
    });

    it('should default malformed tuning without dropping valid neighboring project metadata', async () => {
        const valid_meta = create_valid_meta();
        const invalid_tunings = [
            {
                label: 'bad name',
                tuning: { name: 12, frequencies: valid_meta.tuning.frequencies },
            },
            {
                label: 'bad frequencies',
                tuning: { name: 'Bad Frequencies', frequencies: 'not-frequencies' },
            },
            {
                label: 'non-128 frequencies',
                tuning: { name: 'Short Frequencies', frequencies: Array.from({ length: 127 }, () => 440) },
            },
            {
                label: 'non-finite frequencies',
                tuning: {
                    name: 'Non-finite Frequencies',
                    frequencies: Array.from({ length: 128 }, (_, index) => (index === 64 ? Number.NaN : 440)),
                },
            },
        ];

        for (const invalid_tuning of invalid_tunings) {
            await reset_store_and_doc();
            fake_doc.projectMeta = {
                ...valid_meta,
                tuning: invalid_tuning.tuning,
            };

            projectStore.hydrate();

            expect(projectStore.value, invalid_tuning.label).toEqual({
                ...valid_meta,
                dirty: false,
                loading: true,
                tuning: defaultProjectStoreState.tuning,
                initialized: false,
            });
        }
    });

    it('should not write back when clean CRDT metadata hydrates exactly', async () => {
        fake_doc.projectMeta = create_valid_meta();

        projectStore.hydrate();
        await flush_pending_frame();

        expect(projectStore.value).toEqual({
            ...create_valid_meta(),
            dirty: false,
            loading: true,
            initialized: false,
        });
        expect(mutation_count).toBe(0);
    });

    it('writes production brief revisions through the collaborative project document', async () => {
        const state = create_default_state();
        const productionBrief = {
            ...state.productionBrief,
            revision: 1,
            vision: 'Intimate verses',
            updatedAt: state.updatedAt + 1,
        };

        projectStore.set({ ...state, productionBrief });
        await flush_pending_frame();

        expect(fake_doc.projectMeta).toEqual(expect.objectContaining({ productionBrief }));
        expect(mutation_count).toBe(1);
    });
});
