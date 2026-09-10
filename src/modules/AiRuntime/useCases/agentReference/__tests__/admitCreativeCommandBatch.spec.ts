import { describe, expect, it } from 'vitest';

import { type CreativeRequestAuthority } from '../../../models/CreativeInterpretation';
import { type ProjectContext, type ProjectContextTrack } from '../../../models/ProjectContext';
import { type ToolCallResult } from '../../../transformers/toolCallParser';
import { admitCreativeCommandBatch, type CreativeCallAdmission } from '../admitCreativeCommandBatch';

const guitarTrack: ProjectContextTrack = {
    id: 'guitar',
    name: 'Guitar',
    kind: 'midi',
    muted: false,
    soloed: false,
    soloSafe: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    automationMode: 'read',
    clipCount: 1,
    deviceCount: 1,
    clips: [{ id: 'guitar-clip-1', name: 'Guitar Take', type: 'midi', startBeat: 0, endBeat: 16, noteCount: 8 }],
    devices: [
        {
            id: 'guitar-eq-1',
            type: 'eq',
            bypassed: false,
            parameters: [
                { id: 'gain', name: 'Gain', type: 'float', value: 0, minValue: -12, maxValue: 12, unit: 'dB' },
            ],
        },
    ],
};

const bassTrack: ProjectContextTrack = {
    id: 'bass',
    name: 'Bass',
    kind: 'audio',
    muted: false,
    soloed: false,
    soloSafe: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    automationMode: 'read',
    clipCount: 1,
    deviceCount: 1,
    clips: [{ id: 'bass-clip-1', name: 'Bass Take', type: 'audio', startBeat: 0, endBeat: 16, noteCount: 0 }],
    devices: [
        {
            id: 'bass-comp-1',
            type: 'compressor',
            bypassed: false,
            parameters: [
                { id: 'ratio', name: 'Ratio', type: 'float', value: 2, minValue: 1, maxValue: 20, unit: ':1' },
            ],
        },
    ],
};

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    availableDeviceTypes: [
        { id: 'eq', name: 'Equalizer' },
        { id: 'compressor', name: 'Compressor' },
    ],
    tracks: [guitarTrack, bassTrack],
    selectedTrackId: 'guitar',
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

const guitarTrackTarget = {
    provenance: 'contextual-selection' as const,
    objectType: 'track' as const,
    objectIds: ['guitar'],
    parentTrackId: null,
};

const guitarClipTarget = {
    provenance: 'contextual-selection' as const,
    objectType: 'clip' as const,
    objectIds: ['guitar-clip-1'],
    parentTrackId: 'guitar',
};

function buildAuthority(overrides: Partial<CreativeRequestAuthority>): CreativeRequestAuthority {
    return {
        schemaVersion: 1,
        authorityId: 'creative-authority-1',
        catalogId: 'creative-catalog-1',
        requestDigest: 'request-digest-1',
        revision: 'revision-1',
        selection: { trackId: 'guitar', clipId: null, clipIds: [], activeView: 'arrange' },
        mode: 'edit',
        targets: [guitarTrackTarget],
        editDimensions: ['processing'],
        prohibitions: [],
        creationSlots: [{ objectType: 'device', parentObjectId: 'guitar', budget: 4 }],
        uncertainty: 'none',
        ...overrides,
    };
}

function admitBatch(
    authority: CreativeRequestAuthority,
    calls: readonly ToolCallResult[]
): readonly CreativeCallAdmission[] {
    const admissions = admitCreativeCommandBatch({ authority, calls, context });
    expect(admissions.size).toBe(calls.length);
    return calls.map((_call, index) => {
        const admission = admissions.get(index);
        expect(admission).toBeDefined();
        return admission as CreativeCallAdmission;
    });
}

function admitOne(authority: CreativeRequestAuthority, call: ToolCallResult): CreativeCallAdmission {
    return admitBatch(authority, [call])[0] as CreativeCallAdmission;
}

function expectRejection(admission: CreativeCallAdmission, reasonFragment: string): void {
    expect(admission.status).toBe('rejected');
    expect(admission.status === 'rejected' ? admission.reason : '').toContain(reasonFragment);
}

describe('admitCreativeCommandBatch', () => {
    it('admits a processing edit on the track the authority names and records its target', () => {
        const admission = admitOne(buildAuthority({}), {
            name: 'addDevice',
            arguments: { trackId: 'guitar', deviceType: 'eq' },
        });

        expect(admission).toEqual({
            status: 'admitted',
            targets: [{ argument: 'trackId', capability: 'device-host-track', objectId: 'guitar' }],
        });
    });

    it('refuses the same edit on a track the authority does not name', () => {
        expectRejection(
            admitOne(buildAuthority({ creationSlots: [{ objectType: 'device', parentObjectId: 'bass', budget: 4 }] }), {
                name: 'addDevice',
                arguments: { trackId: 'bass', deviceType: 'compressor' },
            }),
            'does not cover the track bass'
        );
    });

    it('admits a device parameter edit on a device the named track owns', () => {
        const admission = admitOne(buildAuthority({}), {
            name: 'setDeviceParameter',
            arguments: { deviceId: 'guitar-eq-1', paramId: 'gain', value: 3 },
        });

        expect(admission).toEqual({
            status: 'admitted',
            targets: [
                { argument: 'deviceId', capability: 'device', objectId: 'guitar-eq-1' },
                { argument: 'paramId', capability: 'device-parameter', objectId: 'gain' },
            ],
        });
    });

    it('refuses a device parameter edit on a device another track owns', () => {
        expectRejection(
            admitOne(buildAuthority({}), {
                name: 'setDeviceParameter',
                arguments: { deviceId: 'bass-comp-1', paramId: 'ratio', value: 4 },
            }),
            'does not cover the device bass-comp-1'
        );
    });

    it('refuses track processing when the authority names only a clip on that track', () => {
        expectRejection(
            admitOne(buildAuthority({ targets: [guitarClipTarget] }), {
                name: 'addDevice',
                arguments: { trackId: 'guitar', deviceType: 'eq' },
            }),
            'does not cover the track guitar'
        );
    });

    it('admits a MIDI edit on a clip of the named track', () => {
        const admission = admitOne(buildAuthority({ editDimensions: ['midi-content'], creationSlots: [] }), {
            name: 'transposeNotes',
            arguments: { clipId: 'guitar-clip-1', semitones: 2 },
        });

        expect(admission).toEqual({
            status: 'admitted',
            targets: [{ argument: 'clipId', capability: 'editable-midi-clip', objectId: 'guitar-clip-1' }],
        });
    });

    it('refuses a MIDI edit when the authority covers only processing', () => {
        expectRejection(
            admitOne(buildAuthority({ creationSlots: [] }), {
                name: 'transposeNotes',
                arguments: { clipId: 'guitar-clip-1', semitones: 2 },
            }),
            'does not cover the midi-content edit dimension'
        );
    });

    it('refuses a MIDI edit the authority excludes by prohibition', () => {
        expectRejection(
            admitOne(
                buildAuthority({
                    editDimensions: ['midi-content'],
                    prohibitions: [{ kind: 'exclude-dimension', dimension: 'midi-content' }],
                    creationSlots: [],
                }),
                { name: 'transposeNotes', arguments: { clipId: 'guitar-clip-1', semitones: 2 } }
            ),
            'excludes the midi-content edit dimension'
        );
    });

    it('refuses an edit on a protected object', () => {
        expectRejection(
            admitOne(
                buildAuthority({
                    editDimensions: ['midi-content'],
                    prohibitions: [{ kind: 'protect-object', objectId: 'guitar-clip-1' }],
                    creationSlots: [],
                }),
                { name: 'setAllVelocities', arguments: { clipId: 'guitar-clip-1', velocity: 100 } }
            ),
            'protects object guitar-clip-1'
        );
    });

    it('refuses every writing command under a read-only interpretation', () => {
        expectRejection(
            admitOne(buildAuthority({ mode: 'read-only', targets: [], editDimensions: [], creationSlots: [] }), {
                name: 'setTrackGain',
                arguments: { trackId: 'guitar', gain: 0.5 },
            }),
            'is read-only and admits no writing command'
        );
    });

    it('refuses a routing command outside the creative edit vocabulary', () => {
        expectRejection(
            admitOne(buildAuthority({}), {
                name: 'setTrackOutput',
                arguments: { trackId: 'guitar', outputId: 'master' },
            }),
            'does not extend to routing effects'
        );
    });

    it('refuses a command whose effect reaches past the named target', () => {
        expectRejection(
            admitOne(buildAuthority({ editDimensions: ['arrangement'], creationSlots: [] }), {
                name: 'drawClip',
                arguments: { trackId: 'guitar', type: 'midi', startBeat: 0, endBeat: 4, name: 'New' },
            }),
            'does not reach past the named target'
        );
    });

    it('refuses a command that removes an existing object', () => {
        expectRejection(
            admitOne(buildAuthority({ editDimensions: ['midi-content'], creationSlots: [] }), {
                name: 'arpeggiate',
                arguments: { clipId: 'guitar-clip-1' },
            }),
            'never removes existing objects'
        );
    });

    it('refuses a device removal outside the creative route', () => {
        expectRejection(
            admitOne(buildAuthority({}), { name: 'removeDevice', arguments: { deviceId: 'guitar-eq-1' } }),
            'Creative authority'
        );
    });

    it('spends one creation slot per admitted creation and refuses the call past its budget', () => {
        const admissions = admitBatch(
            buildAuthority({ creationSlots: [{ objectType: 'device', parentObjectId: 'guitar', budget: 1 }] }),
            [
                { name: 'addDevice', arguments: { trackId: 'guitar', deviceType: 'eq' } },
                { name: 'addDevice', arguments: { trackId: 'guitar', deviceType: 'compressor' } },
            ]
        );

        expect(admissions[0]?.status).toBe('admitted');
        expectRejection(admissions[1] as CreativeCallAdmission, 'has spent its device creation budget of 1');
    });

    it('refuses a creation the authority published no slot for', () => {
        expectRejection(
            admitOne(buildAuthority({ creationSlots: [] }), {
                name: 'addDevice',
                arguments: { trackId: 'guitar', deviceType: 'eq' },
            }),
            'publishes no device creation slot here'
        );
    });

    it('admits notes written into a clip whose own creation slot names it', () => {
        const admission = admitOne(
            buildAuthority({
                targets: [guitarClipTarget],
                editDimensions: ['midi-content'],
                creationSlots: [{ objectType: 'notes', parentObjectId: 'guitar-clip-1', budget: 256 }],
            }),
            {
                name: 'addNotes',
                arguments: { clipId: 'guitar-clip-1', notes: [{ pitch: 60, startBeat: 0, duration: 1 }] },
            }
        );

        expect(admission.status).toBe('admitted');
    });

    it('admits a parameter edit on a device an earlier admitted call in the batch creates', () => {
        const admissions = admitBatch(buildAuthority({}), [
            { name: 'addDevice', arguments: { trackId: 'guitar', deviceType: 'eq' } },
            { name: 'setDeviceParameter', arguments: { deviceId: 'device-ai-1', paramId: 'gain', value: 3 } },
        ]);

        expect(admissions[0]?.status).toBe('admitted');
        expect(admissions[1]?.status).toBe('admitted');
    });

    it('refuses a parameter edit that runs before the batch call creating that device', () => {
        const admissions = admitBatch(buildAuthority({}), [
            { name: 'setDeviceParameter', arguments: { deviceId: 'device-ai-1', paramId: 'gain', value: 3 } },
            { name: 'addDevice', arguments: { trackId: 'guitar', deviceType: 'eq' } },
        ]);

        expectRejection(admissions[0] as CreativeCallAdmission, 'does not cover the device device-ai-1');
        expect(admissions[1]?.status).toBe('admitted');
    });

    it('refuses a parameter edit on a device a protected track owns', () => {
        expectRejection(
            admitOne(buildAuthority({ prohibitions: [{ kind: 'protect-object', objectId: 'bass' }] }), {
                name: 'setDeviceParameter',
                arguments: { deviceId: 'bass-comp-1', paramId: 'ratio', value: 4 },
            }),
            'protects object bass'
        );
    });

    it('refuses the same parameter edit when no admitted call in the batch creates that device', () => {
        expectRejection(
            admitOne(buildAuthority({}), {
                name: 'setDeviceParameter',
                arguments: { deviceId: 'device-ai-1', paramId: 'gain', value: 3 },
            }),
            'does not cover the device device-ai-1'
        );
    });

    it('refuses a command the executable registry does not know', () => {
        expectRejection(
            admitOne(buildAuthority({}), { name: 'summonReverb', arguments: {} }),
            'cannot admit the unknown command summonReverb'
        );
    });
});
