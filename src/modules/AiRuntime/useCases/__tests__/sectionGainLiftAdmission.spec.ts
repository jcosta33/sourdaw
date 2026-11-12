import { describe, expect, it } from 'vitest';

import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';
import { admitCreativeInterpretation } from '../admitCreativeInterpretation';
import { bridgeGroundedLlmToolCalls } from '../agentReference/bridgeGroundedLlmToolCalls';
import { prepareCreativeInterpretationCatalog } from '../prepareCreativeInterpretationCatalog';

const track = (id: string, name: string, kind: ProjectContextTrack['kind']): ProjectContextTrack => ({
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
    clipCount: 0,
    deviceCount: 0,
    clips: [],
    devices: [],
});

// The pop-mix shape #4697 describes: two choruses, a unique drum bus and bass
// bus, a lead vocal, and exactly one master. The retired whole-project vibe-mix
// workflow (#4372) once resolved its own gain lift from this shape alone; it is
// now an ordinary project whose bus gain lift grounds like any other action.
const vibeShapedContext: ProjectContext = {
    tempo: 124,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 80,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 80,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    availableDeviceTypes: [{ id: 'builtin-reverb', name: 'Reverb' }],
    sections: [
        { id: 'section-verse', name: 'Verse', startBeat: 16, endBeat: 32 },
        { id: 'section-chorus-one', name: 'Chorus One', startBeat: 32, endBeat: 48 },
        { id: 'section-chorus-two', name: 'Chorus Two', startBeat: 56, endBeat: 72 },
    ],
    tracks: [
        track('bus-drums', 'Drum Bus', 'bus'),
        track('bus-bass', 'Bass Bus', 'bus'),
        track('track-lead-vocal', 'Lead Vocal', 'audio'),
        track('track-lead-guitar', 'Lead Guitar', 'audio'),
        track('track-master', 'Master', 'master'),
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

/** One section gain lift per bus, in the order the provider lists them. */
function liftCalls(trackIds: readonly string[]) {
    return trackIds.map((trackId) => ({
        name: 'automateParameterRange',
        arguments: { trackId, parameterId: 'gain', range: { section: 'Chorus Two' }, deltaDb: 1.5 },
    }));
}

function liftAction(trackId: string) {
    return expect.objectContaining({
        type: 'automateParameterRange',
        payload: expect.objectContaining({
            trackId,
            parameterId: 'gain',
            range: { section: 'Chorus Two' },
            deltaDb: 1.5,
        }),
    });
}

describe('section gain lift admission on a vibe-shaped project', () => {
    it('cannot reach outside the frozen generic subjects', () => {
        const prompt = 'Make Lead Guitar warmer';
        const catalog = prepareCreativeInterpretationCatalog({
            prompt,
            context: vibeShapedContext,
            projectRevision: 'frozen-revision',
        });
        const admitted = admitCreativeInterpretation({
            catalog,
            projectRevision: catalog.revision,
            call: {
                name: 'selectCreativeInterpretation',
                arguments: {
                    catalogId: catalog.catalogId,
                    modeId: 'edit',
                    targetCandidateIds: catalog.targets.map((target) => target.candidateId),
                    editDimensionCandidateIds: catalog.dimensions
                        .filter((dimension) => dimension.dimension === 'processing')
                        .map((dimension) => dimension.candidateId),
                    constraintCandidateIds: [],
                    creationSlotIds: [],
                    uncertainty: 'artistic',
                },
            },
        });
        if (admitted.status !== 'admitted') {
            throw new Error('Expected actual catalog-bound generic admission.');
        }
        const frozen = JSON.stringify(admitted.authority);
        const result = bridgeGroundedLlmToolCalls({
            calls: liftCalls(['bus-drums', 'bus-bass']),
            context: vibeShapedContext,
            prompt,
            creativeAuthority: admitted.authority,
            sectionSignatures: [{ name: 'Chorus Two', sectionId: 'section-chorus-two', startBeat: 56, endBeat: 72 }],
        });
        expect(result.actions).toEqual([]);
        expect(result.rejections.length).toBeGreaterThan(0);
        expect(new Set(result.rejections.map((rejection) => rejection.reason))).toEqual(
            new Set(['Creative authority does not extend to automation effects'])
        );
        expect(JSON.stringify(admitted.authority)).toBe(frozen);
    });

    it('lets an ordinary device request reach grounding', () => {
        const result = bridgeGroundedLlmToolCalls({
            calls: [{ name: 'addDevice', arguments: { trackId: 'track-lead-guitar', deviceType: 'Reverb' } }],
            context: vibeShapedContext,
            prompt: 'add a reverb to the lead guitar',
        });

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([
            expect.objectContaining({
                type: 'addDevice',
                payload: expect.objectContaining({ trackId: 'track-lead-guitar' }),
            }),
        ]);
    });

    it('grounds a bus gain lift whose request names both buses', () => {
        const result = bridgeGroundedLlmToolCalls({
            calls: liftCalls(['bus-drums', 'bus-bass']),
            context: vibeShapedContext,
            sectionSignatures: [{ name: 'Chorus Two', sectionId: 'section-chorus-two', startBeat: 56, endBeat: 72 }],
            prompt: 'Lift Drum Bus and Bass Bus by 1.5 dB in Chorus Two',
        });

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([liftAction('bus-drums'), liftAction('bus-bass')]);
    });

    // Each bus is its own call, so the provider's order is the batch's order and both still ground.
    it('grounds both lifts when the provider lists the buses in the other order', () => {
        const result = bridgeGroundedLlmToolCalls({
            calls: liftCalls(['bus-bass', 'bus-drums']),
            context: vibeShapedContext,
            sectionSignatures: [{ name: 'Chorus Two', sectionId: 'section-chorus-two', startBeat: 56, endBeat: 72 }],
            prompt: 'Lift Drum Bus and Bass Bus by 1.5 dB in Chorus Two',
        });

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([liftAction('bus-bass'), liftAction('bus-drums')]);
    });

    // The retired workflow admitted this lift from the project's shape whatever the request said;
    // a request stating the lift, its figure and its section but naming no bus now grounds no bus.
    it('refuses a bus gain lift whose request names no bus', () => {
        const result = bridgeGroundedLlmToolCalls({
            calls: liftCalls(['bus-drums', 'bus-bass']),
            context: vibeShapedContext,
            sectionSignatures: [{ name: 'Chorus Two', sectionId: 'section-chorus-two', startBeat: 56, endBeat: 72 }],
            prompt: 'Lift the rhythm section by 1.5 dB in Chorus Two',
        });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toEqual(
            [0, 1].map((index) => ({
                index,
                name: 'automateParameterRange',
                reason: 'Provider action is not grounded in the user request',
            }))
        );
    });
});
