import { describe, expect, it } from 'vitest';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { TrackDummy } from '../../__tests__/TrackDummy';
import { type TakeLane } from '../../models/TakeLane';
import { captureTempoAudioSources } from '../../useCases/comping/captureTempoAudioSources';
import { projectTempoAudioSources } from '../tempoAudioSources';

function fixture() {
    const clip = ClipDummy.create({
        id: 'source',
        trackId: 'audio',
        type: 'audio',
        startBeat: 0,
        endBeat: 12,
        audioBufferId: 'bursts',
        audioOffsetBeats: 8,
        loopEnabled: true,
        loopLength: 4,
        stretchMode: 'timestretch',
        stretchRatio: 2,
    });
    const tracks = [
        TrackDummy.create({
            id: 'audio',
            activeAlternativeId: 'main',
            clips: [clip],
            alternatives: [
                { id: 'main', name: 'Main', clips: [] },
                { id: 'other', name: 'Other', clips: [{ ...clip, id: 'alternate', audioOffsetBeats: 12 }] },
            ],
        }),
    ];
    const lanes: TakeLane[] = [
        {
            id: 'lane',
            trackId: 'audio',
            takes: [
                {
                    id: 'take',
                    clipId: 'source',
                    name: 'Take',
                    startBeat: 0,
                    endBeat: 12,
                    selected: true,
                    sourceOffsetBeats: 4,
                },
            ],
            activeCompRegions: [{ takeId: 'take', startBeat: 1, endBeat: 11 }],
        },
    ];
    const plan = captureTempoAudioSources(tracks, lanes, {
        secondsAtBeat: (beat) => beat / 2,
        beatAtSeconds: (seconds) => seconds * 2,
        tempoAtBeat: () => 120,
    });
    if (!plan) {
        throw new Error('Expected the actual old-map source capture');
    }
    return { tracks, lanes, plan };
}

describe('bounded tempo audio source facets', () => {
    it('round trips exact source-field and tile-array absence without changing the source values', () => {
        const { tracks, lanes, plan } = fixture();
        const before = structuredClone({ tracks, lanes });
        const promoted = projectTempoAudioSources(tracks, lanes, plan, 'promote');
        expect(promoted?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(4);
        expect(promoted?.tracks[0]?.alternatives[1]?.clips[0]?.audioOffsetSeconds).toBe(6);
        expect(promoted?.lanes[0]?.takes[0]?.sourceOffsetSeconds).toBe(2);
        expect(promoted?.lanes[0]?.activeCompRegions[0]?.audioSource?.audioOffsetSeconds).toBe(6.5);
        expect(
            promoted?.lanes[0]?.baseGapAudioSources?.map((tile) => ({
                clipId: tile.clipId,
                entry: tile.audioSource.audioOffsetSeconds,
            }))
        ).toEqual([
            { clipId: 'alternate', entry: 6 },
            { clipId: 'alternate', entry: 11.5 },
            { clipId: 'source', entry: 4 },
            { clipId: 'source', entry: 9.5 },
        ]);
        if (!promoted) {
            throw new Error('Expected source promotion');
        }
        expect(projectTempoAudioSources(promoted.tracks, promoted.lanes, plan, 'restore')).toEqual(before);
        expect({ tracks, lanes }).toEqual(before);
    });

    it('keeps unrelated peer clip, selection and gap-source work while restoring only owned facets', () => {
        const { tracks, lanes, plan } = fixture();
        const promoted = projectTempoAudioSources(tracks, lanes, plan, 'promote');
        if (!promoted) {
            throw new Error('Expected source promotion');
        }
        const outside = ClipDummy.create({
            id: 'outside',
            trackId: 'audio',
            startBeat: 20,
            endBeat: 24,
            type: 'audio',
            audioOffsetSeconds: 3,
        });
        promoted.tracks[0]!.gain = 0.25;
        promoted.tracks[0]!.clips[0]!.name = 'Peer label';
        promoted.tracks[0]!.clips.push(outside);
        const lane = promoted.lanes[0]!;
        lane.takes.push({ id: 'peer', clipId: 'outside', name: 'Peer', startBeat: 20, endBeat: 24, selected: false });
        lane.activeCompRegions.push({ takeId: 'peer', startBeat: 20, endBeat: 21 });
        const source = lane.baseGapAudioSources![0]!.audioSource;
        const tile = { clipId: 'outside', startBeat: 21, endBeat: 24, audioSource: source };
        lane.baseGapAudioSources!.push(tile);

        const restored = projectTempoAudioSources(promoted.tracks, promoted.lanes, plan, 'restore');
        expect(restored?.tracks[0]?.gain).toBe(0.25);
        expect(restored?.tracks[0]?.clips[0]?.name).toBe('Peer label');
        expect(restored?.tracks[0]?.clips[1]).toEqual(outside);
        expect(restored?.lanes[0]?.takes[1]?.id).toBe('peer');
        expect(restored?.lanes[0]?.activeCompRegions[1]).toEqual({ takeId: 'peer', startBeat: 20, endBeat: 21 });
        expect(restored?.lanes[0]?.baseGapAudioSources).toEqual([tile]);
    });

    it.each([
        'audioOffsetSeconds',
        'audioUnwrappedOffsetSeconds',
        'audioLoopStartSeconds',
        'audioLoopPassEntrySeconds',
        'audioLoopPassOriginBeat',
    ] as const)('refuses a changed owned %s without modifying any passed value', (field) => {
        const { tracks, lanes, plan } = fixture();
        const promoted = projectTempoAudioSources(tracks, lanes, plan, 'promote');
        if (!promoted) {
            throw new Error('Expected source promotion');
        }
        promoted.tracks[0]!.clips[0]![field] = 19;
        const before = structuredClone(promoted);
        expect(projectTempoAudioSources(promoted.tracks, promoted.lanes, plan, 'restore')).toBeNull();
        expect(promoted).toEqual(before);
    });

    it('refuses changed media identity even when all canonical source values match', () => {
        const { tracks, lanes, plan } = fixture();
        const promoted = projectTempoAudioSources(tracks, lanes, plan, 'promote');
        if (!promoted) {
            throw new Error('Expected source promotion');
        }
        promoted.tracks[0]!.alternatives[1]!.clips[0]!.audioBufferId = 'peer-asset';
        expect(projectTempoAudioSources(promoted.tracks, promoted.lanes, plan, 'restore')).toBeNull();
    });

    it('refuses another active alternative carrying an identical clip ID and source tuple', () => {
        const { tracks, lanes, plan } = fixture();
        const promoted = projectTempoAudioSources(tracks, lanes, plan, 'promote');
        if (!promoted) {
            throw new Error('Expected source promotion');
        }
        promoted.tracks[0]!.activeAlternativeId = 'other';
        expect(projectTempoAudioSources(promoted.tracks, promoted.lanes, plan, 'restore')).toBeNull();
    });

    it('refuses stripped selected-region provenance rather than accepting arbitrary legacy absence', () => {
        const { tracks, lanes, plan } = fixture();
        const promoted = projectTempoAudioSources(tracks, lanes, plan, 'promote');
        if (!promoted) {
            throw new Error('Expected source promotion');
        }
        delete promoted.lanes[0]!.activeCompRegions[0]!.audioSource;
        expect(projectTempoAudioSources(promoted.tracks, promoted.lanes, plan, 'restore')).toBeNull();
    });
});
