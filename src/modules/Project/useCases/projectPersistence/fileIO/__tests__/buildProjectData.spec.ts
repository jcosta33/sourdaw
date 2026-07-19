import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../arrangement/syncCurrentArrangementToStore', () => ({ syncCurrentArrangementToStore: vi.fn() }));
vi.mock('#/modules/Routing/useCases', () => ({ getAllSidechainRoutes: () => [] }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    exportCachedAudioBuffers: vi.fn().mockResolvedValue({}),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: { tracks: [] } },
    markerStore: { value: { markers: [] } },
    takeLaneStore: { value: undefined },
    adjustmentLayerStore: { value: { layers: [] } },
}));
vi.mock('#/modules/Automation/stores', () => ({ automationStore: { value: { lanes: [] } } }));
vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    midiStore: { value: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} } },
}));
vi.mock('#/modules/Transport/stores', () => ({
    transportStore: { value: { tempo: 120 } },
    tempoMapStore: { value: undefined },
    timeSignatureMapStore: { value: undefined },
}));
vi.mock('../../../../stores/projectStore', () => ({
    projectStore: {
        value: {
            name: 'P',
            createdAt: 1,
            keyRoot: 0,
            scaleName: 'major',
            tuning: { name: '12-TET', frequencies: [] },
        },
    },
}));

// The store mock's value is set per test; the real sanitizer stays importable
// because only the store binding is overridden.
const arrangementStoreMock = vi.hoisted((): { value: unknown } => ({ value: null }));
vi.mock('../../../../stores/arrangementStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../stores/arrangementStore')>();
    return {
        ...actual,
        arrangementStore: arrangementStoreMock,
    };
});

import { sanitize_arrangement_store_state } from '../../../../stores/arrangementStore';
import { buildProjectData } from '../buildProjectData';

describe('buildProjectData', () => {
    it('does not throw on sanitizer-accepted minimal track rows inside an INACTIVE arrangement', async () => {
        // Inactive arrangements never pass through loadSnapshot()'s deep
        // validators, yet buildProjectData() iterates EVERY arrangement and
        // dereferences track.freezeState.frozenBufferId / track.clips /
        // track.alternatives. The sanitizer must therefore guarantee those
        // structural invariants on every track row it accepts.
        const corrupt = {
            arrangements: [
                {
                    id: 'active-arr',
                    name: 'Active',
                    tracks: { tracks: [], selectedTrackId: null },
                    automation: { lanes: [] },
                    midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
                },
                {
                    id: 'inactive-arr',
                    name: 'Inactive',
                    // Minimal-but-identified track row: accepted by the
                    // sanitizer, previously crashed save/export.
                    tracks: { tracks: [{ id: 'track-only-id' }], selectedTrackId: null },
                    automation: { lanes: [] },
                    midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
                },
            ],
            activeArrangementId: 'active-arr',
        };

        arrangementStoreMock.value = sanitize_arrangement_store_state(corrupt);

        const built = await buildProjectData();

        expect(built).not.toBeNull();
        if (!built) {
            throw new Error('expected buildProjectData to produce data');
        }
        // The repaired row survived (not dropped) with safe structural defaults.
        const inactive = built.data.arrangements?.find((arr) => arr.id === 'inactive-arr');
        expect(inactive).toBeDefined();
        if (!inactive?.tracks) {
            throw new Error('expected the repaired inactive arrangement to keep its tracks');
        }
        expect(inactive.tracks.tracks.map((track) => track.id)).toEqual(['track-only-id']);
    });
});
