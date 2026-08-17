import { change, from, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';

import {
    createDefaultPattern,
    decodeArpPatternParams,
    defaultStep,
    DEFAULT_ARP_PATTERN_LENGTH,
    withArpPatternParams,
} from '../../models/ArpPattern';
import { hydrateYeastState } from '../../useCases/hydrateYeastState';
import { yeastStore } from '../yeastStore';

describe('yeastStore', () => {
    let document: Doc<{ yeast?: unknown }>;

    beforeEach(() => {
        document = from({});
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                document = change(document, (draft) => changeFn(draft as unknown as Record<string, unknown>));
            },
        });
        yeastStore.set({ processors: [], uiLevel: 1 });
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
    });

    it('stores the serializable processor projection and runtime availability only', () => {
        yeastStore.set({
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Arpeggiator',
                    bypassed: false,
                    params: { rate_denom: 16 },
                },
            ],
            uiLevel: 2,
            runtimeStatus: 'ready',
        });

        expect(yeastStore.value).toEqual({
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Arpeggiator',
                    bypassed: false,
                    params: { rate_denom: 16 },
                },
            ],
            uiLevel: 2,
            runtimeStatus: 'ready',
        });
        expect(yeastStore.value).not.toHaveProperty('rackInstance');
        expect(yeastStore.value).not.toHaveProperty('_worker');
    });

    it('continues to accept serialized projections without optional parameter state', () => {
        yeastStore.set({
            processors: [{ id: 'arp-1', type: 'arpeggiator', name: 'Arpeggiator', bypassed: false }],
            uiLevel: 1,
        });

        expect(yeastStore.value?.processors[0]).toEqual({
            id: 'arp-1',
            type: 'arpeggiator',
            name: 'Arpeggiator',
            bypassed: false,
        });
    });

    it('persists processor identity in project CRDT state', () => {
        yeastStore.set({
            processors: [{ id: 'groove-durable-id', type: 'groove', name: 'Groove', bypassed: false }],
            uiLevel: 1,
        });
        flushAutomergeStorageWrites();

        expect(document.yeast).toEqual({
            schemaVersion: 1,
            processors: {
                'groove-durable-id': {
                    deleted: false,
                    value: { id: 'groove-durable-id', type: 'groove', name: 'Groove', bypassed: false },
                },
            },
        });
        expect(document.yeast).not.toHaveProperty('uiLevel');
    });

    it('round-trips a custom arp pattern through the project CRDT document', () => {
        const pattern = [
            { ...defaultStep(), active: false, octaveOffset: -2 },
            { ...defaultStep(), stepType: 'tie' as const, velocity: 33, velocityOverride: true },
            { ...defaultStep(), gateMul: 0.4, ratchet: 3, probability: 0.5 },
        ];
        yeastStore.set({
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Arpeggiator',
                    bypassed: false,
                    params: withArpPatternParams({ mode: 7 }, pattern),
                },
            ],
            uiLevel: 3,
        });
        flushAutomergeStorageWrites();

        // Read the pattern back out of the document itself: the codec drops
        // every param value that is not a finite number, so this is the
        // assertion that the numeric encoding actually survives persistence.
        const persisted = (
            document.yeast as {
                processors: Record<string, { value: { params?: Record<string, number> } }>;
            }
        ).processors['arp-1']!.value.params;
        expect(persisted?.mode).toBe(7);
        expect(decodeArpPatternParams(persisted)).toEqual(pattern);

        yeastStore.hydrate();
        expect(decodeArpPatternParams(yeastStore.value?.processors[0]?.params)).toEqual(pattern);
    });

    it('hydrates an arpeggiator saved without a pattern to the default pattern', () => {
        document = change(document, (draft) => {
            draft.yeast = {
                processors: [
                    {
                        id: 'legacy-arp',
                        type: 'arpeggiator',
                        name: 'Arpeggiator',
                        bypassed: false,
                        params: { mode: 7, rate_denom: 16 },
                    },
                ],
            };
        });

        yeastStore.hydrate();

        const hydrated = yeastStore.value?.processors[0];
        expect(hydrated?.params).toEqual({ mode: 7, rate_denom: 16 });
        expect(decodeArpPatternParams(hydrated?.params)).toEqual(createDefaultPattern(DEFAULT_ARP_PATTERN_LENGTH));
    });

    it('hydrates persisted processor identity before a pending reset can replace it', () => {
        document = change(document, (draft) => {
            draft.yeast = {
                processors: [{ id: 'persisted-groove', type: 'groove', name: 'Persisted groove', bypassed: false }],
            };
        });
        yeastStore.set({ processors: [], uiLevel: 4 });

        yeastStore.hydrate();
        expect(yeastStore.value).toEqual({
            processors: [{ id: 'persisted-groove', type: 'groove', name: 'Persisted groove', bypassed: false }],
            uiLevel: 4,
        });

        flushAutomergeStorageWrites();
        expect(document.yeast).toEqual({
            schemaVersion: 1,
            processors: {
                'persisted-groove': {
                    deleted: false,
                    value: {
                        id: 'persisted-groove',
                        type: 'groove',
                        name: 'Persisted groove',
                        bypassed: false,
                    },
                },
            },
        });
        expect(document.yeast).not.toHaveProperty('uiLevel');
    });

    it('keeps the local UI level when project processor truth is hydrated', () => {
        yeastStore.set({ processors: [], uiLevel: 5 });

        hydrateYeastState({
            processors: [{ id: 'loaded-processor', type: 'groove', name: 'Loaded', bypassed: false }],
        });

        expect(yeastStore.value).toEqual({
            processors: [{ id: 'loaded-processor', type: 'groove', name: 'Loaded', bypassed: false }],
            uiLevel: 5,
        });
        flushAutomergeStorageWrites();
        expect(document.yeast).toMatchObject({
            schemaVersion: 1,
            processors: {
                'loaded-processor': { deleted: false },
            },
        });
        expect(document.yeast).not.toHaveProperty('uiLevel');
    });
});
