import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore as undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, redo, REDO_NOT_APPLIED, resetActionReplayAuthority, undo } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { readClipSatelliteEntry, writeClipSatelliteEntry } from '../../../stores/clipSatelliteState';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
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
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        seed();
    });
    afterEach(() => {
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
