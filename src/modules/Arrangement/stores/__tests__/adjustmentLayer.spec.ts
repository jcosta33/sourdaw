import { change, clone, from, merge, type Doc } from '@automerge/automerge';
import { afterEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    findAutomergeStorageRawProjectionLosses,
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
} from '#/infra/store/storage/createAutomergeStorage';
import { findAutomergeProjectConflicts } from '#/modules/CrdtDocument/useCases';

import {
    adjustmentLayerStore,
    sanitizeAdjustmentLayerState,
    type AdjustmentLayer,
    type AdjustmentLayerState,
} from '../adjustmentLayer';

type RootDocument = Record<string, unknown> & { adjustmentLayers?: unknown };
type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

function createLayer(): AdjustmentLayer {
    return {
        id: 'layer-1',
        name: 'Tone',
        effectType: 'eq',
        parameters: [
            { name: 'Low Gain', value: 0, min: -12, max: 12, unit: 'dB' },
            { name: 'High Gain', value: 0, min: -12, max: 12, unit: 'dB' },
        ],
        affectedTrackIds: ['track-1'],
        insertionIndex: 0,
        regions: [
            {
                id: 'region-1',
                startBeat: 0,
                endBeat: 8,
                blend: 1,
                fadeInBeats: 0.25,
                fadeOutBeats: 0.25,
            },
        ],
        enabled: true,
        mix: 1,
        color: '#336699',
    };
}

function createPeer(initialDoc: Doc<RootDocument>) {
    let doc = initialDoc;
    return {
        getDoc: () => doc,
        port: {
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: (docId: string) => docId === 'root',
            mutateDoc: ({ changeFn }: Parameters<TestPort['mutateDoc']>[0]) => {
                doc = change(doc, (draft) => changeFn(draft));
            },
        },
    };
}

function attachPeer(peer: ReturnType<typeof createPeer>): void {
    configureAutomergeStoragePort(peer.port);
    resetAutomergeStorageProjections('root');
    adjustmentLayerStore.hydrate();
}

function readState(): AdjustmentLayerState {
    const state = adjustmentLayerStore.value;
    if (!state) {
        throw new Error('adjustmentLayerStore must hold a projected value');
    }
    return state;
}

function editPeer(peer: ReturnType<typeof createPeer>, edit: (state: AdjustmentLayerState) => void): void {
    attachPeer(peer);
    const state = structuredClone(readState());
    edit(state);
    adjustmentLayerStore.set(state);
    flushAutomergeStorageWrites();
}

afterEach(() => {
    flushAutomergeStorageWrites();
    configureAutomergeStoragePort(null);
});

describe('adjustmentLayerStore collaboration', () => {
    it('merges concurrent edits to different named parameters on the same layer', () => {
        const baseline = from<RootDocument>({ adjustmentLayers: { layers: [createLayer()] } });
        const left = createPeer(clone(baseline));
        const right = createPeer(clone(baseline));

        editPeer(left, (state) => {
            state.layers[0]!.parameters[0]!.value = -3;
        });
        editPeer(right, (state) => {
            state.layers[0]!.parameters[1]!.value = 4;
        });

        const mergedDocument = merge(clone(left.getDoc()), right.getDoc());
        expect(findAutomergeProjectConflicts({ document: mergedDocument })).toEqual([]);
        const merged = createPeer(mergedDocument);
        attachPeer(merged);

        expect(readState().layers[0]?.parameters).toMatchObject([
            { name: 'Low Gain', value: -3 },
            { name: 'High Gain', value: 4 },
        ]);
    });
});

describe('adjustmentLayerStore hydration', () => {
    it('returns an exact valid supported state unchanged', () => {
        const state = { layers: [createLayer()] };

        expect(sanitizeAdjustmentLayerState(state)).toBe(state);
    });

    const sparseLayers: unknown[] = [];
    sparseLayers.length = 2;
    sparseLayers[0] = createLayer();
    const duplicateParameterLayer = createLayer();
    duplicateParameterLayer.parameters = [
        duplicateParameterLayer.parameters[0]!,
        { ...duplicateParameterLayer.parameters[0]! },
    ];
    const duplicateRegionLayer = createLayer();
    duplicateRegionLayer.regions = [duplicateRegionLayer.regions[0]!, { ...duplicateRegionLayer.regions[0]! }];

    it.each([
        ['bad state container', null],
        ['unsupported state keys', { layers: [], futureSchema: 2 }],
        ['bad layers container', { layers: 'not-an-array' }],
        ['non-dense layers', { layers: sparseLayers }],
        ['duplicate layer identity', { layers: [createLayer(), createLayer()] }],
        ['duplicate parameter identity', { layers: [duplicateParameterLayer] }],
        ['duplicate region identity', { layers: [duplicateRegionLayer] }],
        ['unsupported effect type', { layers: [{ ...createLayer(), effectType: 'chorus' }] }],
        ['non-finite scalar', { layers: [{ ...createLayer(), mix: Number.NaN }] }],
        ['fractional insertion index', { layers: [{ ...createLayer(), insertionIndex: 0.5 }] }],
        ['out-of-range mix', { layers: [{ ...createLayer(), mix: 1.01 }] }],
        [
            'invalid parameter range',
            {
                layers: [
                    {
                        ...createLayer(),
                        parameters: [{ name: 'Gain', value: 0, min: 2, max: 1, unit: 'dB' }],
                    },
                ],
            },
        ],
        [
            'parameter value outside bounds',
            {
                layers: [
                    {
                        ...createLayer(),
                        parameters: [{ name: 'Gain', value: 2, min: 0, max: 1, unit: 'dB' }],
                    },
                ],
            },
        ],
        [
            'invalid region bounds',
            {
                layers: [
                    {
                        ...createLayer(),
                        regions: [{ ...createLayer().regions[0]!, startBeat: 8, endBeat: 4 }],
                    },
                ],
            },
        ],
        [
            'out-of-range region blend',
            {
                layers: [
                    {
                        ...createLayer(),
                        regions: [{ ...createLayer().regions[0]!, blend: -0.1 }],
                    },
                ],
            },
        ],
        [
            'negative region fade',
            {
                layers: [
                    {
                        ...createLayer(),
                        regions: [{ ...createLayer().regions[0]!, fadeInBeats: -1 }],
                    },
                ],
            },
        ],
        ['duplicate affected track identity', { layers: [{ ...createLayer(), affectedTrackIds: ['t1', 't1'] }] }],
    ])('rejects %s', (_case, malformed) => {
        expect(sanitizeAdjustmentLayerState(malformed)).toEqual({ layers: [] });
    });

    it('preserves a valid supported state and reports no projection loss', () => {
        const state = { layers: [createLayer()] };
        const document: RootDocument = { adjustmentLayers: state };
        const peer = createPeer(from<RootDocument>(document));

        attachPeer(peer);

        expect(readState()).toEqual(state);
        expect(findAutomergeStorageRawProjectionLosses({ docId: 'root', document })).toEqual([]);
    });

    it('quarantines malformed state without overwriting the raw document', () => {
        const malformed = {
            layers: [
                {
                    ...createLayer(),
                    mix: 2,
                },
            ],
        };
        const peer = createPeer(from<RootDocument>({ adjustmentLayers: malformed }));

        attachPeer(peer);

        expect(readState()).toEqual({ layers: [] });
        expect(peer.getDoc().adjustmentLayers).toEqual(malformed);
        expect(
            findAutomergeStorageRawProjectionLosses({
                docId: 'root',
                document: { adjustmentLayers: malformed },
            })
        ).toEqual(['adjustmentLayers']);
    });
});
