import { describe, expect, it } from 'vitest';

import {
    type ProjectContext,
    type ProjectContextClip,
    type ProjectContextDevice,
    type ProjectContextTrack,
} from '../../models/ProjectContext';
import { maskTrackReferences } from '../maskTrackReferences';

function track(id: string, name: string, parts: Partial<ProjectContextTrack> = {}): ProjectContextTrack {
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 1,
        pan: 0,
        automationMode: 'read',
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
        ...parts,
    };
}

function clip(id: string, name: string): ProjectContextClip {
    return { id, name, type: 'audio', startBeat: 0, endBeat: 4, noteCount: 0 };
}

function device(id: string, type: string, name?: string): ProjectContextDevice {
    if (name === undefined) {
        return { id, type, bypassed: false };
    }
    return { id, name, type, bypassed: false };
}

function context(parts: Partial<ProjectContext> = {}): ProjectContext {
    return {
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
        tracks: [track('lead', 'Lead')],
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'arrange',
        playheadPosition: 0,
        ...parts,
    };
}

const section = (id: string, name: string) => ({ id, name, startBeat: 0, endBeat: 16 });
const vcaGroup = (id: string, name: string) => ({ id, name, gain: 1, muted: false, trackIds: ['vocal'] });
const adjustmentLayer = (id: string, name: string) => ({
    id,
    name,
    effectType: 'eq' as const,
    parameters: [],
    affectedTrackIds: ['vocal'],
    insertionIndex: 0,
    regions: [],
    enabled: true,
    mix: 1,
    color: '#fff',
});

describe('maskTrackReferences', () => {
    it.each([
        [
            'a section name',
            context({ sections: [section('section-1', 'Dark Bridge')] }),
            'make the vocal as loud as the Dark Bridge',
            'make the vocal as loud as the ###########',
        ],
        [
            'a marker name',
            context({ markers: [{ id: 'marker-1', name: 'Warm Intro', beat: 0 }] }),
            'make the vocal fuller after Warm Intro',
            'make the vocal fuller after ##########',
        ],
        [
            'a VCA group name',
            context({ vcaGroups: [vcaGroup('vca-1', 'Loud Group')] }),
            'balance the vocal against Loud Group',
            'balance the vocal against ##########',
        ],
        [
            'an adjustment layer name',
            context({ adjustmentLayers: [adjustmentLayer('layer-1', 'Bright Layer')] }),
            'make the vocal sit under Bright Layer',
            'make the vocal sit under ############',
        ],
        [
            'a clip name',
            context({
                tracks: [track('vocal', 'Vocal'), track('t2', 'Piano', { clips: [clip('c1', 'Bright Keys')] })],
            }),
            'make the vocal sit under the Bright Keys clip',
            'make the ##### sit under the ########### clip',
        ],
        [
            'a device name',
            context({ tracks: [track('vocal', 'Vocal', { devices: [device('d1', 'reverb', 'Wide Verb')] })] }),
            'make Wide Verb smaller',
            'make ######### smaller',
        ],
        [
            'a track name, as before',
            context({ tracks: [track('pad', 'Warm Pad')] }),
            'make the Warm Pad brighter',
            'make the ######## brighter',
        ],
        [
            'quoted text, as before',
            context(),
            'name it "Dark Room" and make it brighter',
            'name it "#########" and make it brighter'.replace('#########', '         '),
        ],
        [
            'a request word that only shares a word with a section name',
            context({ sections: [section('section-1', 'Dark Bridge')] }),
            'make it darker',
            'make it darker',
        ],
        [
            'only the exact section name',
            context({ sections: [section('section-1', 'Bridge')] }),
            'brighten the bridge section',
            'brighten the ###### section',
        ],
        [
            'a clip name holding a sibling track name',
            context({ tracks: [track('keys', 'Keys', { clips: [clip('c1', 'Bright Keys')] })] }),
            'make Keys warmer under Bright Keys',
            'make #### warmer under ###########',
        ],
        [
            'a device type, which the app supplies',
            context({ tracks: [track('vocal', 'Vocal', { devices: [device('d1', 'compressor')] })] }),
            'add a compressor',
            'add a compressor',
        ],
        [
            'a device name the app gave it from its type',
            context({ tracks: [track('vocal', 'Vocal', { devices: [device('d1', 'compressor', 'Compressor')] })] }),
            'add a compressor',
            'add a compressor',
        ],
        [
            'a VCA group named like the kind word',
            context({ vcaGroups: [vcaGroup('vca-1', 'Group')] }),
            'group the drums',
            'group the drums',
        ],
        [
            'a clip named like the kind word',
            context({ tracks: [track('vocal', 'Vocal', { clips: [clip('c1', 'Clip')] })] }),
            'make the clip brighter',
            'make the clip brighter',
        ],
        [
            'every object id',
            context({
                sections: [section('section-9', 'Verse')],
                markers: [{ id: 'marker-9', name: 'Drop', beat: 8 }],
                vcaGroups: [vcaGroup('vca-9', 'Strings')],
                adjustmentLayers: [adjustmentLayer('layer-9', 'Sweep')],
                tracks: [
                    track('vocal', 'Vocal', {
                        clips: [clip('clip-9', 'Take')],
                        devices: [device('device-9', 'reverb')],
                        alternativeClipIds: ['alt-9'],
                    }),
                ],
            }),
            'section-9 marker-9 vca-9 layer-9 clip-9 device-9 alt-9 vocal',
            '######### ######## ##### ####### ###### ######## ##### #####',
        ],
    ] satisfies [string, ProjectContext, string, string][])('masks %s', (_kind, projectContext, prompt, expected) => {
        expect(maskTrackReferences(prompt, projectContext, '#')).toBe(expected);
    });
});
