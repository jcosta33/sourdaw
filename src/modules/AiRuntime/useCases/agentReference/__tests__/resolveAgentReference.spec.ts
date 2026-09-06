import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { resolveAgentReference } from '../resolveAgentReference';
import { resolveCompleteClipReference } from '../resolveCompleteClipReference';

function createProjectState(): ProjectContext {
    const tracks = [
        { id: 'track-vocals', name: 'Vocals' },
        { id: 'track-bass', name: 'Bass' },
    ].map(({ id, name }) => ({
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read' as const,
        outputId: 'master',
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
        sends: [],
    }));

    return {
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
        tracks,
        selectedTrackId: 'track-vocals',
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'mix',
        playheadPosition: 0,
    };
}

function resolveTrack(prompt: string, assertedId: string, project = createProjectState()) {
    return resolveAgentReference({ prompt, assertedId, capability: 'track', context: project });
}

function resolveRemovableTrack(prompt: string, assertedId: string, project = createProjectState()) {
    return resolveAgentReference({ prompt, assertedId, capability: 'removable-track', context: project });
}

function createClipProjectState(): ProjectContext {
    const project = createProjectState();
    const vocals = project.tracks[0];
    const bass = project.tracks[1];
    if (!vocals || !bass) {
        throw new Error('Expected track fixtures');
    }
    const intro = {
        id: 'clip-intro',
        name: 'Intro',
        type: 'audio' as const,
        startBeat: 0,
        endBeat: 8,
        gain: 1,
        locked: false,
        noteCount: 0,
    };
    const vocalsVerse = { ...intro, id: 'clip-vocals-verse', name: 'Verse', startBeat: 8, endBeat: 16 };
    const bassVerse = { ...intro, id: 'clip-bass-verse', name: 'Verse', startBeat: 16, endBeat: 24 };
    const locked = { ...intro, id: 'clip-locked', name: 'Locked', locked: true };
    const midi = { ...intro, id: 'clip-midi', name: 'Piano MIDI', type: 'midi' as const, noteCount: 4 };
    const emptyMidi = { ...midi, id: 'clip-empty-midi', name: 'Empty MIDI', noteCount: 0 };
    const lockedMidi = { ...midi, id: 'clip-locked-midi', name: 'Locked MIDI', locked: true };
    return {
        ...project,
        tracks: [
            { ...vocals, clipCount: 6, clips: [intro, vocalsVerse, locked, midi, emptyMidi, lockedMidi] },
            { ...bass, clipCount: 1, clips: [bassVerse] },
        ],
        selectedClipId: intro.id,
        selectedClipIds: [intro.id],
    };
}

function resolveClip(prompt: string, assertedId: string, project = createClipProjectState()) {
    return resolveAgentReference({ prompt, assertedId, capability: 'editable-clip', context: project });
}

function resolveCompleteClip(referenceText: string, assertedId: string, project = createClipProjectState()) {
    return resolveCompleteClipReference({
        prompt: `rename clip ${referenceText}`,
        referenceText,
        assertedId,
        capability: 'editable-clip',
        context: project,
    });
}

function resolveMidiClip(prompt: string, assertedId: string, project = createClipProjectState()) {
    return resolveAgentReference({ prompt, assertedId, capability: 'editable-midi-clip', context: project });
}

function resolveWritableMidiClip(prompt: string, assertedId: string, project = createClipProjectState()) {
    return resolveAgentReference({ prompt, assertedId, capability: 'writable-midi-clip', context: project });
}

function resolveAudioClip(prompt: string, assertedId: string, project = createClipProjectState()) {
    return resolveAgentReference({ prompt, assertedId, capability: 'editable-audio-clip', context: project });
}

function createAutomationProjectState(): ProjectContext {
    return {
        ...createProjectState(),
        automationLanes: [
            {
                id: 'lane-vocals-gain',
                trackId: 'track-vocals',
                parameterId: 'gain',
                name: 'Gain',
                enabled: true,
                minValue: 0,
                maxValue: 1,
                points: [],
            },
            {
                id: 'lane-vocals-pan',
                trackId: 'track-vocals',
                parameterId: 'pan',
                name: 'Pan',
                enabled: true,
                minValue: -1,
                maxValue: 1,
                points: [],
            },
            {
                id: 'lane-bass-gain',
                trackId: 'track-bass',
                parameterId: 'gain',
                name: 'Gain',
                enabled: false,
                minValue: 0,
                maxValue: 1,
                points: [],
            },
        ],
    };
}

function resolveAutomationLane(prompt: string, assertedId: string, project = createAutomationProjectState()) {
    return resolveAgentReference({ prompt, assertedId, capability: 'automation-lane', context: project });
}

describe('resolveAgentReference', () => {
    it('requires a rename source reference to consume its complete text', () => {
        const project = createClipProjectState();
        const vocals = project.tracks[0]!;
        const roadToNowhere = {
            ...vocals.clips[0]!,
            id: 'clip-road-to-nowhere',
            name: 'Road to Nowhere',
            startBeat: 48,
            endBeat: 56,
        };
        const context = {
            ...project,
            tracks: [
                { ...vocals, clipCount: vocals.clipCount + 1, clips: [...vocals.clips, roadToNowhere] },
                ...project.tracks.slice(1),
            ],
        };

        expect(resolveCompleteClip('Intro', 'clip-intro', context)).toEqual({
            status: 'resolved',
            id: 'clip-intro',
            evidence: 'exact-name',
        });
        expect(resolveCompleteClip('clip-intro', 'clip-intro', context)).toEqual({
            status: 'resolved',
            id: 'clip-intro',
            evidence: 'literal-id',
        });
        expect(resolveCompleteClip('Intro to Road', 'clip-intro', context)).toEqual({
            status: 'rejected',
            reason: 'ungrounded-target',
        });
        expect(resolveCompleteClip('Road to Nowhere', roadToNowhere.id, context)).toEqual({
            status: 'resolved',
            id: roadToNowhere.id,
            evidence: 'exact-name',
        });
        expect(resolveCompleteClip('"Road to Nowhere"', roadToNowhere.id, context)).toEqual({
            status: 'resolved',
            id: roadToNowhere.id,
            evidence: 'exact-name',
        });
        expect(resolveCompleteClip('selected clip', 'clip-intro', context)).toEqual({
            status: 'resolved',
            id: 'clip-intro',
            evidence: 'selection',
        });
    });

    it('consumes an exact owner qualification while retaining duplicate-name ambiguity', () => {
        expect(resolveCompleteClip('Verse on Vocals', 'clip-vocals-verse')).toEqual({
            status: 'resolved',
            id: 'clip-vocals-verse',
            evidence: 'exact-name',
        });
        expect(resolveCompleteClip('Verse on Bass', 'clip-bass-verse')).toEqual({
            status: 'resolved',
            id: 'clip-bass-verse',
            evidence: 'exact-name',
        });
        expect(resolveCompleteClip('Verse on track-vocals', 'clip-vocals-verse')).toEqual({
            status: 'resolved',
            id: 'clip-vocals-verse',
            evidence: 'exact-name',
        });
        expect(resolveCompleteClip('Verse', 'clip-vocals-verse')).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
    });

    it('grounds devices from canonical descriptors instead of mutable display names', () => {
        const project = createProjectState();
        const bass = project.tracks.find((track) => track.id === 'track-bass');
        if (!bass) {
            throw new Error('Expected Bass track fixture');
        }
        bass.devices = [
            { id: 'device-eq', name: 'Low Cut', type: 'builtin-eq', bypassed: false },
            { id: 'device-saturator', name: 'EQ', type: 'builtin-saturator', bypassed: false },
        ];
        project.availableDeviceTypes = [
            { id: 'builtin-eq', name: 'EQ' },
            { id: 'builtin-saturator', name: 'Saturator' },
        ];

        expect(
            resolveAgentReference({
                prompt: 'insert Compressor after EQ',
                assertedId: 'device-eq',
                capability: 'device',
                context: project,
                dependencyId: bass.id,
            })
        ).toEqual({ status: 'resolved', id: 'device-eq', evidence: 'exact-name' });
        expect(
            resolveAgentReference({
                prompt: 'insert Compressor after EQ',
                assertedId: 'device-saturator',
                capability: 'device',
                context: project,
                dependencyId: bass.id,
            })
        ).toEqual({ status: 'rejected', reason: 'asserted-target-mismatch' });
    });

    it('limits sidechain device grounding to supported devices on the owning track', () => {
        const project = createProjectState();
        const bass = project.tracks.find((track) => track.id === 'track-bass');
        if (!bass) {
            throw new Error('Expected Bass track fixture');
        }
        bass.devices = [
            {
                id: 'device-sidechain',
                name: 'Mutable Sidechain Name',
                type: 'builtin-sidechain-compressor',
                bypassed: false,
            },
            { id: 'device-eq', name: 'Sidechain Compressor', type: 'builtin-eq', bypassed: false },
        ];
        const vocals = project.tracks.find((track) => track.id === 'track-vocals');
        if (!vocals) {
            throw new Error('Expected Vocals track fixture');
        }
        vocals.devices = [
            {
                id: 'device-vocals-sidechain',
                name: 'Sidechain Compressor',
                type: 'builtin-sidechain-compressor',
                bypassed: false,
            },
        ];
        project.availableDeviceTypes = [
            { id: 'builtin-sidechain-compressor', name: 'Sidechain Compressor' },
            { id: 'builtin-eq', name: 'Sidechain Compressor' },
        ];

        expect(
            resolveAgentReference({
                prompt: 'route into Sidechain Compressor on Bass',
                assertedId: 'device-sidechain',
                capability: 'sidechain-capable-device',
                context: project,
                dependencyId: bass.id,
            })
        ).toEqual({ status: 'resolved', id: 'device-sidechain', evidence: 'exact-name' });
        expect(
            resolveAgentReference({
                prompt: 'route into Sidechain Compressor on Bass',
                assertedId: 'device-eq',
                capability: 'sidechain-capable-device',
                context: project,
                dependencyId: bass.id,
            })
        ).toEqual({ status: 'rejected', reason: 'asserted-target-mismatch' });
        expect(
            resolveAgentReference({
                prompt: 'route into Sidechain Compressor on Bass',
                assertedId: 'device-vocals-sidechain',
                capability: 'sidechain-capable-device',
                context: project,
                dependencyId: bass.id,
            })
        ).toEqual({ status: 'rejected', reason: 'asserted-target-mismatch' });
    });

    it('resolves unique exact names and explicit selection language', () => {
        expect(resolveTrack('mute Vocals', 'track-vocals')).toEqual({
            status: 'resolved',
            id: 'track-vocals',
            evidence: 'exact-name',
        });
        expect(resolveTrack('mute the selected track', 'track-vocals')).toEqual({
            status: 'resolved',
            id: 'track-vocals',
            evidence: 'selection',
        });
    });

    it('treats quoted reserved track references as literal names', () => {
        const project = createProjectState();
        const bass = project.tracks[1];
        if (!bass) {
            throw new Error('Expected Bass track fixture');
        }
        project.tracks = [...project.tracks, { ...bass, id: 'track-literal-selected', name: 'Selected Track' }];

        expect(resolveTrack('mute selected track', 'track-vocals', project)).toEqual({
            status: 'resolved',
            id: 'track-vocals',
            evidence: 'selection',
        });
        expect(resolveTrack('mute "Selected Track"', 'track-literal-selected', project)).toEqual({
            status: 'resolved',
            id: 'track-literal-selected',
            evidence: 'exact-name',
        });
        expect(resolveTrack('mute “Selected Track”', 'track-literal-selected', project)).toEqual({
            status: 'resolved',
            id: 'track-literal-selected',
            evidence: 'exact-name',
        });
    });

    it('grounds an accent-insensitive exact display name', () => {
        const project = createProjectState();
        project.tracks = [{ ...project.tracks[0]!, id: 'track-cafe', name: 'Café' }];

        expect(resolveTrack('mute Cafe', 'track-cafe', project)).toEqual({
            status: 'resolved',
            id: 'track-cafe',
            evidence: 'exact-name',
        });
    });

    it('applies capability kind filtering before target evidence is accepted', () => {
        const project = createProjectState();
        project.tracks = [
            ...project.tracks,
            { ...project.tracks[0]!, id: 'track-vca', name: 'VCA', kind: 'vca' },
            { ...project.tracks[0]!, id: 'track-bus', name: 'Bus', kind: 'bus' },
        ];

        expect(
            resolveAgentReference({
                prompt: 'arm VCA',
                assertedId: 'track-vca',
                capability: 'armable-track',
                context: project,
            })
        ).toMatchObject({ status: 'rejected', reason: 'ungrounded-target' });
        expect(
            resolveAgentReference({
                prompt: 'route to Bus',
                assertedId: 'track-bus',
                capability: 'output',
                context: project,
            })
        ).toEqual({ status: 'resolved', id: 'track-bus', evidence: 'exact-name' });
    });

    it('excludes Master before removable-track evidence can make another track ambiguous', () => {
        const project = createProjectState();
        const fixtureTrack = project.tracks[0];
        if (!fixtureTrack) {
            throw new Error('Expected track fixture');
        }
        const master = {
            ...fixtureTrack,
            id: 'master',
            name: 'Master',
            kind: 'master' as const,
            outputId: 'hw_out',
        };
        const busNamedMaster = {
            ...fixtureTrack,
            id: 'bus-master-name',
            name: 'Master',
            kind: 'bus' as const,
        };
        project.tracks = [...project.tracks, master, busNamedMaster];

        expect(
            resolveAgentReference({
                prompt: 'delete Master',
                assertedId: busNamedMaster.id,
                capability: 'removable-track',
                context: project,
            })
        ).toEqual({ status: 'resolved', id: busNamedMaster.id, evidence: 'exact-name' });
    });

    it('rejects ambiguous names, mismatched assertions, and incidental substrings', () => {
        const projectState = createProjectState();
        const firstTrack = projectState.tracks[0];
        if (!firstTrack) {
            throw new Error('Expected a track fixture');
        }
        const ambiguousContext = {
            ...projectState,
            tracks: [...projectState.tracks, { ...firstTrack, id: 'track-vocals-double' }],
        };
        const overlappingContext = {
            ...projectState,
            tracks: [
                { ...firstTrack, id: 'track-lead', name: 'Lead' },
                { ...firstTrack, id: 'track-lead-vox', name: 'Lead Vox' },
            ],
        };

        expect(resolveTrack('mute Vocals', 'track-vocals', ambiguousContext)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(resolveTrack('mute Vocals', 'track-bass', projectState)).toEqual({
            status: 'rejected',
            reason: 'asserted-target-mismatch',
        });
        expect(resolveTrack('mute Vocals Bass', 'track-vocals', projectState)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(resolveTrack('mute Lead Vox', 'track-lead', overlappingContext)).toEqual({
            status: 'rejected',
            reason: 'asserted-target-mismatch',
        });
        expect(resolveTrack('mute Lead Vox', 'track-lead-vox', overlappingContext)).toEqual({
            status: 'resolved',
            id: 'track-lead-vox',
            evidence: 'exact-name',
        });
        expect(resolveTrack('adjust the embassy', 'track-bass', projectState)).toEqual({
            status: 'rejected',
            reason: 'ungrounded-target',
        });
    });

    it('resolves a literal track id when a duplicate name is a token of that id', () => {
        const projectState = createProjectState();
        const firstTrack = projectState.tracks[0];
        if (!firstTrack) {
            throw new Error('Expected a track fixture');
        }
        const duplicateNameContext = {
            ...projectState,
            tracks: [
                { ...firstTrack, id: 'track-guitar', name: 'Guitar' },
                { ...firstTrack, id: 'track-guitar-2', name: 'Guitar' },
            ],
        };

        expect(resolveTrack('delete track-guitar', 'track-guitar', duplicateNameContext)).toEqual({
            status: 'resolved',
            id: 'track-guitar',
            evidence: 'literal-id',
        });
        expect(resolveTrack('delete Guitar', 'track-guitar', duplicateNameContext)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
    });

    it('keeps an independent name mention ambiguous next to a literal id that contains that name token', () => {
        const projectState = createProjectState();
        const firstTrack = projectState.tracks[0];
        if (!firstTrack) {
            throw new Error('Expected a track fixture');
        }
        const independentNameContext = {
            ...projectState,
            tracks: [
                { ...firstTrack, id: 'track-guitar', name: 'Bass' },
                { ...firstTrack, id: 'track-keys', name: 'Guitar' },
            ],
        };

        expect(resolveTrack('delete Guitar and track-guitar', 'track-guitar', independentNameContext)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(resolveTrack('delete Guitar and track-guitar', 'track-keys', independentNameContext)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(resolveTrack('mute Guitar', 'track-keys', independentNameContext)).toEqual({
            status: 'resolved',
            id: 'track-keys',
            evidence: 'exact-name',
        });
    });

    it('keeps an accented exact name ambiguous next to a hyphenated literal id that contains the folded name', () => {
        const projectState = createProjectState();
        const firstTrack = projectState.tracks[0];
        if (!firstTrack) {
            throw new Error('Expected a track fixture');
        }
        const accentedNameContext = {
            ...projectState,
            tracks: [
                { ...firstTrack, id: 'track-cafe', name: 'Bass' },
                { ...firstTrack, id: 'track-keys', name: 'Café' },
            ],
        };

        expect(resolveTrack('delete Café and track-cafe', 'track-cafe', accentedNameContext)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(resolveTrack('delete Café and track-cafe', 'track-keys', accentedNameContext)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(resolveTrack('delete Cafe and track-cafe', 'track-cafe', accentedNameContext)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(resolveTrack('delete Cafe and track-cafe', 'track-keys', accentedNameContext)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
    });

    it('keeps an ASCII exact name ambiguous next to a hyphenated literal id when the prompt token is accented', () => {
        const projectState = createProjectState();
        const firstTrack = projectState.tracks[0];
        if (!firstTrack) {
            throw new Error('Expected a track fixture');
        }
        const asciiNameContext = {
            ...projectState,
            tracks: [
                { ...firstTrack, id: 'track-cafe', name: 'Bass' },
                { ...firstTrack, id: 'track-keys', name: 'Cafe' },
            ],
        };

        expect(resolveTrack('delete Café and track-cafe', 'track-cafe', asciiNameContext)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(resolveTrack('delete Café and track-cafe', 'track-keys', asciiNameContext)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(resolveTrack('delete Cafe and track-cafe', 'track-cafe', asciiNameContext)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(resolveTrack('delete Cafe and track-cafe', 'track-keys', asciiNameContext)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(resolveTrack('mute Café', 'track-keys', asciiNameContext)).toEqual({
            status: 'resolved',
            id: 'track-keys',
            evidence: 'exact-name',
        });
        expect(resolveTrack('mute Café and track-cafe', 'track-cafe', asciiNameContext)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(resolveTrack('mute Café and track-cafe', 'track-keys', asciiNameContext)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(resolveTrack('solo Café and track-cafe', 'track-cafe', asciiNameContext)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
    });

    it('keeps Guitar and a hyphenated track-lead-guitar id ambiguous when both are cited', () => {
        const projectState = createProjectState();
        const firstTrack = projectState.tracks[0];
        if (!firstTrack) {
            throw new Error('Expected a track fixture');
        }
        const nestedNameContext = {
            ...projectState,
            tracks: [
                { ...firstTrack, id: 'track-lead-guitar', name: 'Rhythm' },
                { ...firstTrack, id: 'track-keys', name: 'Guitar' },
            ],
        };

        expect(
            resolveTrack('delete Guitar and track-lead-guitar', 'track-lead-guitar', nestedNameContext)
        ).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(resolveTrack('delete Guitar and track-lead-guitar', 'track-keys', nestedNameContext)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
    });

    it('keeps a spaced nested name and a hyphenated literal id ambiguous when both are cited', () => {
        const projectState = createProjectState();
        const firstTrack = projectState.tracks[0];
        if (!firstTrack) {
            throw new Error('Expected a track fixture');
        }
        const spacedNestedNameContext = {
            ...projectState,
            tracks: [
                { ...firstTrack, id: 'track-lead-guitar', name: 'Rhythm' },
                { ...firstTrack, id: 'track-aux', name: 'Lead Guitar' },
            ],
        };

        expect(
            resolveTrack('delete Lead Guitar and track-lead-guitar', 'track-lead-guitar', spacedNestedNameContext)
        ).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(
            resolveTrack('delete Lead Guitar and track-lead-guitar', 'track-aux', spacedNestedNameContext)
        ).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
    });

    it('keeps a slash-collapsed nested name and a hyphenated literal id ambiguous when both are cited', () => {
        const projectState = createProjectState();
        const firstTrack = projectState.tracks[0];
        if (!firstTrack) {
            throw new Error('Expected a track fixture');
        }
        const slashNestedNameContext = {
            ...projectState,
            tracks: [
                { ...firstTrack, id: 'track-lead-guitar', name: 'Rhythm' },
                { ...firstTrack, id: 'track-aux', name: 'Lead Guitar' },
            ],
        };

        expect(
            resolveTrack('delete Lead/Guitar and track-lead-guitar', 'track-lead-guitar', slashNestedNameContext)
        ).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(
            resolveTrack('delete Lead/Guitar and track-lead-guitar', 'track-aux', slashNestedNameContext)
        ).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
    });

    it('does not resolve a hyphenated id from a whitespace-separated kind and name', () => {
        const projectState = createProjectState();
        const firstTrack = projectState.tracks[0];
        if (!firstTrack) {
            throw new Error('Expected a track fixture');
        }
        const loneHyphenatedIdContext = {
            ...projectState,
            tracks: [{ ...firstTrack, id: 'track-guitar', name: 'Bass' }],
        };

        expect(resolveTrack('mute track Guitar', 'track-guitar', loneHyphenatedIdContext)).toEqual({
            status: 'rejected',
            reason: 'ungrounded-target',
        });
    });

    it('does not treat a whitespace-separated kind and name as a hyphenated literal id', () => {
        const projectState = createProjectState();
        const firstTrack = projectState.tracks[0];
        if (!firstTrack) {
            throw new Error('Expected a track fixture');
        }
        const spacedKindNameContext = {
            ...projectState,
            tracks: [
                { ...firstTrack, id: 'track-guitar', name: 'Bass' },
                { ...firstTrack, id: 'track-keys', name: 'Guitar' },
            ],
        };
        const spacedLeadGuitarContext = {
            ...projectState,
            tracks: [
                { ...firstTrack, id: 'track-lead-guitar', name: 'Rhythm' },
                { ...firstTrack, id: 'track-keys', name: 'Guitar' },
                { ...firstTrack, id: 'track-aux', name: 'Lead Guitar' },
            ],
        };

        expect(resolveTrack('mute track Guitar', 'track-guitar', spacedKindNameContext)).toEqual({
            status: 'rejected',
            reason: 'asserted-target-mismatch',
        });
        expect(resolveTrack('mute track Guitar', 'track-keys', spacedKindNameContext)).toEqual({
            status: 'resolved',
            id: 'track-keys',
            evidence: 'exact-name',
        });
        expect(resolveTrack('delete the track Lead Guitar', 'track-lead-guitar', spacedLeadGuitarContext)).toEqual({
            status: 'rejected',
            reason: 'asserted-target-mismatch',
        });
        expect(resolveTrack('delete the track Lead Guitar', 'track-aux', spacedLeadGuitarContext)).toEqual({
            status: 'resolved',
            id: 'track-aux',
            evidence: 'exact-name',
        });
    });

    it('does not treat list punctuation as collapsing a name into a hyphenated literal id', () => {
        const projectState = createProjectState();
        const firstTrack = projectState.tracks[0];
        if (!firstTrack) {
            throw new Error('Expected a track fixture');
        }
        const punctuationContext = {
            ...projectState,
            tracks: [
                { ...firstTrack, id: 'track-lead-guitar', name: 'Rhythm' },
                { ...firstTrack, id: 'track-keys', name: 'Guitar' },
            ],
        };

        expect(
            resolveRemovableTrack('delete track-lead-guitar / Guitar', 'track-lead-guitar', punctuationContext)
        ).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(
            resolveRemovableTrack('delete track-lead-guitar / Guitar', 'track-keys', punctuationContext)
        ).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(
            resolveRemovableTrack('delete track-lead-guitar, Guitar', 'track-lead-guitar', punctuationContext)
        ).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(
            resolveRemovableTrack('delete track-lead-guitar, Guitar', 'track-keys', punctuationContext)
        ).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(
            resolveRemovableTrack('delete Guitar and track-lead-guitar', 'track-lead-guitar', punctuationContext)
        ).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
    });

    it('lets a literal track ID take precedence over an overlapping display name without hiding another target', () => {
        const project = createProjectState();
        const guitar = {
            ...project.tracks[0]!,
            id: 'track-guitar',
            name: 'Track Guitar',
        };
        const overlappingName = {
            ...project.tracks[0]!,
            id: 'track-guitar-two',
            name: 'Track Guitar',
        };
        const guitarist = {
            ...project.tracks[0]!,
            id: 'track-guitarist',
            name: 'Track Guitarist',
        };
        const namedGuitar = {
            ...project.tracks[0]!,
            id: 'track-guitar-name',
            name: 'Guitar',
        };
        const context = { ...project, tracks: [guitar, overlappingName, guitarist, namedGuitar] };

        expect(resolveTrack('mute track-guitar', guitar.id, context)).toEqual({
            status: 'resolved',
            id: guitar.id,
            evidence: 'literal-id',
        });
        expect(resolveTrack('mute track-guitar and Track Guitar', guitar.id, context)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(resolveTrack('mute Track Guitar', guitar.id, context)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(resolveTrack('mute track-guitarist and Guitar', guitarist.id, context)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
        expect(resolveTrack('mute track-guitar plus Guitar', guitar.id, context)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
    });

    it('grounds dotted-I literal IDs with symmetric Unicode reference spans', () => {
        const project = createProjectState();
        const dottedI = {
            ...project.tracks[0]!,
            id: 'track-İ',
            name: 'İzmir',
        };

        expect(resolveTrack('mute track-i', dottedI.id, { ...project, tracks: [dottedI] })).toEqual({
            status: 'resolved',
            id: dottedI.id,
            evidence: 'literal-id',
        });
    });

    it('does not ground literal IDs embedded in astral Unicode letters', () => {
        const project = createProjectState();
        const guitar = {
            ...project.tracks[0]!,
            id: 'track-guitar',
            name: 'Bass',
        };
        const context = { ...project, tracks: [guitar] };

        for (const prompt of ['mute 𐐀track-guitar', 'mute track-guitar𐐀']) {
            expect(resolveTrack(prompt, guitar.id, context), prompt).toEqual({
                status: 'rejected',
                reason: 'ungrounded-target',
            });
        }
    });

    it('resolves editable clips by literal ID, unique exact name, and one explicit selection', () => {
        expect(resolveClip('trim clip-intro start to beat 2', 'clip-intro')).toEqual({
            status: 'resolved',
            id: 'clip-intro',
            evidence: 'literal-id',
        });
        expect(resolveClip('rename Intro to Opening', 'clip-intro')).toEqual({
            status: 'resolved',
            id: 'clip-intro',
            evidence: 'exact-name',
        });
        expect(resolveClip('nudge the selected clip by 2 beats', 'clip-intro')).toEqual({
            status: 'resolved',
            id: 'clip-intro',
            evidence: 'selection',
        });
    });

    it('treats quoted reserved clip references as literal names without masking apostrophes', () => {
        const project = createClipProjectState();
        const track = project.tracks[0];
        if (!track) {
            throw new Error('Expected Vocals track fixture');
        }
        const literalSelectedClip = {
            ...track.clips[0]!,
            id: 'clip-literal-selected',
            name: 'Selected Clip',
            startBeat: 24,
            endBeat: 32,
        };
        const apostropheClip = {
            ...track.clips[0]!,
            id: 'clip-drummer-cut',
            name: "Drummer's Cut",
            startBeat: 32,
            endBeat: 40,
        };
        const curlyApostropheClip = {
            ...track.clips[0]!,
            id: 'clip-curly-selected',
            name: 'Drummer’s Selected Clip',
            startBeat: 40,
            endBeat: 48,
        };
        project.tracks = [
            {
                ...track,
                clipCount: track.clipCount + 3,
                clips: [...track.clips, literalSelectedClip, apostropheClip, curlyApostropheClip],
            },
            ...project.tracks.slice(1),
        ];

        expect(resolveClip('rename selected clip', 'clip-intro', project)).toEqual({
            status: 'resolved',
            id: 'clip-intro',
            evidence: 'selection',
        });
        expect(resolveClip('rename "Selected Clip"', literalSelectedClip.id, project)).toEqual({
            status: 'resolved',
            id: literalSelectedClip.id,
            evidence: 'exact-name',
        });
        expect(resolveClip("rename Drummer's Cut", apostropheClip.id, project)).toEqual({
            status: 'resolved',
            id: apostropheClip.id,
            evidence: 'exact-name',
        });
        expect(resolveClip('rename ‘Drummer’s Selected Clip’ to Bridge Solo', curlyApostropheClip.id, project)).toEqual(
            {
                status: 'resolved',
                id: curlyApostropheClip.id,
                evidence: 'exact-name',
            }
        );
        expect(resolveClip('rename ‘Drummer’s Selected Clip’ to Bridge Solo', 'clip-intro', project)).toMatchObject({
            status: 'rejected',
            reason: 'asserted-target-mismatch',
        });
    });

    it('uses an exact track qualifier to disambiguate duplicate clip names', () => {
        expect(resolveClip('rename Verse on Vocals to Lead Verse', 'clip-vocals-verse')).toEqual({
            status: 'resolved',
            id: 'clip-vocals-verse',
            evidence: 'exact-name',
        });
        expect(resolveClip('rename Verse on Bass to Bass Verse', 'clip-bass-verse')).toEqual({
            status: 'resolved',
            id: 'clip-bass-verse',
            evidence: 'exact-name',
        });
        expect(resolveClip('rename Verse to Lead Verse', 'clip-vocals-verse')).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
    });

    it('rejects multi-selection and locked clip edit targets', () => {
        const project = createClipProjectState();
        const multiSelection = {
            ...project,
            selectedClipId: 'clip-intro',
            selectedClipIds: ['clip-intro', 'clip-vocals-verse'],
        };

        expect(resolveClip('nudge the selected clip by 2 beats', 'clip-intro', multiSelection)).toMatchObject({
            status: 'rejected',
        });
        expect(resolveClip('rename Locked to Open', 'clip-locked', project)).toMatchObject({
            status: 'rejected',
            reason: 'ungrounded-target',
        });
    });

    it('resolves only unlocked non-empty MIDI clips for note transforms', () => {
        const project = createClipProjectState();
        const bass = project.tracks[1];
        if (!bass) {
            throw new Error('Expected bass fixture');
        }
        const ambiguousContext = {
            ...project,
            tracks: project.tracks.map((track) =>
                track.id === bass.id
                    ? {
                          ...track,
                          clips: [
                              ...track.clips,
                              {
                                  ...project.tracks[0]!.clips[0]!,
                                  id: 'clip-audio-piano',
                                  name: 'Piano MIDI',
                              },
                          ],
                      }
                    : track
            ),
        };

        expect(resolveMidiClip('quantize notes in Piano MIDI', 'clip-midi')).toEqual({
            status: 'resolved',
            id: 'clip-midi',
            evidence: 'exact-name',
        });
        expect(resolveMidiClip('quantize notes in Intro', 'clip-intro')).toMatchObject({
            status: 'rejected',
            reason: 'ungrounded-target',
        });
        expect(resolveMidiClip('quantize notes in Empty MIDI', 'clip-empty-midi')).toMatchObject({
            status: 'rejected',
            reason: 'ungrounded-target',
        });
        expect(resolveMidiClip('transpose notes in Locked MIDI', 'clip-locked-midi')).toMatchObject({
            status: 'rejected',
            reason: 'ungrounded-target',
        });
        expect(resolveMidiClip('quantize notes in Piano MIDI', 'clip-midi', ambiguousContext)).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
    });

    it('admits empty unlocked MIDI clips but rejects locked MIDI and audio clips for note writes', () => {
        expect(resolveWritableMidiClip('add notes in Empty MIDI', 'clip-empty-midi')).toEqual({
            status: 'resolved',
            id: 'clip-empty-midi',
            evidence: 'exact-name',
        });
        expect(resolveWritableMidiClip('add notes in Locked MIDI', 'clip-locked-midi')).toMatchObject({
            status: 'rejected',
            reason: 'ungrounded-target',
        });
        expect(resolveWritableMidiClip('add notes in Intro', 'clip-intro')).toMatchObject({
            status: 'rejected',
            reason: 'ungrounded-target',
        });
        const project = createClipProjectState();
        expect(
            resolveWritableMidiClip('add notes in Empty MIDI', 'clip-empty-midi', {
                ...project,
                tracks: project.tracks.map((track) =>
                    track.id === 'track-vocals' ? { ...track, frozen: true } : track
                ),
            })
        ).toMatchObject({
            status: 'rejected',
            reason: 'ungrounded-target',
        });
    });

    it('resolves only unlocked audio clips for audio processing', () => {
        expect(resolveAudioClip('normalize the Intro clip', 'clip-intro')).toEqual({
            status: 'resolved',
            id: 'clip-intro',
            evidence: 'exact-name',
        });
        expect(resolveAudioClip('normalize the Piano MIDI clip', 'clip-midi')).toMatchObject({
            status: 'rejected',
            reason: 'ungrounded-target',
        });
        expect(resolveAudioClip('normalize the Locked clip', 'clip-locked')).toMatchObject({
            status: 'rejected',
            reason: 'ungrounded-target',
        });

        const project = createClipProjectState();
        const modeCollision = {
            ...project,
            tracks: project.tracks.map((track, trackIndex) => ({
                ...track,
                clips: trackIndex === 0 ? [{ ...track.clips[0]!, id: 'clip-lufs', name: 'LUFS' }] : [],
            })),
            selectedClipId: null,
            selectedClipIds: [],
        };
        expect(resolveAudioClip('normalize to -14 LUFS', 'clip-lufs', modeCollision)).toMatchObject({
            status: 'rejected',
            reason: 'ungrounded-target',
        });
    });

    it('scopes duplicate automation-lane names by their owner track', () => {
        expect(resolveAutomationLane('disable Gain automation on Vocals', 'lane-vocals-gain')).toEqual({
            status: 'resolved',
            id: 'lane-vocals-gain',
            evidence: 'exact-name',
        });
        expect(resolveAutomationLane('enable Gain automation on Bass', 'lane-bass-gain')).toEqual({
            status: 'resolved',
            id: 'lane-bass-gain',
            evidence: 'exact-name',
        });
        expect(resolveAutomationLane('disable Gain automation', 'lane-vocals-gain')).toMatchObject({
            status: 'rejected',
            reason: 'ambiguous-target',
        });
    });

    it('supports literal lane IDs and selected-track owner scoping without inventing a lane selection', () => {
        expect(resolveAutomationLane('disable lane-vocals-gain', 'lane-vocals-gain')).toEqual({
            status: 'resolved',
            id: 'lane-vocals-gain',
            evidence: 'literal-id',
        });
        expect(resolveAutomationLane('disable Pan automation on the selected track', 'lane-vocals-pan')).toEqual({
            status: 'resolved',
            id: 'lane-vocals-pan',
            evidence: 'exact-name',
        });
        expect(resolveAutomationLane('disable automation on the selected track', 'lane-vocals-gain')).toMatchObject({
            status: 'rejected',
            reason: 'ungrounded-target',
        });
    });

    it('resolves adjustment layers only from immutable project-context candidates', () => {
        const project = {
            ...createProjectState(),
            adjustmentLayers: [
                {
                    id: 'layer-bass-air',
                    name: 'Bass Air',
                    effectType: 'eq' as const,
                    parameters: [],
                    affectedTrackIds: ['track-bass'],
                    insertionIndex: 0,
                    regions: [],
                    enabled: true,
                    mix: 1,
                    color: '#ffffff',
                },
            ],
        };

        expect(
            resolveAgentReference({
                prompt: 'add a region to Bass Air',
                assertedId: 'layer-bass-air',
                capability: 'adjustment-layer',
                context: project,
            })
        ).toEqual({ status: 'resolved', id: 'layer-bass-air', evidence: 'exact-name' });
        expect(
            resolveAgentReference({
                prompt: 'add a region to Bass Air',
                assertedId: 'layer-from-store-only',
                capability: 'adjustment-layer',
                context: project,
            })
        ).toEqual({ status: 'rejected', reason: 'asserted-target-mismatch' });
    });
});
