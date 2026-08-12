import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { resolveAgentReference } from '../resolveAgentReference';

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

function createSemanticReferenceProjectState(): ProjectContext {
    const project = createProjectState();
    const vocals = project.tracks[0]!;
    const bass = project.tracks[1]!;
    vocals.gain = 0.9;
    vocals.clips = [
        {
            id: 'clip-vocals-verse',
            name: 'Verse Vocal',
            type: 'audio',
            startBeat: 0,
            endBeat: 16,
            noteCount: 0,
        },
    ];
    bass.kind = 'midi';
    bass.gain = 0.4;
    bass.clips = [
        {
            id: 'clip-bass-chorus',
            name: 'Chorus Bass',
            type: 'midi',
            startBeat: 16,
            endBeat: 32,
            noteCount: 12,
        },
    ];
    return {
        ...project,
        sections: [
            { id: 'section-verse', name: 'Verse One', startBeat: 0, endBeat: 16 },
            { id: 'section-chorus', name: 'Chorus One', startBeat: 16, endBeat: 32 },
        ],
        productionBrief: {
            schemaVersion: 1,
            id: 'production-brief',
            revision: 1,
            vision: null,
            references: [],
            hardConstraints: [],
            preferences: [],
            sectionGoals: [],
            trackRoles: [{ id: 'role-bass', trackId: bass.id, role: 'low end', createdAt: 100 }],
            locks: [],
            decisions: [
                {
                    id: 'decision-vocals',
                    scope: { kind: 'track', trackId: vocals.id },
                    statement: 'Keep vocals forward',
                    rationale: null,
                    status: 'accepted',
                    sourceRunId: null,
                    relatedBatchId: null,
                    supersededByDecisionId: null,
                    createdAt: 200,
                },
                {
                    id: 'decision-bass',
                    scope: { kind: 'track', trackId: bass.id },
                    statement: 'Keep bass controlled',
                    rationale: null,
                    status: 'accepted',
                    sourceRunId: null,
                    relatedBatchId: null,
                    supersededByDecisionId: null,
                    createdAt: 300,
                },
            ],
            unresolvedQuestions: [],
            sourceRunLinks: [],
            supersedesBriefId: null,
            supersededByBriefId: null,
            createdAt: 100,
            updatedAt: 300,
        },
    };
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

function resolveMidiClip(prompt: string, assertedId: string, project = createClipProjectState()) {
    return resolveAgentReference({ prompt, assertedId, capability: 'editable-midi-clip', context: project });
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
    it('returns stable-ID confidence and evidence receipts for exact and selected targets', () => {
        expect(resolveTrack('mute Vocals', 'track-vocals')).toMatchObject({
            status: 'resolved',
            id: 'track-vocals',
            confidence: 1,
            evidenceReceipt: [{ kind: 'exact-name', value: 'Vocals' }],
        });
        expect(resolveTrack('mute the selected track', 'track-vocals')).toMatchObject({
            status: 'resolved',
            id: 'track-vocals',
            confidence: 1,
            evidenceReceipt: [{ kind: 'selection', value: 'track-vocals' }],
        });
    });

    it('resolves role, section, tag, recency, fuzzy-text, and inferred-property references', () => {
        const project = createSemanticReferenceProjectState();

        expect(resolveTrack('mute the low end track', 'track-bass', project)).toMatchObject({
            status: 'resolved',
            id: 'track-bass',
            confidence: 0.95,
            evidence: 'role',
        });
        expect(resolveTrack('mute the MIDI track', 'track-bass', project)).toMatchObject({
            status: 'resolved',
            id: 'track-bass',
            evidence: 'tag',
        });
        expect(resolveTrack('mute the track in Chorus One', 'track-bass', project)).toMatchObject({
            status: 'resolved',
            id: 'track-bass',
            evidence: 'section',
        });
        expect(resolveTrack('mute the most recently referenced track', 'track-bass', project)).toMatchObject({
            status: 'resolved',
            id: 'track-bass',
            evidence: 'recency',
        });
        expect(resolveTrack('mute Vocls', 'track-vocals', project)).toMatchObject({
            status: 'resolved',
            id: 'track-vocals',
            evidence: 'fuzzy-name',
        });
        expect(resolveTrack('mute the loudest track', 'track-vocals', project)).toMatchObject({
            status: 'resolved',
            id: 'track-vocals',
            evidence: 'inferred-property',
        });
    });

    it('requires clarification or explicit preview for risky ambiguous and low-confidence targets', () => {
        const project = createSemanticReferenceProjectState();
        project.productionBrief!.trackRoles.push({
            id: 'role-vocals-bass',
            trackId: 'track-vocals',
            role: 'bass',
            createdAt: 400,
        });

        const ambiguous = resolveAgentReference({
            prompt: 'delete the bass track',
            assertedId: 'track-bass',
            capability: 'removable-track',
            context: project,
            effectRisk: 'destructive-reversible',
        });
        expect(ambiguous).toMatchObject({
            status: 'rejected',
            reason: 'clarification-required',
        });
        expect(ambiguous.status === 'rejected' ? ambiguous.candidateIds : []).toEqual(
            expect.arrayContaining(['track-vocals', 'track-bass'])
        );

        const uniqueProject = createSemanticReferenceProjectState();
        expect(
            resolveAgentReference({
                prompt: 'delete Vocls',
                assertedId: 'track-vocals',
                capability: 'removable-track',
                context: uniqueProject,
                effectRisk: 'destructive-reversible',
            })
        ).toMatchObject({ status: 'rejected', reason: 'preview-required', candidateIds: ['track-vocals'] });
        expect(
            resolveAgentReference({
                prompt: 'preview deleting Vocls',
                assertedId: 'track-vocals',
                capability: 'removable-track',
                context: uniqueProject,
                effectRisk: 'destructive-reversible',
                mode: 'preview',
            })
        ).toMatchObject({ status: 'resolved', id: 'track-vocals', evidence: 'fuzzy-name' });
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

        const exactDevice = resolveAgentReference({
            prompt: 'insert Compressor after EQ',
            assertedId: 'device-eq',
            capability: 'device',
            context: project,
            dependencyId: bass.id,
        });
        expect(exactDevice).toMatchObject({ status: 'resolved', id: 'device-eq', evidence: 'exact-name' });
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

    it('resolves unique exact names and explicit selection language', () => {
        expect(resolveTrack('mute Vocals', 'track-vocals')).toMatchObject({
            status: 'resolved',
            id: 'track-vocals',
            evidence: 'exact-name',
        });
        expect(resolveTrack('mute the selected track', 'track-vocals')).toMatchObject({
            status: 'resolved',
            id: 'track-vocals',
            evidence: 'selection',
        });
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
        expect(resolveTrack('mute Lead Vox', 'track-lead-vox', overlappingContext)).toMatchObject({
            status: 'resolved',
            id: 'track-lead-vox',
            evidence: 'exact-name',
        });
        expect(resolveTrack('adjust the embassy', 'track-bass', projectState)).toEqual({
            status: 'rejected',
            reason: 'ungrounded-target',
        });
    });

    it('resolves editable clips by literal ID, unique exact name, and one explicit selection', () => {
        expect(resolveClip('trim clip-intro start to beat 2', 'clip-intro')).toMatchObject({
            status: 'resolved',
            id: 'clip-intro',
            evidence: 'literal-id',
        });
        expect(resolveClip('rename Intro to Opening', 'clip-intro')).toMatchObject({
            status: 'resolved',
            id: 'clip-intro',
            evidence: 'exact-name',
        });
        expect(resolveClip('nudge the selected clip by 2 beats', 'clip-intro')).toMatchObject({
            status: 'resolved',
            id: 'clip-intro',
            evidence: 'selection',
        });
    });

    it('uses an exact track qualifier to disambiguate duplicate clip names', () => {
        expect(resolveClip('rename Verse on Vocals to Lead Verse', 'clip-vocals-verse')).toMatchObject({
            status: 'resolved',
            id: 'clip-vocals-verse',
            evidence: 'exact-name',
        });
        expect(resolveClip('rename Verse on Bass to Bass Verse', 'clip-bass-verse')).toMatchObject({
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

        expect(resolveMidiClip('quantize notes in Piano MIDI', 'clip-midi')).toMatchObject({
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

    it('resolves only unlocked audio clips for audio processing', () => {
        expect(resolveAudioClip('normalize the Intro clip', 'clip-intro')).toMatchObject({
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
        expect(resolveAutomationLane('disable Gain automation on Vocals', 'lane-vocals-gain')).toMatchObject({
            status: 'resolved',
            id: 'lane-vocals-gain',
            evidence: 'exact-name',
        });
        expect(resolveAutomationLane('enable Gain automation on Bass', 'lane-bass-gain')).toMatchObject({
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
        expect(resolveAutomationLane('disable lane-vocals-gain', 'lane-vocals-gain')).toMatchObject({
            status: 'resolved',
            id: 'lane-vocals-gain',
            evidence: 'literal-id',
        });
        expect(resolveAutomationLane('disable Pan automation on the selected track', 'lane-vocals-pan')).toMatchObject({
            status: 'resolved',
            id: 'lane-vocals-pan',
            evidence: 'exact-name',
        });
        expect(resolveAutomationLane('disable automation on the selected track', 'lane-vocals-gain')).toMatchObject({
            status: 'rejected',
            reason: 'ungrounded-target',
        });
    });
});
