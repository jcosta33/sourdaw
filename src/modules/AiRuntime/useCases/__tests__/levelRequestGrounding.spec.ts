import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../models/ProjectContext';
import { bridgeGroundedLlmToolCalls } from '../agentReference/bridgeGroundedLlmToolCalls';

/**
 * A level request stated in decibels reaches the handler as decibels.
 *
 * Every acceptor on the provider path has to admit the form the request used —
 * the tool schema the planner is handed, the grounding rules that check its
 * answer against the words, and the strategy that builds the payload — and a
 * gap in any one of them sends the model back to arithmetic: "down 2 dB"
 * becomes a linear 0.63 the model computed from a fader curve it cannot see,
 * and nothing downstream can tell that guess from the request. These cases
 * therefore drive whole calls through the real planner path rather than
 * checking a handler that was never the narrow part.
 *
 * Both readings of a decibel figure are exercised on purpose: "to -6 dB" says
 * where the level lands, "down 2 dB" says how far it moves, and a path that
 * confuses them writes a level nobody asked for.
 */

type ProjectTrack = ProjectContext['tracks'][number];

function createTrack({
    id,
    name,
    kind = 'audio',
    gain = 0.8,
    clips = [],
    sends = [],
}: {
    id: string;
    name: string;
    kind?: ProjectTrack['kind'];
    gain?: number;
    clips?: ProjectTrack['clips'];
    sends?: ProjectTrack['sends'];
}): ProjectTrack {
    return {
        id,
        name,
        kind,
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain,
        pan: 0,
        automationMode: 'read',
        outputId: kind === 'master' ? 'hw_out' : 'master',
        clipCount: clips.length,
        deviceCount: 0,
        clips,
        devices: [],
        sends,
    };
}

const vocalTake: NonNullable<ProjectTrack['clips']>[number] = {
    id: 'clip-vocal-take',
    name: 'Vocal Take',
    type: 'audio',
    startBeat: 0,
    endBeat: 8,
    gain: 1,
    noteCount: 0,
};

const vocals = createTrack({ id: 'track-vocals', name: 'Vocals', clips: [vocalTake] });
const reverb = createTrack({ id: 'track-reverb', name: 'Reverb', kind: 'bus' });
const master = createTrack({ id: 'master', name: 'Master', kind: 'master' });

const projectContext: ProjectContext = {
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
    automationLanes: [
        {
            id: 'lane-vocal-gain',
            trackId: 'track-vocals',
            parameterId: 'gain',
            name: 'Gain',
            enabled: true,
            minValue: 0,
            maxValue: 1,
            points: [],
        },
    ],
    tracks: [vocals, reverb, master],
    selectedTrackId: 'track-vocals',
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'mix',
    playheadPosition: 0,
};

const contextWithSend: ProjectContext = {
    ...projectContext,
    tracks: [
        createTrack({
            id: vocals.id,
            name: vocals.name,
            clips: [vocalTake],
            sends: [{ busId: reverb.id, level: 0.5, preFader: false }],
        }),
        reverb,
        master,
    ],
};

function bridge(
    calls: Parameters<typeof bridgeGroundedLlmToolCalls>[0]['calls'],
    prompt: string,
    context: ProjectContext = projectContext
) {
    return bridgeGroundedLlmToolCalls({ calls, prompt, context, markerSignatures: [], sectionSignatures: [] });
}

describe('a level stated in decibels reaches the handler in decibels', () => {
    it('grounds a downward change and refuses the other readings of the same figure', () => {
        const prompt = 'turn Vocals down 2 dB';

        const change = bridge([{ name: 'setTrackGain', arguments: { trackId: vocals.id, deltaDb: -2 } }], prompt);
        const wrongDirection = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, deltaDb: 2 } }],
            prompt
        );
        const asDestination = bridge([{ name: 'setTrackGain', arguments: { trackId: vocals.id, gainDb: -2 } }], prompt);
        const asAmplitude = bridge([{ name: 'setTrackGain', arguments: { trackId: vocals.id, gain: 0.6 } }], prompt);

        expect(change.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: vocals.id, deltaDb: -2 } }]);
        expect(wrongDirection.actions).toEqual([]);
        expect(asDestination.actions).toEqual([]);
        expect(asAmplitude.actions).toEqual([]);
        expect(asAmplitude.rejections[0]?.reason).toBe(
            'Provider value gain must use the decibel form the request states'
        );
    });

    it('grounds an upward change stated after the figure', () => {
        const prompt = 'make Vocals 3 dB louder';

        const louder = bridge([{ name: 'setTrackGain', arguments: { trackId: vocals.id, deltaDb: 3 } }], prompt);
        const quieter = bridge([{ name: 'setTrackGain', arguments: { trackId: vocals.id, deltaDb: -3 } }], prompt);

        expect(louder.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: vocals.id, deltaDb: 3 } }]);
        expect(quieter.actions).toEqual([]);
    });

    it('reads the direction from the verb when the figure follows it bare', () => {
        const up = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, deltaDb: 2 } }],
            'raise Vocals 2dB'
        );
        const upBackwards = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, deltaDb: -2 } }],
            'raise Vocals 2dB'
        );
        const down = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, deltaDb: -2 } }],
            'lower Vocals 2dB'
        );

        expect(up.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: vocals.id, deltaDb: 2 } }]);
        expect(upBackwards.actions).toEqual([]);
        expect(down.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: vocals.id, deltaDb: -2 } }]);
    });

    it('refuses both readings when no word says which one the figure is', () => {
        const prompt = 'Vocals volume 2dB';

        const asChange = bridge([{ name: 'setTrackGain', arguments: { trackId: vocals.id, deltaDb: 2 } }], prompt);
        const asDestination = bridge([{ name: 'setTrackGain', arguments: { trackId: vocals.id, gainDb: 2 } }], prompt);

        expect(asChange.actions).toEqual([]);
        expect(asDestination.actions).toEqual([]);
    });

    it('grounds a change the request signs itself', () => {
        const prompt = 'Vocals volume +3 dB';

        const up = bridge([{ name: 'setTrackGain', arguments: { trackId: vocals.id, deltaDb: 3 } }], prompt);
        const down = bridge([{ name: 'setTrackGain', arguments: { trackId: vocals.id, deltaDb: -3 } }], prompt);

        expect(up.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: vocals.id, deltaDb: 3 } }]);
        expect(down.actions).toEqual([]);
    });

    it('grounds a fractional change stated with a connector', () => {
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, deltaDb: 1.5 } }],
            'raise Vocals by 1.5 dB'
        );

        expect(result.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: vocals.id, deltaDb: 1.5 } }]);
    });

    it('grounds an absolute track level and refuses the change and amplitude readings', () => {
        const prompt = 'set Vocals volume to -6 dB';

        const destination = bridge([{ name: 'setTrackGain', arguments: { trackId: vocals.id, gainDb: -6 } }], prompt);
        const asChange = bridge([{ name: 'setTrackGain', arguments: { trackId: vocals.id, deltaDb: -6 } }], prompt);
        const asAmplitude = bridge([{ name: 'setTrackGain', arguments: { trackId: vocals.id, gain: 0.5 } }], prompt);

        expect(destination.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: vocals.id, gainDb: -6 } }]);
        expect(asChange.actions).toEqual([]);
        expect(asAmplitude.actions).toEqual([]);
    });

    it('reads a level placed with at as the level to land on', () => {
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, gainDb: -12 } }],
            'set Vocals volume at -12 dB'
        );

        expect(result.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: vocals.id, gainDb: -12 } }]);
    });

    it('grounds an absolute master level', () => {
        const result = bridge([{ name: 'setMasterGain', arguments: { gainDb: -3 } }], 'set the master volume to -3 dB');

        expect(result.actions).toEqual([{ type: 'setMasterGain', payload: { gainDb: -3 } }]);
    });

    it('grounds an absolute clip level', () => {
        const result = bridge(
            [{ name: 'setClipGain', arguments: { clipId: vocalTake.id, gainDb: -6 } }],
            'set clip Vocal Take gain to -6 dB'
        );

        expect(result.actions).toEqual([{ type: 'setClipGain', payload: { clipId: vocalTake.id, gainDb: -6 } }]);
    });

    it('grounds an absolute level on a send being created', () => {
        const result = bridge(
            [{ name: 'addSend', arguments: { trackId: vocals.id, busId: reverb.id, levelDb: -10 } }],
            'send Vocals to Reverb at -10 dB'
        );

        expect(result.actions).toEqual([
            {
                type: 'addSend',
                payload: { trackId: vocals.id, busId: reverb.id, levelDb: -10, expectedAbsent: true },
            },
        ]);
    });

    it('grounds a change on a send being created and refuses it as a destination', () => {
        const prompt = 'send Vocals to Reverb down 6 dB';

        const change = bridge(
            [{ name: 'addSend', arguments: { trackId: vocals.id, busId: reverb.id, deltaDb: -6 } }],
            prompt
        );
        const asDestination = bridge(
            [{ name: 'addSend', arguments: { trackId: vocals.id, busId: reverb.id, levelDb: -6 } }],
            prompt
        );

        expect(change.actions).toEqual([
            {
                type: 'addSend',
                payload: { trackId: vocals.id, busId: reverb.id, deltaDb: -6, expectedAbsent: true },
            },
        ]);
        expect(asDestination.actions).toEqual([]);
    });

    it('grounds a change on an existing send', () => {
        const result = bridge(
            [{ name: 'setSend', arguments: { trackId: vocals.id, busId: reverb.id, deltaDb: -2 } }],
            'change send from Vocals to Reverb down 2 dB',
            contextWithSend
        );

        expect(result.actions).toEqual([
            {
                type: 'setSend',
                payload: {
                    trackId: vocals.id,
                    busId: reverb.id,
                    deltaDb: -2,
                    expectedLevel: 0.5,
                    expectedPreFader: false,
                },
            },
        ]);
    });

    it('grounds an absolute level on a linear gain automation lane', () => {
        const result = bridge(
            [{ name: 'addAutomationPoint', arguments: { laneId: 'lane-vocal-gain', beat: 4, valueDb: -6 } }],
            'add automation point on the Vocals Gain lane at beat 4 at -6 dB'
        );

        expect(result.actions).toEqual([
            { type: 'addAutomationPoint', payload: { laneId: 'lane-vocal-gain', beat: 4, valueDb: -6 } },
        ]);
    });

    it('still grounds a level the request states as an amplitude', () => {
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, gain: 0.8 } }],
            'set Vocals volume to 80%'
        );

        expect(result.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: vocals.id, gain: 0.8 } }]);
    });
});
