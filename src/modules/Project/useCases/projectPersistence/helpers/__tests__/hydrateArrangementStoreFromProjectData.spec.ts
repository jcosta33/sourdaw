import { afterEach, describe, expect, it } from 'vitest';

import { markerStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { tempoMapStore, timeSignatureMapStore } from '#/modules/Transport/stores';

import { CURRENT_PROJECT_VERSION, type ProjectData, type ProjectTrack } from '../../../../models/ProjectData';
import { arrangementStore, defaultArrangementStoreState } from '../../../../stores/arrangementStore';
import { collectProjectAudioBufferIds } from '../collectProjectAudioBufferIds';
import { hydrateArrangementStoreFromProjectData } from '../hydrateArrangementStoreFromProjectData';

function projectTrack(id: string, bufferId: string, useRuntimeAlias = false): ProjectTrack {
    const clip = {
        id: `${id}-clip`,
        trackId: id,
        name: `${id} clip`,
        startBeat: 0,
        endBeat: 4,
        type: 'audio' as const,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
        bufferId: useRuntimeAlias ? undefined : bufferId,
        audioBufferId: useRuntimeAlias ? bufferId : undefined,
    };

    return {
        id,
        name: id,
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [clip],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: `${id}-alternative`,
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function projectData(): ProjectData {
    return {
        version: CURRENT_PROJECT_VERSION,
        meta: {
            name: 'Saved project',
            createdAt: 1,
            updatedAt: 2,
            keyRoot: 0,
            scaleName: 'major',
            tuning: { name: '12-TET', frequencies: [] },
        },
        transport: {
            tempo: 120,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
            loopStart: 0,
            loopEnd: 16,
            isLooping: false,
            metronomeEnabled: false,
            metronomeVolume: 0.5,
            punchInEnabled: false,
            punchInBeat: 0,
            punchOutBeat: 16,
            countInEnabled: false,
            countInBars: 1,
            preRollEnabled: false,
            preRollBars: 1,
            masterGain: 1,
        },
        arrangement: { tracks: [] },
        automation: { lanes: [] },
        midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
        mixer: { master: { gain: 1, pan: 0 }, buses: [] },
        markers: [],
        history: { checkpoints: [] },
    };
}

describe('hydrateArrangementStoreFromProjectData', () => {
    afterEach(() => {
        arrangementStore.set(structuredClone(defaultArrangementStoreState));
        trackStore.set({ tracks: [], selectedTrackId: null });
        automationStore.set({ lanes: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        tempoMapStore.set({ changes: [] });
        timeSignatureMapStore.set({ changes: [] });
        markerStore.set({ markers: [], sections: [] });
        takeLaneStore.set({ lanes: [] });
    });

    it('preserves saved arrangement identities and hydrates canonical and legacy clip fields', () => {
        const data = projectData();
        data.midi.probabilitySeed = 3_735_928_559;
        data.arrangements = [
            {
                id: 'arrangement-a',
                name: 'Verse',
                tracks: { tracks: [projectTrack('track-a', 'buffer-a')], selectedTrackId: null },
                automation: { lanes: [] },
                midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            },
            {
                id: 'arrangement-b',
                name: 'Chorus',
                tracks: { tracks: [projectTrack('track-b', 'buffer-b', true)], selectedTrackId: 'track-b' },
                automation: { lanes: [] },
                midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
                tempoMap: { changes: [{ id: 'tempo-b', beat: 0, tempo: 128, curve: 'linear' }] },
                timeSignatureMap: {
                    changes: [{ id: 'meter-b', beat: 0, numerator: 3, denominator: 4 }],
                },
                markers: {
                    markers: [{ id: 'marker-b', beat: 4, name: 'Chorus', color: '#fff' }],
                    sections: [],
                },
                takeLanes: { lanes: [] },
            },
        ];
        data.activeArrangementId = 'arrangement-b';

        hydrateArrangementStoreFromProjectData({ data, preserveSavedArrangements: true });

        const state = arrangementStore.value;
        expect(state?.arrangements.map(({ id, name }) => ({ id, name }))).toEqual([
            { id: 'arrangement-a', name: 'Verse' },
            { id: 'arrangement-b', name: 'Chorus' },
        ]);
        expect(state?.activeArrangementId).toBe('arrangement-b');
        expect(state?.arrangements[0]?.tracks.tracks[0]?.clips[0]?.audioBufferId).toBe('buffer-a');
        expect(state?.arrangements[1]?.tracks.tracks[0]?.clips[0]?.audioBufferId).toBe('buffer-b');
        expect(trackStore.value?.tracks.map((track) => track.id)).toEqual(['track-b']);
        expect(tempoMapStore.value?.changes).toEqual([{ id: 'tempo-b', beat: 0, tempo: 128, curve: 'linear' }]);
        expect(timeSignatureMapStore.value?.changes).toEqual([
            { id: 'meter-b', beat: 0, numerator: 3, denominator: 4 },
        ]);
        expect(markerStore.value?.markers.map((marker) => marker.id)).toEqual(['marker-b']);
        expect(midiStore.value?.probabilitySeed).toBe(3_735_928_559);
    });

    it('uses empty MIDI and automation state for accepted sparse snapshots', () => {
        const completeData = projectData();
        const sparseData = { ...completeData, midi: undefined, automation: undefined };

        hydrateArrangementStoreFromProjectData({ data: sparseData });

        expect(arrangementStore.value?.arrangements[0]?.midi).toEqual({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        expect(arrangementStore.value?.arrangements[0]?.automation).toEqual({ lanes: [] });
    });

    it('uses the first saved arrangement consistently when the active id is invalid', () => {
        const data = projectData();
        data.arrangement.tracks = [projectTrack('top-level', 'top-level-buffer')];
        data.arrangements = [
            {
                id: 'first',
                name: 'First',
                tracks: { tracks: [projectTrack('first-track', 'first-buffer')], selectedTrackId: 'first-track' },
            },
            {
                id: 'second',
                name: 'Second',
                tracks: { tracks: [projectTrack('second-track', 'second-buffer')], selectedTrackId: null },
            },
        ];
        data.activeArrangementId = 'missing';

        hydrateArrangementStoreFromProjectData({ data, preserveSavedArrangements: true });

        expect(arrangementStore.value?.activeArrangementId).toBe('first');
        expect(trackStore.value?.tracks.map((track) => track.id)).toEqual(['first-track']);
        expect(collectProjectAudioBufferIds({ data })).toEqual(['first-buffer']);
    });
});
