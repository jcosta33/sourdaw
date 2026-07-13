import { afterEach, describe, expect, it } from 'vitest';

import { CURRENT_PROJECT_VERSION, type ProjectData, type ProjectTrack } from '../../../../models/ProjectData';
import { arrangementStore, defaultArrangementStoreState } from '../../../../stores/arrangementStore';
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
    });

    it('preserves saved arrangement identities and hydrates canonical and legacy clip fields', () => {
        const data = projectData();
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
});
