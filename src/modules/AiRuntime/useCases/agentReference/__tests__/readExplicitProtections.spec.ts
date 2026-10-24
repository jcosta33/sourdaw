import { describe, expect, it } from 'vitest';

import { type ProjectContext, type ProjectContextTrack } from '../../../models/ProjectContext';
import { readExplicitProtections } from '../readExplicitProtections';

function createTrack(id: string, name: string, overrides: Partial<ProjectContextTrack> = {}): ProjectContextTrack {
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
        ...overrides,
    };
}

const keys = createTrack('track-keys', 'Keys');
const rockAndRoll = createTrack('track-rock', 'Rock and Roll');
const drumBus = createTrack('track-drum-bus', 'Drum Bus');
const guitar = createTrack('track-guitar', 'Guitar', {
    clips: [
        {
            id: 'clip-lead',
            name: 'Lead',
            type: 'audio',
            startBeat: 0,
            endBeat: 8,
            noteCount: 0,
            locked: false,
        },
    ],
    devices: [{ id: 'device-comp', type: 'compressor', name: 'Glue', bypassed: false, parameters: [] }],
});

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [keys, rockAndRoll, drumBus, guitar],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'mix',
    playheadPosition: 0,
    vcaGroups: [{ id: 'vca-strings', name: 'Strings', gain: 1, muted: false, trackIds: [keys.id] }],
};

describe('readExplicitProtections', () => {
    it.each([
        ['leave Keys alone', []],
        ['leave Keys and the Drum Bus alone', []],
        ['leave Keys, Rock and Roll as well as the Guitar track alone', []],
        ['leave "Rock and Roll" unchanged', []],
        ['keep Lead and Glue as is', []],
        ['leave the Keys pan and fader unchanged', []],
        ['do not change pan, solo, and fader of Keys', []],
        ["don't touch Keys or Guitar", []],
        ['leave pan alone', []],
        ['keep everything else unchanged', []],
        ['leaving the rest of the mix alone', []],
        ['do not change the tempo', []],
        ['keep the time signature as is', []],
        ['turn Keys down and keep going', []],
        ['rename Keys to "leave Ghost alone"', []],
    ])('finds nothing unresolved in "%s"', (prompt, expected) => {
        expect(readExplicitProtections(prompt, context).unresolved).toEqual(expected);
    });

    it.each([
        ['do not change pan, solo, and fader of Strings', ['Strings']],
        ['leave Strings alone', ['Strings']],
        ['leave Keys as well as the first track alone', ['first track']],
        ['leave Keys along with the second track alone', ['second track']],
        ['leave Keys plus it alone', ['it']],
        ['leave Keys as well as the last one alone', ['last one']],
        ['leave the Keys alone except the second one', ['second one']],
        ['leave Ghost and Keys alone', ['Ghost']],
        ['keep "Ghost" as is', ['Ghost']],
        ['leave the other alone', ['other']],
        ['leave the track alone', ['track']],
        ['do not touch the preset', ['preset']],
        ['leave Ghost alone; do not change the fader of the second one', ['Ghost', 'second one']],
    ])('reports the unresolved reference in "%s"', (prompt, expected) => {
        expect(readExplicitProtections(prompt, context).unresolved).toEqual(expected);
    });

    it('resolves a selection phrase only through a selected track', () => {
        const selected = { ...context, selectedTrackId: keys.id };

        expect(readExplicitProtections('leave this track alone', context)).toEqual({
            unresolved: ['this track'],
            protectsSelectedTrack: false,
        });
        expect(readExplicitProtections('leave this track alone', selected)).toEqual({
            unresolved: [],
            protectsSelectedTrack: true,
        });
        expect(readExplicitProtections('leave it and the selected track alone', selected)).toEqual({
            unresolved: [],
            protectsSelectedTrack: true,
        });
    });
});
