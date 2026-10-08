import { describe, expect, it } from 'vitest';

import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';
import { bridgeGroundedLlmToolCalls } from '../agentReference/bridgeGroundedLlmToolCalls';

const VIBE_MIX_REJECTION_REASON = 'Provider plan does not match the bounded whole-project vibe-mix scope';

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
// bus, a lead vocal, and exactly one master — an ordinary template the
// project-shaped scope resolves on its own.
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

const singleChorusContext: ProjectContext = {
    ...vibeShapedContext,
    sections: vibeShapedContext.sections?.filter((section) => section.id !== 'section-chorus-two'),
};

describe('whole-project vibe-mix admission scoping (#4697)', () => {
    it('lets an ordinary device request in a vibe-shaped project reach grounding instead of the vibe-mix gate', () => {
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

    it('still admits the provider-selected automateTrackGainRange capability in the vibe-shaped project', () => {
        const result = bridgeGroundedLlmToolCalls({
            calls: [
                {
                    name: 'automateTrackGainRange',
                    arguments: {
                        trackIds: ['bus-drums', 'bus-bass'],
                        sectionName: 'Chorus Two',
                        gainDb: 1.5,
                    },
                },
            ],
            context: vibeShapedContext,
            sectionSignatures: [{ name: 'Chorus Two', sectionId: 'section-chorus-two', startBeat: 56, endBeat: 72 }],
            prompt: 'Make the second chorus hit harder without changing any lead-vocal state, the tempo map, or the master chain.',
        });

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([
            expect.objectContaining({
                type: 'automateTrackGainRange',
                payload: expect.objectContaining({
                    trackIds: ['bus-drums', 'bus-bass'],
                    sectionName: 'Chorus Two',
                    gainDb: 1.5,
                }),
            }),
        ]);
    });

    it('still fails closed when the provider selects the capability a single-chorus project does not admit', () => {
        const result = bridgeGroundedLlmToolCalls({
            calls: [
                {
                    name: 'automateTrackGainRange',
                    arguments: {
                        trackIds: ['bus-drums', 'bus-bass'],
                        sectionName: 'Chorus One',
                        gainDb: 1.5,
                    },
                },
            ],
            context: singleChorusContext,
            prompt: 'Make the chorus hit harder.',
        });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toEqual([{ index: 0, name: '<batch>', reason: VIBE_MIX_REJECTION_REASON }]);
    });
});
