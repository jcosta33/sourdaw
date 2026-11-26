import { describe, expect, it } from 'vitest';

import { defaultMidiStoreState, midiStore, type MidiNote } from '#/modules/MIDI/stores';

import { CREATIVE_INTERPRETATION_TOOL_NAME } from '../../../models/CreativeInterpretation';
import { type ProjectContext, type ProjectContextClip, type ProjectContextTrack } from '../../../models/ProjectContext';
import { admitCreativeInterpretation } from '../../admitCreativeInterpretation';
import { prepareCreativeInterpretationCatalog } from '../../prepareCreativeInterpretationCatalog';
import { bridgeGroundedLlmToolCalls } from '../bridgeGroundedLlmToolCalls';

const projectRevision = 'revision-target-conflicts';
const defaultContext: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 8,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 8,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

function track(
    id: string,
    name: string,
    kind: ProjectContextTrack['kind'],
    clips: ProjectContextClip[] = []
): ProjectContextTrack {
    return {
        id,
        name,
        kind,
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        outputId: kind === 'master' ? 'hw_out' : 'master',
        clipCount: clips.length,
        deviceCount: 0,
        clips,
        devices: [],
        sends: [],
    };
}

function midiClip(id: string, name: string): ProjectContextClip {
    return { id, name, type: 'midi', startBeat: 0, endBeat: 8, noteCount: 2 };
}

function overlappingNotes(clipId: string, pitch: number): MidiNote[] {
    return [
        { id: `${clipId}-first`, pitch, startBeat: 0, duration: 1.04, velocity: 100, channel: 0 },
        { id: `${clipId}-second`, pitch, startBeat: 1, duration: 1, velocity: 96, channel: 0 },
    ];
}

function admitMidiEdit(prompt: string, context: ProjectContext, clipIds: readonly string[]) {
    const catalog = prepareCreativeInterpretationCatalog({ prompt, context, projectRevision });
    const targets = catalog.targets.filter((target) => target.objectIds.some((id) => clipIds.includes(id)));
    const admission = admitCreativeInterpretation({
        catalog,
        projectRevision,
        call: {
            name: CREATIVE_INTERPRETATION_TOOL_NAME,
            arguments: {
                catalogId: catalog.catalogId,
                modeId: 'edit',
                targetCandidateIds: targets.map(({ candidateId }) => candidateId),
                editDimensionCandidateIds: catalog.dimensions
                    .filter(({ dimension }) => dimension === 'midi-content')
                    .map(({ candidateId }) => candidateId),
                constraintCandidateIds: [],
                creationSlotIds: [],
                uncertainty: 'none',
            },
        },
    });
    if (admission.status !== 'admitted') {
        throw new Error(`Expected an admitted MIDI edit: ${admission.reason}`);
    }
    expect(admission.authority.targets.flatMap(({ objectIds }) => objectIds)).toEqual(clipIds);
    return admission.authority;
}

describe('bridgeGroundedLlmToolCalls target conflicts', () => {
    it('refuses an exact selected MIDI workflow that exceeds the frozen edit subjects', () => {
        const piano = midiClip('clip-piano', 'Piano Phrase');
        const strings = midiClip('clip-strings', 'Strings Phrase');
        const context: ProjectContext = {
            ...defaultContext,
            tracks: [
                track('track-piano', 'Piano', 'midi', [piano]),
                track('track-strings', 'Strings', 'midi', [strings]),
            ],
            selectedClipId: piano.id,
            selectedClipIds: [piano.id, strings.id],
        };
        const prompt = 'Shorten MIDI overlaps in Piano Phrase and Strings Phrase below 30 ms.';
        const calls = [piano.id, strings.id].map((clipId) => ({
            name: 'removeShortMidiOverlaps',
            arguments: { clipId, maximumOverlapMs: 30 },
        }));
        const input = {
            calls,
            context,
            prompt,
            projectRevision,
            workflowCapabilityId: 'midi-overlap-shortening',
        } as const;
        const previousMidiState = midiStore.value;
        midiStore.set({
            ...defaultMidiStoreState,
            notesByClipId: {
                [piano.id]: overlappingNotes(piano.id, 60),
                [strings.id]: overlappingNotes(strings.id, 67),
            },
        });
        try {
            expect(
                bridgeGroundedLlmToolCalls({
                    ...input,
                    creativeAuthority: admitMidiEdit(prompt, context, [piano.id, strings.id]),
                })
            ).toMatchObject({
                actions: [
                    { type: 'removeShortMidiOverlaps', payload: { clipId: piano.id, maximumOverlapMs: 30 } },
                    { type: 'removeShortMidiOverlaps', payload: { clipId: strings.id, maximumOverlapMs: 30 } },
                ],
                rejections: [],
            });
            expect(
                bridgeGroundedLlmToolCalls({
                    ...input,
                    creativeAuthority: admitMidiEdit(prompt, context, [piano.id]),
                })
            ).toEqual({
                actions: [],
                rejections: [
                    {
                        index: 0,
                        name: '<batch>',
                        reason: 'The selected workflow reaches outside the frozen interpretation subjects.',
                    },
                ],
            });
        } finally {
            midiStore.set(previousMidiState);
        }
    });

    it('reports an existing but unrequested output on the offending route call', () => {
        const vocals = track('track-vocals', 'Vocals', 'audio');
        const delay = track('bus-delay', 'Delay Bus', 'bus');
        const reverb = track('bus-reverb', 'Reverb Bus', 'bus');
        const context: ProjectContext = {
            ...defaultContext,
            tracks: [vocals, delay, reverb, track('master', 'Master', 'master')],
            selectedTrackId: vocals.id,
            activeView: 'mix',
        };
        const prompt = 'Route the selected track to Delay Bus.';
        const route = (outputId: string) =>
            bridgeGroundedLlmToolCalls({
                calls: [{ name: 'setTrackOutput', arguments: { trackId: vocals.id, outputId } }],
                context,
                prompt,
            });

        expect(route(delay.id)).toEqual({
            actions: [
                {
                    type: 'setTrackOutput',
                    payload: { trackId: vocals.id, outputId: delay.id, expectedOutputId: 'master' },
                },
            ],
            rejections: [],
        });
        expect(route(reverb.id)).toEqual({
            actions: [],
            rejections: [
                {
                    index: 0,
                    name: 'setTrackOutput',
                    reason: 'Provider target outputId does not match the uniquely grounded project reference',
                },
            ],
        });
    });
});
