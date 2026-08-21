import { beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('../../../arrangement/syncCurrentArrangementToStore', () => ({ syncCurrentArrangementToStore: vi.fn() }));
vi.mock('#/modules/Routing/useCases', () => ({ getAllSidechainRoutes: () => [] }));
const exportCachedAudioBuffersMock = vi.hoisted(() => vi.fn());
vi.mock('#/modules/AudioEngine/useCases', () => ({
    exportCachedAudioBuffers: exportCachedAudioBuffersMock,
}));

const trackStoreMock = vi.hoisted((): { value: { tracks: unknown[] } } => ({ value: { tracks: [] } }));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: trackStoreMock,
    markerStore: { value: { markers: [] } },
    takeLaneStore: { value: undefined },
    adjustmentLayerStore: { value: { layers: [] } },
    vcaGroupStore: { value: { groups: [] } },
    gainEnvelopeStore: { value: { envelopes: {} } },
}));
vi.mock('#/modules/Automation/stores', () => ({
    automationStore: { value: { lanes: [] } },
    modulationStore: { value: { modulators: [] } },
}));
vi.mock('#/modules/CvGate/stores', () => ({ cvGateStore: { value: undefined } }));
const chordTrackStoreMock = vi.hoisted(() => ({
    value: {
        enabled: true,
        events: [{ id: 'chord-1', beat: 0, root: 9, quality: 'minor' as const, duration: 4 }],
    },
}));
vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    chordTrackStore: chordTrackStoreMock,
    midiStore: {
        value: { probabilitySeed: 0xdecafbad, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
    },
}));
vi.mock('#/modules/Transport/stores', () => ({
    transportStore: { value: { tempo: 120 } },
    tempoMapStore: { value: undefined },
    timeSignatureMapStore: { value: undefined },
}));
const yeastStoreMock = vi.hoisted((): { value: unknown } => ({ value: { processors: [], uiLevel: 1 } }));
// Per-device rack reads (issue #2422): keyed per test, empty rack for the rest.
const yeastRacksMock = vi.hoisted((): Record<string, { processors: unknown[] }> => ({}));
vi.mock('#/modules/Yeast/stores', () => ({
    yeastStore: yeastStoreMock,
    readYeastRack: (deviceId: string) => yeastRacksMock[deviceId] ?? { processors: [] },
}));
const productionBriefFixture = vi.hoisted(() => ({
    schemaVersion: 1 as const,
    id: 'production-brief',
    revision: 2,
    vision: 'Intimate verses',
    references: [],
    hardConstraints: [],
    preferences: [],
    sectionGoals: [],
    trackRoles: [],
    locks: [],
    decisions: [],
    unresolvedQuestions: [],
    sourceRunLinks: [{ id: 'source-link-2', sourceRunId: 'run-2', createdAt: 102 }],
    supersedesBriefId: null,
    supersededByBriefId: null,
    createdAt: 1,
    updatedAt: 2,
}));
const STORED_PROJECT_ID = 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';
const projectStoreMock = vi.hoisted((): { value: Record<string, unknown> } => ({ value: {} }));
vi.mock('../../../../stores/projectStore', () => ({
    projectStore: projectStoreMock,
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

// Minimal runtime track for the builder's walks (devices, clips,
// alternatives, freezeState). The Arrangement stores module is mocked here,
// so the real track factory is not importable without dragging the module
// graph through the mock.
function yeastDeviceTrack(trackId: string, deviceId: string): Record<string, unknown> {
    return {
        id: trackId,
        name: trackId,
        devices: [{ id: deviceId, name: 'Yeast', type: 'yeast', bypassed: false, parameterValues: {} }],
        clips: [],
        alternatives: [],
        freezeState: { frozenBufferId: undefined },
    };
}

describe('buildProjectData', () => {
    beforeEach(() => {
        trackStoreMock.value.tracks = [];
        for (const key of Object.keys(yeastRacksMock)) {
            delete yeastRacksMock[key];
        }
        exportCachedAudioBuffersMock.mockReset();
        exportCachedAudioBuffersMock.mockResolvedValue({});
        Object.assign(productionBriefFixture, { id: 'production-brief', supersedesBriefId: null });
        projectStoreMock.value = {
            projectId: STORED_PROJECT_ID,
            name: 'P',
            createdAt: 1,
            keyRoot: 0,
            scaleName: 'major',
            tuning: { name: '12-TET', frequencies: [] },
            productionBrief: productionBriefFixture,
        };
    });

    // AC-5. `includeAudioBuffers: false` is the shape the live save uses: the
    // encoder is never entered and the snapshot carries no audio payload.
    // Mutation: making `includeAudioBuffers` unconditional (or defaulting the
    // audioBuffers assignment to the exporter regardless of the flag) reds
    // `expect(exportCachedAudioBuffersMock).not.toHaveBeenCalled()`.
    it('never reaches the audio exporter when audio embedding is off', async () => {
        arrangementStoreMock.value = sanitize_arrangement_store_state({
            arrangements: [],
            activeArrangementId: null,
        });

        const built = await buildProjectData({ includeAudioBuffers: false });

        expect(exportCachedAudioBuffersMock).not.toHaveBeenCalled();
        expect(built?.data.audioBuffers).toBeUndefined();
        expect(built?.missingBufferCount).toBe(0);
        expect(built?.data.meta.productionBrief).toEqual(productionBriefFixture);
        expect(built?.data.meta.productionBrief).not.toBe(productionBriefFixture);
    });

    it('reuses the stored project identity when the production brief identity changes', async () => {
        arrangementStoreMock.value = sanitize_arrangement_store_state({
            arrangements: [],
            activeArrangementId: null,
        });
        Object.assign(productionBriefFixture, {
            id: 'replacement-production-brief',
            supersedesBriefId: 'production-brief',
        });

        const built = await buildProjectData({ includeAudioBuffers: false });

        expect(built?.data.meta.projectId).toBe(STORED_PROJECT_ID);
    });

    // Issue #2422: rack state is per device instance, and the file must carry
    // EVERY device's rack — writing only the active device's rack would make
    // a reopen silently discard every other rack. Mutation: reverting the
    // builder to the active-rack snapshot reds this test (one rack missing).
    it('writes every Yeast device rack, not just the active one', async () => {
        arrangementStoreMock.value = sanitize_arrangement_store_state({
            arrangements: [],
            activeArrangementId: null,
        });
        trackStoreMock.value.tracks = [
            yeastDeviceTrack('track-a', 'device-a'),
            yeastDeviceTrack('track-b', 'device-b'),
        ];
        const up = {
            id: 'transpose-up',
            type: 'transposer' as const,
            name: 'Up',
            bypassed: false,
            params: { semitones: 12 },
        };
        const down = {
            id: 'transpose-down',
            type: 'transposer' as const,
            name: 'Down',
            bypassed: false,
            params: { semitones: -12 },
        };
        yeastRacksMock['device-a'] = { processors: [up] };
        yeastRacksMock['device-b'] = { processors: [down] };

        const built = await buildProjectData({ includeAudioBuffers: false });

        expect(built?.data.yeast).toEqual({
            racks: {
                'device-a': { processors: [up] },
                'device-b': { processors: [down] },
            },
        });
    });

    it('omits the yeast section when no device rack holds a processor', async () => {
        arrangementStoreMock.value = sanitize_arrangement_store_state({
            arrangements: [],
            activeArrangementId: null,
        });
        trackStoreMock.value.tracks = [yeastDeviceTrack('track-a', 'device-a')];

        const built = await buildProjectData({ includeAudioBuffers: false });

        expect(built?.data.yeast).toBeUndefined();
    });

    it('refuses to serialize a version-2 snapshot before identity migration', async () => {
        arrangementStoreMock.value = sanitize_arrangement_store_state({
            arrangements: [],
            activeArrangementId: null,
        });
        projectStoreMock.value.projectId = undefined;

        await expect(buildProjectData({ includeAudioBuffers: false })).resolves.toBeNull();
        expect(exportCachedAudioBuffersMock).not.toHaveBeenCalled();
    });

    it('refuses to serialize while canonical identity persistence is pending', async () => {
        arrangementStoreMock.value = sanitize_arrangement_store_state({
            arrangements: [],
            activeArrangementId: null,
        });
        projectStoreMock.value.identityMigrationPending = true;

        await expect(buildProjectData({ includeAudioBuffers: false })).resolves.toBeNull();
        expect(exportCachedAudioBuffersMock).not.toHaveBeenCalled();
    });

    it('refuses a malformed identity before reaching the audio exporter', async () => {
        arrangementStoreMock.value = sanitize_arrangement_store_state({
            arrangements: [],
            activeArrangementId: null,
        });
        projectStoreMock.value.projectId = 'not-a-uuid';

        await expect(buildProjectData({ includeAudioBuffers: true })).resolves.toBeNull();
        expect(exportCachedAudioBuffersMock).not.toHaveBeenCalled();
    });

    // Presence pin for the assertion above (ADR 0015 rule 4): the opt-in shape
    // — the explicit `.sourdaw` export, now the only caller that asks for it —
    // really does reach the exporter and really does embed what it returns.
    // Without this, "no live path embeds audio" would be satisfiable by an
    // exporter that never runs at all.
    it('embeds the exporter output when audio embedding is on', async () => {
        arrangementStoreMock.value = sanitize_arrangement_store_state({
            arrangements: [],
            activeArrangementId: null,
        });
        exportCachedAudioBuffersMock.mockResolvedValue({
            'buffer-1': { sampleRate: 48_000, numberOfChannels: 1, channelData: ['QUJD'] },
        });

        const built = await buildProjectData({ includeAudioBuffers: true });

        expect(exportCachedAudioBuffersMock).toHaveBeenCalledWith({ bufferIds: [] });
        expect(built?.data.audioBuffers).toEqual({
            'buffer-1': { sampleRate: 48_000, numberOfChannels: 1, channelData: ['QUJD'] },
        });
    });

    it('binds only freeze-exclusive exports to the project envelope', async () => {
        arrangementStoreMock.value = sanitize_arrangement_store_state({
            arrangements: [
                {
                    id: 'arrangement-1',
                    name: 'Arrangement 1',
                    tracks: {
                        tracks: [
                            {
                                id: 'track-1',
                                freezeState: { status: 'frozen', frozenBufferId: 'freeze-track-1' },
                            },
                            {
                                id: 'track-2',
                                freezeState: { status: 'frozen', frozenBufferId: 'mixed-buffer' },
                                clips: [
                                    {
                                        id: 'clip-2',
                                        trackId: 'track-2',
                                        name: 'Shared source',
                                        startBeat: 0,
                                        endBeat: 4,
                                        type: 'audio',
                                        audioBufferId: 'mixed-buffer',
                                        fadeInBeats: 0,
                                        fadeOutBeats: 0,
                                        gain: 1,
                                        color: '#fff',
                                        locked: false,
                                        muted: false,
                                    },
                                ],
                            },
                        ],
                        selectedTrackId: null,
                    },
                    automation: { lanes: [] },
                    midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
                },
            ],
            activeArrangementId: 'arrangement-1',
        });
        const buffer = { sampleRate: 48_000, numberOfChannels: 1, channelData: ['QUJD'] };
        exportCachedAudioBuffersMock.mockResolvedValue({ 'freeze-track-1': buffer, 'mixed-buffer': buffer });

        const built = await buildProjectData({ includeAudioBuffers: true });

        expect(built?.data.audioBuffers).toEqual({
            'freeze-track-1': { ...buffer, freezeProjectId: 1 },
            'mixed-buffer': buffer,
        });
    });

    it('serializes the current chord-track read contract into project truth', async () => {
        arrangementStoreMock.value = sanitize_arrangement_store_state({
            arrangements: [],
            activeArrangementId: null,
        });

        const built = await buildProjectData();

        expect(built?.data.chordTrack).toEqual(chordTrackStoreMock.value);
        expect(built?.data.chordTrack).not.toBe(chordTrackStoreMock.value);
        expect(built?.data.chordTrack?.events).not.toBe(chordTrackStoreMock.value.events);
    });

    it('persists durable Yeast processor identities without runtime state', async () => {
        arrangementStoreMock.value = sanitize_arrangement_store_state({
            arrangements: [],
            activeArrangementId: null,
        });
        trackStoreMock.value.tracks = [yeastDeviceTrack('track-yeast', 'device-durable')];
        yeastRacksMock['device-durable'] = {
            processors: [{ id: 'durable-groove', type: 'groove', name: 'Groove', bypassed: false }],
        };
        yeastStoreMock.value = {
            processors: [{ id: 'durable-groove', type: 'groove', name: 'Groove', bypassed: false }],
            uiLevel: 3,
            runtimeStatus: 'ready',
        };

        const built = await buildProjectData();

        expect(built?.data.yeast).toEqual({
            racks: {
                'device-durable': {
                    processors: [{ id: 'durable-groove', type: 'groove', name: 'Groove', bypassed: false }],
                },
            },
        });
        expect(built?.data.yeast).not.toHaveProperty('uiLevel');
        expect(built?.data.yeast).toMatchObject({
            racks: { 'device-durable': {} },
        });
        expect(built?.data.yeast).not.toMatchObject({
            racks: { 'device-durable': { runtimeStatus: expect.anything() } },
        });
    });

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

    it('serializes arrangement MIDI maps without a stale project probability seed', async () => {
        arrangementStoreMock.value = {
            arrangements: [
                {
                    id: 'legacy-arrangement',
                    name: 'Legacy',
                    tracks: { tracks: [], selectedTrackId: null },
                    automation: { lanes: [] },
                    midi: {
                        probabilitySeed: 123,
                        notesByClipId: { legacy: [] },
                        ccByClipId: {},
                        pitchBendByClipId: {},
                    },
                },
            ],
            activeArrangementId: 'legacy-arrangement',
        };

        const built = await buildProjectData();
        const arrangementMidi = built?.data.arrangements?.[0]?.midi;

        expect(built?.data.midi.probabilitySeed).toBe(0xdecafbad);
        expect(arrangementMidi).toEqual({ notesByClipId: { legacy: [] }, ccByClipId: {}, pitchBendByClipId: {} });
        expect(arrangementMidi).not.toHaveProperty('probabilitySeed');
    });
});
