import { describe, expect, it } from 'vitest';

import { createPunchRegionPatch } from '#/modules/Transport/useCases';

import { type ProjectContext } from '../../../models/ProjectContext';
import {
    bridgeTransportTimelineToolCall,
    createLlmActionStrategyRegistry,
    transportTimelineStrategyRegistry,
} from '../transportTimelineStrategy';

const projectContext: ProjectContext = {
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

describe('transportTimelineStrategy', () => {
    it('registers the complete transport and timeline family exactly once', () => {
        expect([...transportTimelineStrategyRegistry.keys()]).toEqual([
            'setTempo',
            'setTimeSignature',
            'setPlayback',
            'stopPlayback',
            'seekPlayhead',
            'setLoopEnabled',
            'setLoopRegion',
            'setPunchIn',
            'setPunchOut',
            'setPunchEnabled',
            'setMetronomeEnabled',
            'setMetronomeVolume',
        ]);
    });

    it('rejects duplicate strategy names', () => {
        expect(() =>
            createLlmActionStrategyRegistry([
                { name: 'setTempo', transform: () => ({ type: 'setTempo', payload: { bpm: 120 } }) },
                { name: 'setTempo', transform: () => ({ type: 'setTempo', payload: { bpm: 128 } }) },
            ])
        ).toThrow('Duplicate LLM action strategy: setTempo');
    });

    it('delegates registered calls and leaves legacy calls for the bridge', () => {
        const input = {
            context: projectContext,
            index: 0,
            projectPunchRegion: createPunchRegionPatch,
        };

        expect(
            bridgeTransportTimelineToolCall({
                ...input,
                call: { name: 'setTempo', arguments: { bpm: 128 } },
            })
        ).toEqual({ type: 'setTempo', payload: { bpm: 128 } });
        expect(
            bridgeTransportTimelineToolCall({
                ...input,
                call: { name: 'setMasterGain', arguments: { gain: 0.9 } },
            })
        ).toBeNull();
    });
});
