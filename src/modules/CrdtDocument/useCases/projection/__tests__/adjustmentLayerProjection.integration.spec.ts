import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    adjustmentLayerStore,
    createEffectiveAdjustmentLayerSignature,
    trackStore,
    type AdjustmentLayer,
} from '#/modules/Arrangement/stores';
import { reconcileAdjustmentLayerStaleness } from '#/modules/Arrangement/useCases';

import { projectCrdtToStores } from '../projectProjection';
import { setProjectProjectionDependencies } from '../projectProjectionDependencies';

function create_layer(id: string, mix: number): AdjustmentLayer {
    return {
        id,
        name: id,
        effectType: 'volume',
        parameters: [{ name: 'Gain', value: 0, min: -60, max: 12, unit: 'dB' }],
        affectedTrackIds: ['track-a'],
        insertionIndex: 0,
        regions: [],
        enabled: true,
        mix,
        color: '#fff',
    };
}

function create_root_document(layer: AdjustmentLayer): Record<string, unknown> {
    const adjustment_signature = createEffectiveAdjustmentLayerSignature([layer], ['track-a'], 'track-a');
    return {
        adjustmentLayers: { layers: [layer] },
        tracks: {
            tracks: [
                {
                    id: 'track-a',
                    name: 'Track A',
                    kind: 'audio',
                    frozen: true,
                    frozenBufferId: 'buffer-a',
                    freezeState: {
                        status: 'frozen',
                        frozenBufferId: 'buffer-a',
                        sourceContentHash: 'freeze-v2:hash',
                        adjustmentLayerSignature: adjustment_signature,
                    },
                },
            ],
        },
    };
}

function connect_document(root_document: Record<string, unknown>): void {
    configureAutomergeStoragePort({
        getSemanticMessage: () => undefined,
        hasDoc: (doc_id) => doc_id === 'root',
        getDoc: (doc_id) => (doc_id === 'root' ? root_document : undefined),
        mutateDoc: ({ docId, changeFn }) => {
            if (docId === 'root') {
                changeFn(root_document);
            }
        },
    });
}

function get_track_status(): string | undefined {
    return trackStore.value?.tracks.find((track) => track.id === 'track-a')?.freezeState.status;
}

describe('adjustment-layer CRDT projection', () => {
    beforeEach(() => {
        setProjectProjectionDependencies({
            reconcileProjectedProjectState: reconcileAdjustmentLayerStaleness,
        });
        configureAutomergeStoragePort(null);
        adjustmentLayerStore.set({ layers: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
        adjustmentLayerStore.set({ layers: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
    });

    it('reloads durable adjustment layers without invalidating a matching frozen render', () => {
        const persisted_layer = create_layer('reload-layer', 0.5);
        const root_document = create_root_document(persisted_layer);
        connect_document(root_document);

        projectCrdtToStores();

        expect(adjustmentLayerStore.value?.layers).toEqual([persisted_layer]);
        expect(get_track_status()).toBe('frozen');
    });

    it('hydrates a peer layer change and reconciles a formerly-current frozen track to stale', () => {
        const local_layer = create_layer('peer-layer', 0.25);
        const root_document = create_root_document(local_layer);
        connect_document(root_document);
        adjustmentLayerStore.set({ layers: [local_layer] });

        projectCrdtToStores();
        expect(get_track_status()).toBe('frozen');

        const remote_layer = create_layer('peer-layer', 0.75);
        root_document.adjustmentLayers = { layers: [remote_layer] };
        projectCrdtToStores();
        flushAutomergeStorageWrites();

        expect(adjustmentLayerStore.value?.layers).toEqual([remote_layer]);
        expect(get_track_status()).toBe('stale');
        expect(root_document.tracks).toMatchObject({
            tracks: [expect.objectContaining({ freezeState: expect.objectContaining({ status: 'stale' }) })],
        });
    });

    it('recovers a retained artifact left freezing by a prior runtime', () => {
        const persisted_layer = create_layer('orphan-layer', 0.5);
        const root_document = create_root_document(persisted_layer);
        const tracks = root_document.tracks as { tracks: Array<Record<string, unknown>> };
        tracks.tracks[0]!.freezeState = {
            ...(tracks.tracks[0]!.freezeState as Record<string, unknown>),
            status: 'freezing',
            renderProgress: 0.5,
        };
        connect_document(root_document);

        projectCrdtToStores();
        flushAutomergeStorageWrites();

        expect(get_track_status()).toBe('stale');
        expect(root_document.tracks).toMatchObject({
            tracks: [expect.objectContaining({ freezeState: expect.objectContaining({ status: 'stale' }) })],
        });
    });
});
