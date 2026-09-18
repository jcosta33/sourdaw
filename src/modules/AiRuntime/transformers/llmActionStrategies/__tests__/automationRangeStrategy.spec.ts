import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { type SectionPlanningSignature } from '../../llmActionBridgeContracts';
import {
    automationRangeActionNames,
    automationRangeStrategyRegistry,
    bridgeAutomationRangeToolCall,
} from '../automationRangeStrategy';

const projectContext: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 0,
    metronomeEnabled: false,
    metronomeVolume: 0,
    masterGain: 1,
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
    automationLanes: [],
    tracks: [
        {
            id: 'track-source',
            name: 'Source',
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
            devices: [],
            clips: [],
            sends: [{ busId: 'track-bus', level: 0.5, preFader: false }],
        },
        {
            id: 'track-bus',
            name: 'Bus',
            kind: 'bus',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            frozen: false,
            gain: 0.8,
            pan: 0,
            automationMode: 'read',
            clipCount: 0,
            deviceCount: 0,
            devices: [],
            clips: [],
        },
    ],
};

const sectionSignatures: readonly SectionPlanningSignature[] = [
    { sectionId: 'section-1', name: 'Chorus', startBeat: 0, endBeat: 16 },
];

const foreignCall = { name: 'addMarker', arguments: { beat: 0, name: 'Intro' } };

describe('automationRangeStrategy', () => {
    it('registers exactly the exported automation-range action names', () => {
        expect(new Set(automationRangeStrategyRegistry.keys())).toEqual(new Set(automationRangeActionNames));
    });

    it('returns null for a name owned by another family', () => {
        expect(
            bridgeAutomationRangeToolCall({ call: foreignCall, context: projectContext, index: 0, sectionSignatures })
        ).toBeNull();
    });

    it('addAdjustmentRegion adds one exact bounded adjustment-layer region', () => {
        expect(
            bridgeAutomationRangeToolCall({
                call: {
                    name: 'addAdjustmentRegion',
                    arguments: {
                        layerId: 'layer-1',
                        startBeat: 0,
                        endBeat: 8,
                        blend: 0.5,
                        fadeInBeats: 1,
                        fadeOutBeats: 1,
                    },
                },
                context: projectContext,
                index: 1,
                sectionSignatures,
            })
        ).toEqual({
            type: 'addAdjustmentRegion',
            payload: { layerId: 'layer-1', startBeat: 0, endBeat: 8, blend: 0.5, fadeInBeats: 1, fadeOutBeats: 1 },
        });
    });

    it('automateSendRange reduces exact routable sources into one existing bus and section', () => {
        expect(
            bridgeAutomationRangeToolCall({
                call: {
                    name: 'automateSendRange',
                    arguments: {
                        trackIds: ['track-source'],
                        busId: 'track-bus',
                        sectionName: 'Chorus',
                        reductionDb: 6,
                    },
                },
                context: projectContext,
                index: 2,
                sectionSignatures,
            })
        ).toEqual({
            type: 'automateSendRange',
            payload: { trackIds: ['track-source'], busId: 'track-bus', sectionName: 'Chorus', reductionDb: 6 },
        });
    });

    it('automateTrackGainRange lifts exact impact buses over one existing section', () => {
        expect(
            bridgeAutomationRangeToolCall({
                call: {
                    name: 'automateTrackGainRange',
                    arguments: { trackIds: ['track-bus'], sectionName: 'Chorus', gainDb: 3 },
                },
                context: projectContext,
                index: 3,
                sectionSignatures,
            })
        ).toEqual({
            type: 'automateTrackGainRange',
            payload: { trackIds: ['track-bus'], sectionName: 'Chorus', gainDb: 3 },
        });
    });
});
