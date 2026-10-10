import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore as undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    pushUndoEntry,
    redo,
    REDO_NOT_APPLIED,
    resetActionReplayAuthority,
    revertActionGroup,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { readClipSatelliteEntry, writeClipSatelliteEntry } from '../../../stores/clipSatelliteState';
import { gainEnvelopeStore } from '../../../stores/gainEnvelopeStore';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { warpStateStore } from '../../../stores/warpStates';
import { removeClip } from '../../clip/removeClip';
import { getArrangementHandlers } from '../../getArrangementHandlers';
import { splitClipWithUndo } from '../splitClipWithUndo';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

function clips() {
    return trackStore.value!.tracks[0]!.clips;
}
function entry() {
    const entry = undoStore.value?.past.at(-1);
    if (!entry || entry.kind !== 'callback') {
        throw new Error('expected callback split history');
    }
    return entry;
}
function seed(overrides: Parameters<typeof ClipDummy.create>[0] = {}) {
    const clip = ClipDummy.create({
        id: 'c1',
        name: 'Groove',
        startBeat: 0,
        endBeat: 8,
        fadeOutBeats: 0.5,
        ...overrides,
    });
    trackStore.set({ tracks: [TrackDummy.create({ clips: [clip] })], selectedTrackId: 'track-1', ghostClips: [] });
    flushAutomergeStorageWrites();
    return clip;
}

function expectProjectUnchanged() {
    flushAutomergeStorageWrites();
    const document = getCrdtDoc('root');
    expect(document).toBeDefined();
    const facets = {
        tracks: trackStore.value,
        midi: midiStore.value,
        takes: takeLaneStore.value,
        envelopes: gainEnvelopeStore.value,
        warp: warpStateStore.value,
        automation: automationStore.value,
    };
    const before = structuredClone(facets);
    const writes = [
        vi.spyOn(trackStore, 'set'),
        vi.spyOn(midiStore, 'set'),
        vi.spyOn(takeLaneStore, 'set'),
        vi.spyOn(gainEnvelopeStore, 'set'),
        vi.spyOn(warpStateStore, 'set'),
        vi.spyOn(automationStore, 'set'),
    ];
    return () => {
        flushAutomergeStorageWrites();
        expect(getCrdtDoc('root')).toBe(document);
        expect({
            tracks: trackStore.value,
            midi: midiStore.value,
            takes: takeLaneStore.value,
            envelopes: gainEnvelopeStore.value,
            warp: warpStateStore.value,
            automation: automationStore.value,
        }).toStrictEqual(before);
        for (const write of writes) {
            expect(write).not.toHaveBeenCalled();
        }
    };
}

describe('splitClipWithUndo prepared callback replay', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('split callbacks');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        takeLaneStore.set({ lanes: [] });
        automationStore.set({ lanes: [] });
        gainEnvelopeStore.set({ envelopes: {} });
        warpStateStore.set({ states: {} });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        seed();
    });
    afterEach(() => {
        vi.restoreAllMocks();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.clearAllMocks();
    });
    it('does nothing when the clip does not exist', () => {
        splitClipWithUndo('missing', 4);
        expect(undoStore.value?.past).toEqual([]);
        expect(clips()).toHaveLength(1);
    });
    it('rejects a clip whose recorded owner differs from its track without changing history or clips', () => {
        const original = seed({ trackId: 'other-track' });
        splitClipWithUndo('c1', 4);
        expect(clips()).toStrictEqual([original]);
        expect(undoStore.value?.past).toEqual([]);
    });
    it('does not push history for a rejected split', () => {
        splitClipWithUndo('c1', 0);
        expect(undoStore.value?.past).toEqual([]);
        expect(clips()).toHaveLength(1);
    });
    it('retains the callback history route after a successful split', () => {
        splitClipWithUndo('c1', 4);
        expect(entry().label).toBe('Split clip');
        expect(clips().map((clip) => [clip.startBeat, clip.endBeat])).toEqual([
            [0, 4],
            [4, 8],
        ]);
    });
    it.each(['absent', 'populated'] as const)(
        'undo and redo retain exact source fields with %s optional state',
        async (presence) => {
            const fields: NonNullable<Parameters<typeof ClipDummy.create>[0]> = { audioOffsetBeats: 2 };
            if (presence === 'populated') {
                fields.overrides = { gain: true };
                fields.kneadState = {
                    retuneSpeedMs: 10,
                    humanizePercent: 20,
                    formantPreserve: true,
                    blobs: [
                        {
                            id: 'blob',
                            startTime: 0.1,
                            endTime: 0.9,
                            pitchCenterCents: 100,
                            originalPitchCenterCents: 80,
                            pitchCurveCents: [-50, 0, 50],
                            voicedConfidence: 0.8,
                        },
                    ],
                };
            }
            const original = seed(fields);
            expect(Object.hasOwn(original, 'overrides')).toBe(presence === 'populated');
            expect(Object.hasOwn(original, 'kneadState')).toBe(presence === 'populated');
            splitClipWithUndo('c1', 4);
            const split = structuredClone(clips());
            expect(clips()[0]?.audioOffsetSeconds).toBeDefined();
            await undo();
            expect(clips()).toStrictEqual([original]);
            expect(Object.hasOwn(clips()[0]!, 'audioOffsetSeconds')).toBe(false);
            expect(Object.hasOwn(clips()[0]!, 'overrides')).toBe(presence === 'populated');
            expect(Object.hasOwn(clips()[0]!, 'kneadState')).toBe(presence === 'populated');
            await redo();
            expect(clips()).toStrictEqual(split);
            for (const clip of clips()) {
                expect(Object.hasOwn(clip, 'overrides')).toBe(presence === 'populated');
                expect(Object.hasOwn(clip, 'kneadState')).toBe(presence === 'populated');
            }
        }
    );
    it('redo restores the same right id and geometry from its capture', async () => {
        splitClipWithUndo('c1', 4);
        const split = structuredClone(clips());
        await undo();
        await redo();
        expect(clips()).toEqual(split);
    });
    it('restores source and right MIDI notes and expression identities exactly', async () => {
        seed({ type: 'midi' });
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: { c1: [{ id: 'note', pitch: 60, startBeat: 3, duration: 3, velocity: 80 }] },
            ccByClipId: { c1: [{ id: 'cc', controller: 1, value: 64, beat: 6, channel: 0 }] },
            pitchBendByClipId: { c1: [{ id: 'bend', value: 100, beat: 6, channel: 0 }] },
        });
        flushAutomergeStorageWrites();
        const before = structuredClone(midiStore.value);
        splitClipWithUndo('c1', 4);
        const split = structuredClone(midiStore.value);
        expect(Object.keys(split!.notesByClipId)).toHaveLength(2);
        await undo();
        expect(midiStore.value).toEqual(before);
        await redo();
        expect(midiStore.value).toEqual(split);
    });
    it('reports REDO_NOT_APPLIED without writes when the destination is occupied', async () => {
        splitClipWithUndo('c1', 4);
        const callback = entry();
        const right = clips()[1]!;
        await undo();
        trackStore.set({
            ...trackStore.value!,
            tracks: [{ ...trackStore.value!.tracks[0]!, clips: [...clips(), { ...right, name: 'Peer destination' }] }],
        });
        const occupied = structuredClone(clips());
        expect(callback.redo()).toBe(REDO_NOT_APPLIED);
        expect(clips()).toEqual(occupied);
    });
    it.each(['audio', 'midi'] as const)(
        'advances real undo and redo past a removed %s lineage without writing any project facet',
        async (type) => {
            seed({ type });
            midiStore.set({
                probabilitySeed: 1,
                notesByClipId: { c1: [{ id: 'note', pitch: 60, startBeat: 3, duration: 3, velocity: 80 }] },
                ccByClipId: {},
                pitchBendByClipId: {},
            });
            writeClipSatelliteEntry({
                clipId: 'c1',
                gainEnvelope: { clipId: 'c1', enabled: true, points: [{ id: 'point', beatOffset: 0, gainDb: -3 }] },
                warpState: { enabled: true, markers: [], stretchMode: 'repitch', originalTempo: 120 },
            });
            if (type === 'audio') {
                takeLaneStore.set({
                    lanes: [
                        {
                            id: 'takes',
                            trackId: 'track-1',
                            takes: [
                                { id: 'take', clipId: 'c1', name: 'Take', startBeat: 0, endBeat: 8, selected: true },
                            ],
                            activeCompRegions: [],
                        },
                    ],
                });
            }
            automationStore.set({
                lanes: [
                    {
                        id: 'automation',
                        trackId: 'track-1',
                        clipId: 'c1',
                        parameterId: 'gain',
                        parameterName: 'Gain',
                        points: [{ beat: 1, value: 0.5, curve: 'linear', tension: 0 }],
                        objects: [],
                        visible: true,
                        enabled: true,
                        collapsed: false,
                        minValue: 0,
                        maxValue: 1,
                    },
                ],
            });
            const earlierRedo = vi.fn();
            pushUndoEntry(
                'AI creation',
                () => {
                    for (const clip of [...clips()]) {
                        removeClip(clip.id);
                    }
                },
                earlierRedo,
                { groupId: 'ai-plan', groupLabel: 'AI plan' }
            );
            splitClipWithUndo('c1', 4);
            const splitEntry = entry();
            expect(clips()).toHaveLength(2);
            await revertActionGroup('ai-plan');
            expect(clips()).toEqual([]);
            expect(midiStore.value?.notesByClipId).toEqual({});
            expect(takeLaneStore.value?.lanes).toEqual([]);
            expect(gainEnvelopeStore.value?.envelopes).toEqual({});
            expect(warpStateStore.value?.states).toEqual({});
            expect(automationStore.value?.lanes).toEqual([]);
            const assertUnchanged = expectProjectUnchanged();

            await undo();
            expect(undoStore.value?.future[0]).toBe(splitEntry);
            expect(splitEntry.redo()).toBe(REDO_NOT_APPLIED);
            await redo();
            expect(earlierRedo).toHaveBeenCalledTimes(1);
            assertUnchanged();
        }
    );
    it.each(['left', 'right'] as const)('refuses undo when only the %s half survives', async (half) => {
        splitClipWithUndo('c1', 4);
        removeClip(half === 'left' ? clips()[1]!.id : 'c1');
        const assertUnchanged = expectProjectUnchanged();
        await expect(undo()).rejects.toThrow('Cannot undo split clip: project state has changed');
        assertUnchanged();
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toEqual([]);
    });
    it.each([
        ['reused', 'left'],
        ['reused', 'right'],
        ['moved', 'left'],
        ['moved', 'right'],
        ['alternative', 'left'],
        ['alternative', 'right'],
        ['changed', 'left'],
        ['changed', 'right'],
        ['ineligible', 'left'],
        ['ambiguous', 'left'],
    ] as const)('refuses undo without writes when a split identity is %s (%s half)', async (change, half) => {
        splitClipWithUndo('c1', 4);
        const state = structuredClone(trackStore.value!);
        const track = state.tracks[0]!;
        const target = track.clips[half === 'left' ? 0 : 1]!;
        if (change === 'reused') {
            track.clips = [{ ...target, name: 'Replacement', endBeat: 12 }];
        } else if (change === 'moved') {
            track.clips = [];
            state.tracks.push(TrackDummy.create({ id: 'peer', clips: [{ ...target, trackId: 'peer' }] }));
        } else if (change === 'alternative') {
            track.clips = [];
            track.alternatives = [{ id: 'parked', name: 'Parked', clips: [target] }];
        } else if (change === 'changed') {
            target.gain = 0.25;
        } else if (change === 'ineligible') {
            track.clips = [target];
            Object.defineProperty(track, 'kind', { value: 'vca', enumerable: true });
        } else {
            track.clips = [];
            state.tracks.push(track);
        }
        // A runtime read seam preserves malformed state instead of letting the store sanitize it.
        vi.spyOn(trackStore, 'value', 'get').mockReturnValue(state);
        const assertUnchanged = expectProjectUnchanged();
        await expect(undo()).rejects.toThrow('Cannot undo split clip: project state has changed');
        assertUnchanged();
        expect(undoStore.value?.past).toHaveLength(1);
    });
    it.each(['missing', 'malformed', 'malformed-alternative'] as const)(
        'refuses undo without writes for a %s project',
        async (kind) => {
            splitClipWithUndo('c1', 4);
            const state = structuredClone(trackStore.value!);
            state.tracks[0]!.clips = [];
            if (kind === 'malformed') {
                Object.defineProperty(state, 'tracks', { value: {}, enumerable: true });
            } else if (kind === 'malformed-alternative') {
                Object.defineProperty(state.tracks[0]!.alternatives[0]!, 'clips', { value: {}, enumerable: true });
            }
            vi.spyOn(trackStore, 'value', 'get').mockReturnValue(kind === 'missing' ? null : state);
            const assertUnchanged = expectProjectUnchanged();
            await expect(undo()).rejects.toThrow();
            assertUnchanged();
            expect(undoStore.value?.past).toHaveLength(1);
        }
    );
    it('restores the source satellites on undo and exact repartitioned satellites on redo', async () => {
        writeClipSatelliteEntry({
            clipId: 'c1',
            gainEnvelope: { clipId: 'c1', enabled: true, points: [{ id: 'p0', beatOffset: 0, gainDb: -3 }] },
            warpState: null,
        });
        const before = structuredClone(readClipSatelliteEntry('c1'));
        splitClipWithUndo('c1', 4);
        const rightId = clips()[1]!.id;
        const left = structuredClone(readClipSatelliteEntry('c1'));
        const right = structuredClone(readClipSatelliteEntry(rightId));
        expect(left.gainEnvelope?.points).toHaveLength(2);
        expect(right.gainEnvelope?.points).toHaveLength(2);
        await undo();
        expect(readClipSatelliteEntry('c1')).toEqual(before);
        expect(readClipSatelliteEntry(rightId)).toEqual({ clipId: rightId, gainEnvelope: null, warpState: null });
        await redo();
        expect(readClipSatelliteEntry('c1')).toEqual(left);
        expect(readClipSatelliteEntry(rightId)).toEqual(right);
    });
});
