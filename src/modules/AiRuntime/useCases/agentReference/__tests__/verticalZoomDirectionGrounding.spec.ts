import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { bridgeGroundedLlmToolCalls } from '../bridgeGroundedLlmToolCalls';

/**
 * A vertical zoom is signed by the words that say which way the rows go: the delta a provider asserts
 * must carry the sign the request states, never only the figure's magnitude.
 */

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
    tracks: [
        {
            id: 'track-drums',
            name: 'Drums',
            kind: 'audio',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 0.8,
            pan: 0,
            automationMode: 'read',
            outputId: 'master',
            clipCount: 0,
            deviceCount: 0,
            clips: [],
            devices: [],
            sends: [],
        },
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

function zoom(prompt: string, delta: number) {
    return bridgeGroundedLlmToolCalls({
        calls: [{ name: 'zoomTracksVertical', arguments: { delta } }],
        prompt,
        context,
        markerSignatures: [],
        sectionSignatures: [],
    });
}

const MISMATCH = 'Provider value delta does not match the user request';

describe('vertical zoom direction grounding', () => {
    it.each([
        ['zoom tracks vertically out by 40', -40, 40],
        ['zoom tracks vertically in by 40', 40, -40],
        ['zoom tracks vertically to make them shorter by 40', -40, 40],
        ['zoom tracks vertically to make them taller by 40', 40, -40],
        ['zoom tracks vertically out by -40', -40, 40],
        ['zoom tracks vertically in by -40', -40, 40],
        ['zoom tracks vertically by 40 while the volume is turned down', 40, -40],
        ['zoom tracks vertically by 40 and lower the vocal volume', 40, -40],
        ['zoom tracks vertically to reduce every row by 40', -40, 40],
        ['zoom tracks vertically to shrink every row by 40', -40, 40],
        ['zoom tracks vertically to make the rows bigger by 40', 40, -40],
        ['zoom tracks vertically in the chorus by 40', 40, -40],
        ['zoom tracks vertically out of the chorus by 40', 40, -40],
    ])('admits the stated way and refuses the opposite for "%s"', (prompt, admitted, refused) => {
        const accepted = zoom(prompt, admitted);
        const rejected = zoom(prompt, refused);

        expect(accepted.rejections).toEqual([]);
        expect(accepted.actions).toEqual([{ type: 'zoomTracksVertical', payload: { delta: admitted } }]);
        expect(rejected.actions).toEqual([]);
        expect(rejected.rejections[0]?.reason).toBe(MISMATCH);
    });

    it('keeps a figure the request signs itself', () => {
        expect(zoom('zoom tracks vertically by -40', -40).actions).toEqual([
            { type: 'zoomTracksVertical', payload: { delta: -40 } },
        ]);
        expect(zoom('zoom tracks vertically by -40', 40).actions).toEqual([]);
    });

    it('grounds no sign when the request names both ways', () => {
        const prompt = 'zoom tracks vertically by 40 making rows taller or shorter';

        expect(zoom(prompt, 40).actions).toEqual([]);
        expect(zoom(prompt, -40).actions).toEqual([]);
    });

    it('keeps the stated magnitude when the request names no way', () => {
        expect(zoom('zoom tracks vertically by 40', 40).actions).toEqual([
            { type: 'zoomTracksVertical', payload: { delta: 40 } },
        ]);
        expect(zoom('zoom tracks vertically by 40', -40).actions).toEqual([]);
    });
});
