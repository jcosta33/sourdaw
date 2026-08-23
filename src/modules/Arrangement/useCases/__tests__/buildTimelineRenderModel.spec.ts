import { describe, it, expect, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { LEGACY_MIDI_PROBABILITY_SEED } from '#/modules/MIDI/stores';
import { playheadPositionRef } from '#/modules/Transport/stores';

import { createTrack } from '../../models/Track';
import { activeRecordingRef } from '../../stores/activeRecordingRef';
import { clipDragPreviewRef } from '../../stores/clipDragPreviewRef';
import { inlineMidiNotePreviewRef } from '../../stores/inlineMidiNotePreviewRef';
import { buildTimelineRenderModel } from '../buildTimelineRenderModel';

import type { MidiStoreState } from '#/modules/MIDI/stores';
import type { Preferences } from '#/modules/Preferences/stores';
import type { TransportState } from '#/modules/Transport/stores';
import type { TimelineViewState } from '../../stores/timelineViewStore';
import type { TrackStoreState } from '../../stores/trackStore';

const {
    trackStoreMock,
    transportStoreMock,
    timelineViewStoreMock,
    midiStoreMock,
    clipSelectionStoreMock,
    preferencesStoreMock,
} = vi.hoisted(() => ({
    trackStoreMock: { value: null as TrackStoreState | null, set: vi.fn(), subscribe: vi.fn(() => () => undefined) },
    transportStoreMock: { value: null as Partial<TransportState> | null, set: vi.fn() },
    timelineViewStoreMock: { value: null as Partial<TimelineViewState> | null, set: vi.fn() },
    midiStoreMock: { value: null as MidiStoreState | null, set: vi.fn() },
    clipSelectionStoreMock: {
        value: null as { selectedClipId: string | null; selectedClipIds: string[] } | null,
        set: vi.fn(),
    },
    preferencesStoreMock: { value: null as Partial<Preferences> | null, set: vi.fn() },
}));

vi.mock('../../stores/trackStore', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, trackStore: trackStoreMock };
});
vi.mock('#/modules/Transport/stores', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, transportStore: transportStoreMock, playheadPositionRef: { current: 0 } };
});
vi.mock('../../stores/timelineViewStore', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, timelineViewStore: timelineViewStoreMock };
});
vi.mock('#/modules/MIDI/stores', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, midiStore: midiStoreMock };
});
vi.mock('../../stores/clipSelectionStore', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        clipSelectionStore: clipSelectionStoreMock,
    };
});
vi.mock('#/modules/Preferences/stores', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, preferencesStore: preferencesStoreMock };
});
vi.mock('../../stores/clipDragPreviewRef', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, clipDragPreviewRef: { current: null } };
});
vi.mock('../../stores/inlineMidiNotePreviewRef', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, inlineMidiNotePreviewRef: { current: null } };
});
vi.mock('../../stores/activeRecordingRef', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, activeRecordingRef: { current: [] } };
});

describe('buildTimelineRenderModel', () => {
    it('returns a model with tracks from the injected track store', () => {
        trackStoreMock.value = {
            tracks: [
                {
                    ...createTrack({ id: 't1', name: 'One', kind: 'midi' }),
                    clips: [],
                    devices: [],
                    gain: 1,
                    pan: 0,
                    muted: false,
                    soloed: false,
                    armed: false,
                    disabled: false,
                    height: 48,
                    outputId: 'hw_out',
                    sends: [],
                    parentId: null,
                    color: '#000',
                    automationMode: 'read',
                },
            ],
            selectedTrackId: null,
        };
        transportStoreMock.value = {
            tempo: 120,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
        };
        playheadPositionRef.current = 0;
        timelineViewStoreMock.value = { pixelsPerBeat: 12, scrollX: 0, scrollY: 0 };
        midiStoreMock.value = {
            probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        clipSelectionStoreMock.value = { selectedClipId: null, selectedClipIds: [] };
        preferencesStoreMock.value = { trackHeight: 'normal' };
        clipDragPreviewRef.current = null;
        activeRecordingRef.current = [];

        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 800 });

        const model = buildTimelineRenderModel();
        expect(model.tracks).toHaveLength(1);
        expect(model.tracks[0]!.id).toBe('t1');
        expect(model.viewportEndBeat).toBeGreaterThan(0);
    });

    // Regression: the transport store mints a new object every playhead tick
    // during playback. Keying cache invalidation on the whole object rebuilt
    // the entire track/clip tree every frame. Only render-affecting transport
    // fields (tempo) should bust the cache.
    it('does not rebuild the track tree when only playhead-only transport fields change', () => {
        trackStoreMock.value = {
            tracks: [
                {
                    ...createTrack({ id: 't1', name: 'One', kind: 'midi' }),
                    clips: [],
                    color: '#000',
                    muted: false,
                    soloed: false,
                    height: 48,
                    parentId: null,
                    automationMode: 'read',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
            selectedTrackId: null,
        };
        timelineViewStoreMock.value = { pixelsPerBeat: 12, scrollX: 0, scrollY: 0 };
        midiStoreMock.value = {
            probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        clipSelectionStoreMock.value = { selectedClipId: null, selectedClipIds: [] };
        preferencesStoreMock.value = { trackHeight: 'normal' };
        clipDragPreviewRef.current = null;
        activeRecordingRef.current = [];
        playheadPositionRef.current = 0;

        // First build — tempo 120, playhead 0.
        transportStoreMock.value = { tempo: 120, isPlaying: true, playheadPosition: 0 };
        const first = buildTimelineRenderModel();
        const tracksRef = first.tracks;

        // Simulate a playhead tick: a NEW transport object, same tempo, advanced
        // playhead. The track tree must be reused (same array reference).
        transportStoreMock.value = { tempo: 120, isPlaying: true, playheadPosition: 4 };
        playheadPositionRef.current = 4;
        const second = buildTimelineRenderModel();
        expect(second.tracks).toBe(tracksRef);
        expect(second.playheadPosition).toBe(4);

        // Changing tempo IS render-affecting and must rebuild the tree.
        transportStoreMock.value = { tempo: 140, isPlaying: true, playheadPosition: 4 };
        const third = buildTimelineRenderModel();
        expect(third.tracks).not.toBe(tracksRef);
        expect(third.tempo).toBe(140);
    });
});

// Minimal clip/note factories: fill required Clip/MidiNote fields the render-
// model does not read, so fixtures specify only the fields under test.
type TestClip = TrackStoreState['tracks'][number]['clips'][number];
type TestNote = MidiStoreState['notesByClipId'][string][number];

function clip(overrides: Partial<TestClip> & Pick<TestClip, 'id'>): TestClip {
    return {
        trackId: 't',
        name: 'clip',
        startBeat: 0,
        endBeat: 4,
        type: 'midi',
        color: '#000',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        locked: false,
        muted: false,
        ...overrides,
    };
}

function note(overrides: Partial<TestNote>): TestNote {
    return { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100, ...overrides };
}

// Seed all stores to a clean baseline, then apply overrides. Each test gets a
// deterministically fresh renderCache (cleared by changing the track ref).
function seedStores(overrides: {
    tracks?: TrackStoreState['tracks'];
    midiByClip?: Record<string, TestNote[]>;
    selectedClipId?: string | null;
    transport?: Partial<TransportState>;
    view?: Partial<TimelineViewState>;
    ghostClips?: NonNullable<TrackStoreState['ghostClips']>;
}): void {
    trackStoreMock.value = {
        tracks: overrides.tracks ?? [],
        selectedTrackId: null,
        ghostClips: overrides.ghostClips ?? [],
    };
    transportStoreMock.value = { tempo: 120, isRecording: false, ...overrides.transport };
    timelineViewStoreMock.value = { pixelsPerBeat: 12, scrollX: 0, scrollY: 0, ...overrides.view };
    midiStoreMock.value = {
        probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
        notesByClipId: overrides.midiByClip ?? {},
        ccByClipId: {},
        pitchBendByClipId: {},
    };
    clipSelectionStoreMock.value = {
        selectedClipId: overrides.selectedClipId ?? null,
        selectedClipIds: [],
    };
    preferencesStoreMock.value = { trackHeight: 'normal' };
    clipDragPreviewRef.current = null;
    activeRecordingRef.current = [];
    inlineMidiNotePreviewRef.current = null;
    playheadPositionRef.current = 0;
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 800 });
}

describe('buildTimelineRenderModel — track visibility', () => {
    it('hides master tracks from the rendered list', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 'm', name: 'Master', kind: 'master' }),
                    clips: [],
                    color: '#000',
                    alternatives: [],
                    showVariationLanes: false,
                },
                {
                    ...createTrack({ id: 't', name: 'Track', kind: 'midi' }),
                    clips: [],
                    color: '#000',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
        });
        expect(buildTimelineRenderModel().tracks.map((t) => t.id)).toEqual(['t']);
    });

    it('hides children of a collapsed folder but shows top-level tracks', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 'folder', name: 'Folder', kind: 'folder' }),
                    clips: [],
                    color: '#000',
                    collapsed: true,
                    alternatives: [],
                    showVariationLanes: false,
                },
                {
                    ...createTrack({ id: 'child', name: 'Child', kind: 'midi', parentId: 'folder' }),
                    clips: [],
                    color: '#000',
                    alternatives: [],
                    showVariationLanes: false,
                },
                {
                    ...createTrack({ id: 'top', name: 'Top', kind: 'midi' }),
                    clips: [],
                    color: '#000',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
        });
        const ids = buildTimelineRenderModel().tracks.map((t) => t.id);
        expect(ids).toContain('folder');
        expect(ids).toContain('top');
        expect(ids).not.toContain('child');
    });

    it('uses the folder height (26) for folder tracks and the track height otherwise', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 'f', name: 'F', kind: 'folder' }),
                    clips: [],
                    color: '#000',
                    height: 80,
                    alternatives: [],
                    showVariationLanes: false,
                },
                {
                    ...createTrack({ id: 'm', name: 'M', kind: 'midi' }),
                    clips: [],
                    color: '#000',
                    height: 48,
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
        });
        const model = buildTimelineRenderModel();
        expect(model.tracks.find((t) => t.id === 'f')?.height).toBe(26);
        expect(model.tracks.find((t) => t.id === 'm')?.height).toBe(48);
    });
});

describe('buildTimelineRenderModel — clip mapping', () => {
    it('falls back to the track colour when the clip has none', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 't', name: 'T', kind: 'midi' }),
                    clips: [clip({ id: 'c1', color: '' })],
                    color: '#abc123',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
        });
        const mapped = buildTimelineRenderModel().tracks[0]!.clips[0]!;
        expect(mapped.color).toBe('#abc123');
    });

    it('maps midi notes from the midi store onto the clip', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 't', name: 'T', kind: 'midi' }),
                    clips: [clip({ id: 'c1' })],
                    color: '#000',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
            midiByClip: { c1: [note({ pitch: 60 }), note({ pitch: 64, startBeat: 1 })] },
        });
        const notes = buildTimelineRenderModel().tracks[0]!.clips[0]!.midiNotes;
        expect(notes.map((n) => n.pitch)).toEqual([60, 64]);
    });

    it('marks a clip linked when it is a linked instance or has a parentClipId', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 't', name: 'T', kind: 'midi' }),
                    clips: [
                        clip({ id: 'c1', isLinkedInstance: true }),
                        clip({ id: 'c2', parentClipId: 'c1' }),
                        clip({ id: 'c3' }),
                    ],
                    color: '#000',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
        });
        const clips = buildTimelineRenderModel().tracks[0]!.clips;
        expect(clips.find((c) => c.id === 'c1')?.isLinkedInstance).toBe(true);
        expect(clips.find((c) => c.id === 'c2')?.isLinkedInstance).toBe(true);
        expect(clips.find((c) => c.id === 'c3')?.isLinkedInstance).toBe(false);
    });

    it('appends ghost clips for the track and marks them isGhost', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 't', name: 'T', kind: 'audio' }),
                    clips: [],
                    color: '#000',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
            ghostClips: [
                {
                    ...clip({
                        id: 'g1',
                        trackId: 't',
                        name: 'ghost',
                        startBeat: 8,
                        endBeat: 12,
                        type: 'audio',
                        color: '',
                    }),
                },
            ],
        });
        const clips = buildTimelineRenderModel().tracks[0]!.clips;
        expect(clips[0]!.id).toBe('g1');
        expect(clips[0]!.isGhost).toBe(true);
        expect(clips[0]!.startBeat).toBe(8);
    });
});

describe('buildTimelineRenderModel — recording overlay', () => {
    it('extends a recording clip’s endBeat to the live playhead position', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 't', name: 'T', kind: 'audio' }),
                    clips: [clip({ id: 'rec', startBeat: 0, endBeat: 2, type: 'audio' })],
                    color: '#000',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
            transport: { isRecording: true },
        });
        playheadPositionRef.current = 7;
        activeRecordingRef.current = ['rec'];
        const model = buildTimelineRenderModel();
        expect(model.dataDirty).toBe(true);
        expect(model.tracks[0]!.clips[0]!.endBeat).toBe(7);
    });

    it('clamps the recording endBeat to at least the clip start', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 't', name: 'T', kind: 'audio' }),
                    clips: [clip({ id: 'rec', startBeat: 5, endBeat: 6, type: 'audio' })],
                    color: '#000',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
            transport: { isRecording: true },
        });
        playheadPositionRef.current = 1;
        activeRecordingRef.current = ['rec'];
        expect(buildTimelineRenderModel().tracks[0]!.clips[0]!.endBeat).toBe(5);
    });
});

describe('buildTimelineRenderModel — drag preview', () => {
    it('repositions clips present in the drag preview and leaves others in place', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 't', name: 'T', kind: 'midi' }),
                    clips: [clip({ id: 'c1' }), clip({ id: 'c2', startBeat: 8, endBeat: 12 })],
                    color: '#000',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
        });
        clipDragPreviewRef.current = {
            positions: new Map([['c1', { trackId: 't', startBeat: 100, endBeat: 104 }]]),
            originals: new Map(),
        };
        const clips = buildTimelineRenderModel().tracks[0]!.clips;
        expect(clips.find((c) => c.id === 'c1')?.startBeat).toBe(100);
        expect(clips.find((c) => c.id === 'c2')?.startBeat).toBe(8);
        expect(buildTimelineRenderModel().dataDirty).toBe(true);
    });

    it('returns the unchanged model when the preview is empty', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 't', name: 'T', kind: 'midi' }),
                    clips: [clip({ id: 'c1' })],
                    color: '#000',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
        });
        clipDragPreviewRef.current = { positions: new Map(), originals: new Map() };
        expect(buildTimelineRenderModel().tracks[0]!.clips[0]!.startBeat).toBe(0);
    });
});

describe('buildTimelineRenderModel — variation lanes', () => {
    it('builds variation-lane clips when the track shows variation lanes', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 't', name: 'T', kind: 'midi' }),
                    clips: [],
                    color: '#000',
                    showVariationLanes: true,
                    alternatives: [
                        { id: 'alt-1', name: 'Alt 1', clips: [clip({ id: 'altclip', startBeat: 0, endBeat: 2 })] },
                    ],
                },
            ],
        });
        const track = buildTimelineRenderModel().tracks[0]!;
        expect(track.variationLanes).toHaveLength(1);
        expect(track.variationLanes?.[0]!.clips[0]!.id).toBe('altclip');
    });

    it('omits variation lanes when showVariationLanes is false', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 't', name: 'T', kind: 'midi' }),
                    clips: [],
                    color: '#000',
                    showVariationLanes: false,
                    alternatives: [{ id: 'alt-1', name: 'Alt 1', clips: [] }],
                },
            ],
        });
        expect(buildTimelineRenderModel().tracks[0]!.variationLanes).toBeUndefined();
    });
});

describe('buildTimelineRenderModel — inline midi note preview', () => {
    it('overlays a pending note edit (pitch + startBeat) onto the matching clip note', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 't', name: 'T', kind: 'midi' }),
                    clips: [clip({ id: 'c1' })],
                    color: '#000',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
            midiByClip: { c1: [note({ id: 'n1', pitch: 60, startBeat: 0 })] },
        });
        inlineMidiNotePreviewRef.current = { clipId: 'c1', noteId: 'n1', pitch: 72, startBeat: 2 };
        const n = buildTimelineRenderModel().tracks[0]!.clips[0]!.midiNotes[0]!;
        expect(n.pitch).toBe(72);
        expect(n.startBeat).toBe(2);
    });

    it('leaves notes unchanged when the preview targets a non-existent note', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 't', name: 'T', kind: 'midi' }),
                    clips: [clip({ id: 'c1' })],
                    color: '#000',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
            midiByClip: { c1: [note({ pitch: 60, startBeat: 0 })] },
        });
        inlineMidiNotePreviewRef.current = { clipId: 'c1', noteId: 'missing', pitch: 72, startBeat: 2 };
        expect(buildTimelineRenderModel().tracks[0]!.clips[0]!.midiNotes[0]!.pitch).toBe(60);
    });

    it('leaves the model unchanged when the note preview targets a clip that is not on any track', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 't', name: 'T', kind: 'midi' }),
                    clips: [clip({ id: 'c1' })],
                    color: '#000',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
            midiByClip: { c1: [note({ pitch: 60, startBeat: 0 })] },
        });
        inlineMidiNotePreviewRef.current = { clipId: 'other-clip', noteId: 'n1', pitch: 72, startBeat: 2 };
        expect(buildTimelineRenderModel().tracks[0]!.clips[0]!.midiNotes[0]!.pitch).toBe(60);
    });
});

describe('buildTimelineRenderModel — recording overlay cache', () => {
    it('uses the fast path (mutating endBeat in place) when called again with the same model and rec clip set', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 't', name: 'T', kind: 'audio' }),
                    clips: [clip({ id: 'rec', startBeat: 0, endBeat: 2, type: 'audio' })],
                    color: '#000',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
            transport: { isRecording: true },
        });
        const recClips = ['rec'];
        activeRecordingRef.current = recClips;
        playheadPositionRef.current = 5;
        const first = buildTimelineRenderModel();
        expect(first.tracks[0]!.clips[0]!.endBeat).toBe(5);

        // Same recClips array identity, same underlying cached model → fast path.
        playheadPositionRef.current = 9;
        const second = buildTimelineRenderModel();
        expect(second.tracks[0]!.clips[0]!.endBeat).toBe(9);
        expect(second.dataDirty).toBe(true);
    });

    it('keeps non-recording clips on a track that also has a recording clip untouched', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 't', name: 'T', kind: 'audio' }),
                    clips: [
                        clip({ id: 'other', startBeat: 0, endBeat: 2, type: 'audio' }),
                        clip({ id: 'rec', startBeat: 4, endBeat: 6, type: 'audio' }),
                    ],
                    color: '#000',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
            transport: { isRecording: true },
        });
        activeRecordingRef.current = ['rec'];
        playheadPositionRef.current = 10;
        const model = buildTimelineRenderModel();
        const byId = new Map(model.tracks[0]!.clips.map((c) => [c.id, c]));
        expect(byId.get('rec')?.endBeat).toBe(10);
        expect(byId.get('other')?.endBeat).toBe(2);
    });

    it('reports a drift warning once when transport says not-recording but the rec ref still holds clips', () => {
        const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 't', name: 'T', kind: 'audio' }),
                    clips: [clip({ id: 'rec', startBeat: 0, endBeat: 2, type: 'audio' })],
                    color: '#000',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
            transport: { isRecording: false },
        });
        activeRecordingRef.current = ['rec'];

        buildTimelineRenderModel();
        buildTimelineRenderModel();
        // The one-shot latch reports the drift only on the first frame.
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0]![0]).toContain('drift detected');

        // Resetting the rec ref clears the latch so a future drift is reported again.
        activeRecordingRef.current = [];
        buildTimelineRenderModel();
        activeRecordingRef.current = ['rec'];
        buildTimelineRenderModel();
        expect(warnSpy).toHaveBeenCalledTimes(2);
        warnSpy.mockRestore();
    });
});

describe('buildTimelineRenderModel — drag preview offsets', () => {
    it('falls back to the base clip offsets when the preview position omits them', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 't', name: 'T', kind: 'audio' }),
                    clips: [
                        clip({
                            id: 'c1',
                            startBeat: 0,
                            endBeat: 4,
                            type: 'audio',
                            audioOffsetBeats: 1.5,
                            midiOffsetBeats: 0.5,
                        }),
                    ],
                    color: '#000',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
        });
        clipDragPreviewRef.current = {
            // Position supplies new beats but no offsets → must inherit base offsets.
            positions: new Map([['c1', { trackId: 't', startBeat: 100, endBeat: 104 }]]),
            originals: new Map(),
        };
        const mapped = buildTimelineRenderModel().tracks[0]!.clips[0]!;
        expect(mapped.startBeat).toBe(100);
        expect(mapped.endBeat).toBe(104);
        expect(mapped.audioOffsetBeats).toBe(1.5);
        expect(mapped.midiOffsetBeats).toBe(0.5);
    });

    it('keeps clips not present in the drag preview in their original order', () => {
        seedStores({
            tracks: [
                {
                    ...createTrack({ id: 't', name: 'T', kind: 'midi' }),
                    clips: [
                        clip({ id: 'c1', startBeat: 0, endBeat: 4 }),
                        clip({ id: 'c2', startBeat: 8, endBeat: 12 }),
                    ],
                    color: '#000',
                    alternatives: [],
                    showVariationLanes: false,
                },
            ],
        });
        clipDragPreviewRef.current = {
            positions: new Map([['c1', { trackId: 't', startBeat: 50, endBeat: 54 }]]),
            originals: new Map(),
        };
        const ids = buildTimelineRenderModel().tracks[0]!.clips.map((c) => c.id);
        expect(ids).toEqual(['c1', 'c2']);
    });
});
