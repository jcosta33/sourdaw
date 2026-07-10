import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import { modulationStore, type ModulationStoreState } from '../modulationStore';

type TestDoc = {
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

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

describe('modulationStore', () => {
    beforeEach(async () => {
        configureAutomergeStoragePort(null);
        modulationStore.set({ modulators: [] });
        await flush_pending_frame();
        clear_fake_doc();
        mutation_count = 0;
        configure_fake_crdt_port();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('should sanitize malformed CRDT hydration to an empty modulation store without throwing', () => {
        fake_doc.modulation = { modulators: 'not-an-array' };

        expect(() => {
            modulationStore.hydrate();
        }).not.toThrow();

        expect(modulationStore.value).toEqual({ modulators: [] });
    });

    it('should keep valid neighboring modulators when malformed CRDT rows hydrate', () => {
        const valid_modulator = {
            id: 'mod-lfo-1',
            name: 'Slow LFO',
            trackId: 'track-1',
            kind: 'lfo',
            config: {
                kind: 'lfo',
                waveform: 'sine',
                rate: 4,
                sync: true,
                phase: 0,
                depth: 0.5,
            },
            mappings: [
                {
                    targetTrackId: 'track-1',
                    targetDeviceId: 'device-1',
                    targetParamId: 'gain',
                    amount: 0.25,
                },
            ],
            enabled: true,
        } satisfies ModulationStoreState['modulators'][number];

        fake_doc.modulation = {
            modulators: [
                valid_modulator,
                {
                    id: 'bad-kind',
                    name: 'Bad',
                    trackId: 'track-1',
                    kind: 'lfo',
                    config: {
                        kind: 'envelope',
                        attack: 0,
                        decay: 0,
                        sustain: 1,
                        release: 1,
                        triggerMode: 'midi',
                    },
                    mappings: [],
                    enabled: true,
                },
            ],
        };

        modulationStore.hydrate();

        expect(modulationStore.value).toEqual({ modulators: [valid_modulator] });
    });

    it('should preserve valid CRDT hydration without writing back', async () => {
        const valid_state = {
            modulators: [
                {
                    id: 'mod-step-1',
                    name: 'Steps',
                    trackId: 'track-1',
                    kind: 'step',
                    config: {
                        kind: 'step',
                        steps: [0, 1, 0.5],
                        rate: 1,
                        smooth: 0.2,
                    },
                    mappings: [],
                    enabled: false,
                },
            ],
        } satisfies ModulationStoreState;
        fake_doc.modulation = valid_state;

        modulationStore.hydrate();
        await flush_pending_frame();

        expect(modulationStore.value).toEqual(valid_state);
        expect(mutation_count).toBe(0);
    });
});
