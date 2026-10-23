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

    it('grounds the whole decibel fraction and refuses its numerator alone', () => {
        const prompt = 'lower Vocals by 1/2 dB';

        const fraction = bridge([{ name: 'setTrackGain', arguments: { trackId: vocals.id, deltaDb: -0.5 } }], prompt);
        const numerator = bridge([{ name: 'setTrackGain', arguments: { trackId: vocals.id, deltaDb: -1 } }], prompt);

        expect(fraction.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: vocals.id, deltaDb: -0.5 } }]);
        expect(numerator.actions).toEqual([]);
        expect(
            bridge([{ name: 'setTrackGain', arguments: { trackId: vocals.id, deltaDb: -1 } }], 'lower Vocals by 1/0 dB')
                .actions
        ).toEqual([]);
    });

    it('grounds a spaced decibel fraction as one complete figure', () => {
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, deltaDb: -0.5 } }],
            'lower Vocals by 1 / 2 dB'
        );

        expect(result.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: vocals.id, deltaDb: -0.5 } }]);
    });

    it.each([
        ['a chained fraction', 'lower Vocals by 1/2/3 dB', -3],
        ['an incomplete denominator', 'lower Vocals by 1/ dB', -1],
        ['a signed denominator', 'lower Vocals by 1/-2 dB', -2],
        ['a repeated decimal boundary', 'lower Vocals by 1.2.3 dB', -0.3],
        ['a repeated sign boundary', 'lower Vocals by --2 dB', -2],
    ])('refuses %s instead of grounding a numeric suffix', (_label, prompt, deltaDb) => {
        const result = bridge([{ name: 'setTrackGain', arguments: { trackId: vocals.id, deltaDb } }], prompt);

        expect(result.actions).toEqual([]);
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

    it('binds an absolute destination instead of its stated source level', () => {
        const prompt = 'set Vocals volume from -12 dB to -6 dB';

        const destination = bridge([{ name: 'setTrackGain', arguments: { trackId: vocals.id, gainDb: -6 } }], prompt);
        const source = bridge([{ name: 'setTrackGain', arguments: { trackId: vocals.id, gainDb: -12 } }], prompt);
        const asAmplitude = bridge([{ name: 'setTrackGain', arguments: { trackId: vocals.id, gain: 0.5 } }], prompt);

        expect(destination.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: vocals.id, gainDb: -6 } }]);
        expect(source.actions).toEqual([]);
        expect(asAmplitude.actions).toEqual([]);
    });

    it('grounds unity when an absolute connector states zero decibels', () => {
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, gainDb: 0 } }],
            'set Vocals volume to 0 dB'
        );

        expect(result.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: vocals.id, gainDb: 0 } }]);
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

    it('binds a change stated after a masked reference to the figure, not to the reference connector', () => {
        const prompt = 'send Vocals to Reverb 4 dB lower';

        const change = bridge(
            [{ name: 'addSend', arguments: { trackId: vocals.id, busId: reverb.id, deltaDb: -4 } }],
            prompt
        );
        const asDestination = bridge(
            [{ name: 'addSend', arguments: { trackId: vocals.id, busId: reverb.id, levelDb: -4 } }],
            prompt
        );

        expect(change.actions).toEqual([
            {
                type: 'addSend',
                payload: { trackId: vocals.id, busId: reverb.id, deltaDb: -4, expectedAbsent: true },
            },
        ]);
        expect(asDestination.actions).toEqual([]);
    });

    it('binds a change after punctuation on a masked reference', () => {
        const prompt = 'send Vocals to Reverb: 4 dB lower';

        const change = bridge(
            [{ name: 'addSend', arguments: { trackId: vocals.id, busId: reverb.id, deltaDb: -4 } }],
            prompt
        );
        const wrongDirection = bridge(
            [{ name: 'addSend', arguments: { trackId: vocals.id, busId: reverb.id, deltaDb: 4 } }],
            prompt
        );
        const asDestination = bridge(
            [{ name: 'addSend', arguments: { trackId: vocals.id, busId: reverb.id, levelDb: -4 } }],
            prompt
        );
        const asAmplitude = bridge(
            [{ name: 'addSend', arguments: { trackId: vocals.id, busId: reverb.id, level: 0.63 } }],
            prompt
        );

        expect(change.actions).toEqual([
            {
                type: 'addSend',
                payload: { trackId: vocals.id, busId: reverb.id, deltaDb: -4, expectedAbsent: true },
            },
        ]);
        expect(wrongDirection.actions).toEqual([]);
        expect(asDestination.actions).toEqual([]);
        expect(asAmplitude.actions).toEqual([]);
    });

    it('binds a change on an existing send stated after a masked reference', () => {
        const result = bridge(
            [{ name: 'setSend', arguments: { trackId: vocals.id, busId: reverb.id, deltaDb: -3 } }],
            'change send from Vocals to Reverb 3 dB lower',
            contextWithSend
        );

        expect(result.actions).toEqual([
            {
                type: 'setSend',
                payload: {
                    trackId: vocals.id,
                    busId: reverb.id,
                    deltaDb: -3,
                    expectedLevel: 0.5,
                    expectedPreFader: false,
                },
            },
        ]);
    });

    it('grounds a change smaller than the stored linear gain', () => {
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, deltaDb: 0.5 } }],
            'raise Vocals 0.5 dB'
        );

        expect(vocals.gain).toBe(0.8);
        expect(result.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: vocals.id, deltaDb: 0.5 } }]);
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

describe('a decibel level stated on a named track without the word gain or volume', () => {
    const drums = createTrack({ id: 'track-drums', name: 'Drums' });
    const fx = createTrack({ id: 'track-fx', name: 'FX' });
    const drumsContext: ProjectContext = {
        ...projectContext,
        tracks: [
            drums,
            {
                ...fx,
                deviceCount: 1,
                devices: [
                    {
                        id: 'device-plate',
                        name: 'Plate',
                        type: 'Native',
                        bypassed: false,
                        parameters: [
                            {
                                id: 'native-threshold',
                                name: 'native-threshold',
                                type: 'float',
                                value: -24,
                                minValue: -60,
                                maxValue: 0,
                                unit: 'dB',
                            },
                        ],
                    },
                ],
            },
            master,
        ],
        selectedTrackId: null,
    };

    function bridgeDrums(calls: Parameters<typeof bridge>[0], prompt: string) {
        return bridge(calls, prompt, drumsContext);
    }

    it('grounds "set ... to" with a decibel figure as an absolute fader level', () => {
        const prompt = 'set Drums to -6 dB';

        const destination = bridgeDrums(
            [{ name: 'setTrackGain', arguments: { trackId: drums.id, gainDb: -6 } }],
            prompt
        );
        const wrongFigure = bridgeDrums(
            [{ name: 'setTrackGain', arguments: { trackId: drums.id, gainDb: -3 } }],
            prompt
        );
        const asChange = bridgeDrums([{ name: 'setTrackGain', arguments: { trackId: drums.id, deltaDb: -6 } }], prompt);
        const asAmplitude = bridgeDrums(
            [{ name: 'setTrackGain', arguments: { trackId: drums.id, gain: 0.5 } }],
            prompt
        );

        expect(destination.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: drums.id, gainDb: -6 } }]);
        expect(wrongFigure.actions).toEqual([]);
        expect(asChange.actions).toEqual([]);
        expect(asAmplitude.actions).toEqual([]);
    });

    it('grounds a bare "<track> up N dB" as a relative change and refuses the other readings', () => {
        const prompt = 'Drums up 2 dB';

        const change = bridgeDrums([{ name: 'setTrackGain', arguments: { trackId: drums.id, deltaDb: 2 } }], prompt);
        const wrongDirection = bridgeDrums(
            [{ name: 'setTrackGain', arguments: { trackId: drums.id, deltaDb: -2 } }],
            prompt
        );
        const asDestination = bridgeDrums(
            [{ name: 'setTrackGain', arguments: { trackId: drums.id, gainDb: 2 } }],
            prompt
        );

        expect(change.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: drums.id, deltaDb: 2 } }]);
        expect(wrongDirection.actions).toEqual([]);
        expect(asDestination.actions).toEqual([]);
    });

    it('grounds a bare "<track> down N dB" as a relative change and refuses the other readings', () => {
        const prompt = 'Drums down 2 dB';

        const change = bridgeDrums([{ name: 'setTrackGain', arguments: { trackId: drums.id, deltaDb: -2 } }], prompt);
        const wrongDirection = bridgeDrums(
            [{ name: 'setTrackGain', arguments: { trackId: drums.id, deltaDb: 2 } }],
            prompt
        );
        const asDestination = bridgeDrums(
            [{ name: 'setTrackGain', arguments: { trackId: drums.id, gainDb: -2 } }],
            prompt
        );

        expect(change.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: drums.id, deltaDb: -2 } }]);
        expect(wrongDirection.actions).toEqual([]);
        expect(asDestination.actions).toEqual([]);
    });

    it('does not read a figure with no decibel unit or a percentage as a decibel level', () => {
        const noUnit = bridgeDrums(
            [{ name: 'setTrackGain', arguments: { trackId: drums.id, gainDb: -6 } }],
            'set Drums to -6'
        );
        const percent = bridgeDrums(
            [{ name: 'setTrackGain', arguments: { trackId: drums.id, gain: 0.5 } }],
            'set Drums to 50%'
        );
        const percentPan = bridgeDrums(
            [{ name: 'setTrackPan', arguments: { trackId: drums.id, pan: 50 } }],
            'set Drums to 50%'
        );

        expect(noUnit.actions).toEqual([]);
        expect(percent.actions).toEqual([]);
        expect(percentPan.actions).toEqual([]);
    });

    it('does not ground a different action on the same words', () => {
        const prompt = 'set Drums to -6 dB';

        const pan = bridgeDrums([{ name: 'setTrackPan', arguments: { trackId: drums.id, pan: -6 } }], prompt);
        const deviceParameter = bridgeDrums(
            [
                {
                    name: 'setDeviceParameter',
                    arguments: { deviceId: 'device-plate', paramId: 'native-threshold', value: -6 },
                },
            ],
            prompt
        );

        expect(pan.actions).toEqual([]);
        expect(deviceParameter.actions).toEqual([]);
    });

    it('refuses a fader level for a name that is a device, not a track', () => {
        const prompt = 'set the Plate to -6 dB';

        const onHostTrack = bridgeDrums([{ name: 'setTrackGain', arguments: { trackId: fx.id, gainDb: -6 } }], prompt);
        const onOtherTrack = bridgeDrums(
            [{ name: 'setTrackGain', arguments: { trackId: drums.id, gainDb: -6 } }],
            prompt
        );

        expect(onHostTrack.actions).toEqual([]);
        expect(onOtherTrack.actions).toEqual([]);
    });

    it('still grounds a device parameter stated in decibels with its parameter named', () => {
        const result = bridgeDrums(
            [
                {
                    name: 'setDeviceParameter',
                    arguments: { deviceId: 'device-plate', paramId: 'native-threshold', value: -6 },
                },
            ],
            'set native-threshold on device-plate to -6 dB'
        );

        expect(result.actions).toHaveLength(1);
    });
});

describe('a referenced level phrase grounds a fader only on the track it names', () => {
    const drums = createTrack({ id: 'track-drums', name: 'Drums' });
    const keys = createTrack({ id: 'track-keys', name: 'Keys', kind: 'midi' });
    const compContext: ProjectContext = {
        ...projectContext,
        tracks: [
            {
                ...drums,
                deviceCount: 1,
                devices: [
                    {
                        id: 'device-comp',
                        name: 'Comp',
                        type: 'Comp',
                        bypassed: false,
                        parameters: [
                            {
                                id: 'comp-threshold',
                                name: 'Threshold',
                                type: 'float',
                                value: -24,
                                minValue: -60,
                                maxValue: 0,
                                unit: 'dB',
                            },
                            {
                                id: 'comp-makeup',
                                name: 'Makeup',
                                type: 'float',
                                value: 0,
                                minValue: 0,
                                maxValue: 24,
                                unit: 'dB',
                            },
                        ],
                    },
                ],
            },
            keys,
            master,
        ],
        vcaGroups: [{ id: 'vca-strings', name: 'Strings', gain: 1, muted: false, trackIds: [keys.id] }],
        selectedTrackId: null,
    };

    function bridgeComp(calls: Parameters<typeof bridge>[0], prompt: string) {
        return bridge(calls, prompt, compContext);
    }

    it.each([
        ['set Threshold to -6 dB on Drums', drums, { gainDb: -6 }],
        ['set the Threshold to -6 dB on Drums', drums, { gainDb: -6 }],
        ['Makeup up 2 dB on Drums', drums, { deltaDb: 2 }],
        ['Threshold down 6 dB on Drums', drums, { deltaDb: -6 }],
        ['set Strings to -6 dB on Keys', keys, { gainDb: -6 }],
        ['Strings up 2 dB on Keys', keys, { deltaDb: 2 }],
    ])('does not read "%s" as a fader level on the track it mentions later', (prompt, track, value) => {
        const result = bridgeComp([{ name: 'setTrackGain', arguments: { trackId: track.id, ...value } }], prompt);

        expect(result.actions).toEqual([]);
    });

    it.each([
        ['set Drums to -6 dB', drums, { gainDb: -6 }],
        ['set the Drums to -6 dB', drums, { gainDb: -6 }],
        ['Drums up 2 dB', drums, { deltaDb: 2 }],
        ['Keys down 2 dB', keys, { deltaDb: -2 }],
    ])('still grounds "%s" on the track the phrase names', (prompt, track, value) => {
        const result = bridgeComp([{ name: 'setTrackGain', arguments: { trackId: track.id, ...value } }], prompt);

        expect(result.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: track.id, ...value } }]);
    });

    it('refuses a fader level on the other track when the phrase names a different track', () => {
        const result = bridgeComp(
            [{ name: 'setTrackGain', arguments: { trackId: keys.id, gainDb: -6 } }],
            'set Drums to -6 dB'
        );

        expect(result.actions).toEqual([]);
    });
});

describe('a referenced level phrase counts only with nothing but the figure after it', () => {
    const drums = createTrack({ id: 'track-drums', name: 'Drums' });
    const drumsContext: ProjectContext = {
        ...projectContext,
        tracks: [drums, master],
        selectedTrackId: null,
    };

    it.each([
        'set Drums to normalize to -1 dB',
        'set Drums to normalize at -6 dB',
        'set Drums to peak at -6 dB',
        'set Drums to limit at -1 dB',
        'set Drums to clip at -1 dB',
        'set Drums to send -6 dB',
        'set Drums to -6 dB send',
        'set Drums to threshold -6 dB',
        'set Drums to -6 dB threshold',
        'set Drums to cut 3 dB at 200 Hz',
        'set Drums to boost 200 Hz by 3 dB',
    ])('does not read "%s" as a fader level', (prompt) => {
        const figure = /(-?\d+(?:\.\d+)?) dB/u.exec(prompt)?.[1] ?? '0';
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: drums.id, gainDb: Number(figure) } }],
            prompt,
            drumsContext
        );

        expect(result.actions).toEqual([]);
    });

    it.each([
        ['set Drums to -6 dB', { gainDb: -6 }],
        ['set the Drums to -6 dB', { gainDb: -6 }],
        ['please set Drums to -6 dB', { gainDb: -6 }],
        ['set Drums to -6 dB please', { gainDb: -6 }],
        ['set Drums to -6 dB.', { gainDb: -6 }],
        ['set Drums to +3 dB', { gainDb: 3 }],
        ['Drums up 2 dB', { deltaDb: 2 }],
        ['the Drums down 2 dB', { deltaDb: -2 }],
        ['please Drums up 2 dB please', { deltaDb: 2 }],
    ])('still grounds "%s"', (prompt, value) => {
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: drums.id, ...value } }],
            prompt,
            drumsContext
        );

        expect(result.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: drums.id, ...value } }]);
    });
});

describe('the words a referenced level phrase is matched on', () => {
    const drums = createTrack({ id: 'track-drums', name: 'Drums' });
    const keys = createTrack({ id: 'track-keys', name: 'Keys', kind: 'midi' });
    const drumsContext: ProjectContext = {
        ...projectContext,
        tracks: [drums, keys, master],
        vcaGroups: [{ id: 'vca-strings', name: 'Strings', gain: 1, muted: false, trackIds: [keys.id] }],
        selectedTrackId: drums.id,
    };

    function bridgeDrums(prompt: string, value: Record<string, number>, trackId: string = drums.id) {
        return bridge([{ name: 'setTrackGain', arguments: { trackId, ...value } }], prompt, drumsContext);
    }

    it.each([
        ['Set Drums to -6 dB', { gainDb: -6 }],
        ['SET THE DRUMS TO -6 DB', { gainDb: -6 }],
        ['drums UP 2 dB', { deltaDb: 2 }],
    ])('reads "%s" without regard to case', (prompt, value) => {
        const result = bridgeDrums(prompt, value);

        expect(result.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: drums.id, ...value } }]);
    });

    it('lets "the" stand before the reference and no other article', () => {
        const withThe = bridgeDrums('set the Drums to -6 dB', { gainDb: -6 });
        const withA = bridgeDrums('set a Drums to -6 dB', { gainDb: -6 });
        const withAn = bridgeDrums('set an Drums to -6 dB', { gainDb: -6 });

        expect(withThe.actions).toHaveLength(1);
        expect(withA.actions).toEqual([]);
        expect(withAn.actions).toEqual([]);
    });

    it.each([
        ['set to -6 dB', { gainDb: -6 }],
        ['set the to -6 dB', { gainDb: -6 }],
        ['up 2 dB', { deltaDb: 2 }],
        ['down 2 dB', { deltaDb: -2 }],
        ['Okay, up 2 dB', { deltaDb: 2 }],
        ['Okay, down 2 dB', { deltaDb: -2 }],
    ])('does not read "%s", which names no track, as a level on the selected track', (prompt, value) => {
        const result = bridgeDrums(prompt, value);

        expect(result.actions).toEqual([]);
    });

    it.each(['set-Drums to -6 dB', 'set: Drums to -6 dB', 'set, Drums to -6 dB', 'setDrums to -6 dB'])(
        'does not read "%s", which breaks the words apart another way, as a fader level',
        (prompt) => {
            const result = bridgeDrums(prompt, { gainDb: -6 });

            expect(result.actions).toEqual([]);
        }
    );

    it.each(['reset Drums to -6 dB', 'we set Drums to -6 dB', 'then set Drums to -6 dB', 'do not set Drums to -6 dB'])(
        'does not read "%s", where "set" does not open the clause, as a fader level',
        (prompt) => {
            const result = bridgeDrums(prompt, { gainDb: -6 });

            expect(result.actions).toEqual([]);
        }
    );

    it.each(['Drums up is -6 dB', 'Drums up seems to be -6 dB', 'set Drums to is -6 dB'])(
        'does not read "%s", which describes the level, as a fader level',
        (prompt) => {
            const absolute = bridgeDrums(prompt, { gainDb: -6 });
            const relative = bridgeDrums(prompt, { deltaDb: 6 });

            expect(absolute.actions).toEqual([]);
            expect(relative.actions).toEqual([]);
        }
    );

    it('refuses the phrase continued onto a track when its own reference is not a track', () => {
        const result = bridge(
            [
                { name: 'setTrackGain', arguments: { trackId: drums.id, gainDb: -6 } },
                { name: 'setTrackGain', arguments: { trackId: keys.id, gainDb: -3 } },
            ],
            'set Strings to -6 dB, Keys to -3 dB',
            drumsContext
        );

        expect(result.actions).toEqual([]);
        expect(result.rejections.map((rejection) => rejection.reason)).toEqual([
            'Target trackId is not grounded in the user request',
            'Provider track is not the reference the level phrase names',
        ]);
    });

    it('grounds the phrase continued onto a second track when its own reference is a track', () => {
        const prompt = 'set Drums to -6 dB, Keys to -3 dB';

        const result = bridge(
            [
                { name: 'setTrackGain', arguments: { trackId: drums.id, gainDb: -6 } },
                { name: 'setTrackGain', arguments: { trackId: keys.id, gainDb: -3 } },
            ],
            prompt,
            drumsContext
        );

        expect(result.actions).toEqual([
            { type: 'setTrackGain', payload: { trackId: drums.id, gainDb: -6 } },
            { type: 'setTrackGain', payload: { trackId: keys.id, gainDb: -3 } },
        ]);
    });
});

describe('a referenced level phrase grounds only beside clauses that are read', () => {
    const drums = createTrack({
        id: 'track-drums',
        name: 'Drums',
        sends: [{ busId: 'track-reverb', level: 0.5, preFader: false }],
    });
    const keys = createTrack({ id: 'track-keys', name: 'Keys', kind: 'midi' });
    const bass = createTrack({ id: 'track-bass', name: 'Bass' });
    const mixContext: ProjectContext = {
        ...projectContext,
        tracks: [
            {
                ...drums,
                deviceCount: 1,
                devices: [
                    {
                        id: 'device-comp',
                        name: 'Comp',
                        type: 'Comp',
                        bypassed: false,
                        parameters: [
                            {
                                id: 'comp-threshold',
                                name: 'Threshold',
                                type: 'float',
                                value: -24,
                                minValue: -60,
                                maxValue: 0,
                                unit: 'dB',
                            },
                        ],
                    },
                ],
            },
            keys,
            bass,
            reverb,
            master,
        ],
        selectedTrackId: null,
    };

    function bridgeDrums(prompt: string, value: Record<string, number>) {
        return bridge([{ name: 'setTrackGain', arguments: { trackId: drums.id, ...value } }], prompt, mixContext);
    }

    it.each([
        ['Drums up 2 dB, on the Reverb send', { deltaDb: 2 }],
        ['Drums up 2 dB, Reverb send', { deltaDb: 2 }],
        ['set Drums to -6 dB, Comp threshold', { gainDb: -6 }],
        ['Drums down 2 dB, Comp threshold', { deltaDb: -2 }],
        ['set Drums to -6 dB, send', { gainDb: -6 }],
        ['set Drums to -6 dB, threshold', { gainDb: -6 }],
        ['set Drums to -1 dB, normalize', { gainDb: -1 }],
        ['set Drums to -1 dB, peak', { gainDb: -1 }],
        ['set Drums to -6 dB, only in the chorus', { gainDb: -6 }],
        ['set Drums to -6 dB, on Keys', { gainDb: -6 }],
        ['set Drums to -6 dB, instead', { gainDb: -6 }],
    ])('does not read "%s", whose later clause is unread, as a fader level', (prompt, value) => {
        const result = bridgeDrums(prompt, value);

        expect(result.actions).toEqual([]);
    });

    it.each([
        ['set Drums to -6 dB, please', { gainDb: -6 }],
        ['set Drums to -6 dB, thanks', { gainDb: -6 }],
        ['set Drums to -6 dB, ok', { gainDb: -6 }],
        ['okay, set Drums to -6 dB', { gainDb: -6 }],
        ['Drums up 2 dB, thank you', { deltaDb: 2 }],
    ])('still grounds "%s", whose other clause is filler', (prompt, value) => {
        const result = bridgeDrums(prompt, value);

        expect(result.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: drums.id, ...value } }]);
    });

    it('still grounds a referenced level phrase beside a clause that grounds its own call', () => {
        const mute = bridge(
            [
                { name: 'setTrackGain', arguments: { trackId: drums.id, gainDb: -6 } },
                { name: 'muteTrack', arguments: { trackId: keys.id, muted: true } },
            ],
            'set Drums to -6 dB, and mute Keys',
            mixContext
        );
        const pan = bridge(
            [
                { name: 'setTrackGain', arguments: { trackId: drums.id, gainDb: -6 } },
                { name: 'setTrackPan', arguments: { trackId: bass.id, pan: -30 } },
            ],
            'set Drums to -6 dB and pan Bass 30% left',
            mixContext
        );

        expect(mute.actions).toEqual([
            { type: 'setTrackGain', payload: { trackId: drums.id, gainDb: -6 } },
            { type: 'muteTrack', payload: { trackId: keys.id, muted: true } },
        ]);
        expect(pan.actions).toEqual([
            { type: 'setTrackGain', payload: { trackId: drums.id, gainDb: -6 } },
            { type: 'setTrackPan', payload: { trackId: bass.id, pan: -30 } },
        ]);
    });

    it('still grounds a referenced level phrase beside a coordinated list that grounds its own calls', () => {
        const result = bridge(
            [
                { name: 'setTrackGain', arguments: { trackId: drums.id, deltaDb: 2 } },
                { name: 'setTrackGain', arguments: { trackId: bass.id, deltaDb: -3 } },
                { name: 'setTrackGain', arguments: { trackId: keys.id, deltaDb: -3 } },
            ],
            'Drums up 2 dB, and turn the Bass and the Keys down 3 dB',
            mixContext
        );

        expect(result.actions).toEqual([
            { type: 'setTrackGain', payload: { trackId: drums.id, deltaDb: 2 } },
            { type: 'setTrackGain', payload: { trackId: bass.id, deltaDb: -3 } },
            { type: 'setTrackGain', payload: { trackId: keys.id, deltaDb: -3 } },
        ]);
    });

    it('still grounds a referenced level phrase beside a directional command the batch also plans', () => {
        const result = bridge(
            [
                { name: 'setTrackGain', arguments: { trackId: drums.id, gainDb: -6 } },
                { name: 'bypassDevice', arguments: { deviceId: 'device-comp', bypassed: true } },
            ],
            'set Drums to -6 dB, turn the Comp off',
            mixContext
        );

        expect(result.actions.map((action) => action.type)).toEqual(['setTrackGain', 'bypassDevice']);
    });

    it('does not read a directional clause as a command when the batch plans no directional action', () => {
        const result = bridgeDrums('set Drums to -6 dB, turn the Comp off', { gainDb: -6 });

        expect(result.actions).toEqual([]);
    });
});

describe('the figure and clause shapes a referenced level phrase is read from', () => {
    const drums = createTrack({ id: 'track-drums', name: 'Drums' });
    const drumsContext: ProjectContext = {
        ...projectContext,
        tracks: [drums, master],
        selectedTrackId: null,
    };

    function bridgeDrums(prompt: string, value: Record<string, number>) {
        return bridge([{ name: 'setTrackGain', arguments: { trackId: drums.id, ...value } }], prompt, drumsContext);
    }

    it.each([
        ['set Drums to -1.5 dB', { gainDb: -1.5 }],
        ['Drums up 1.5 dB', { deltaDb: 1.5 }],
        ['set Drums to .5 dB', { gainDb: 0.5 }],
        ['Drums down .5 dB', { deltaDb: -0.5 }],
        ['set Drums to -6 d b', { gainDb: -6 }],
        ['Drums up 2 d b', { deltaDb: 2 }],
        ['   set Drums to -6 dB', { gainDb: -6 }],
        ['\n  Drums up 2 dB', { deltaDb: 2 }],
    ])('grounds "%s" at the figure it states', (prompt, value) => {
        const result = bridgeDrums(prompt, value);

        expect(result.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: drums.id, ...value } }]);
    });

    it.each([
        ['set Drums to -1.5 dB', { gainDb: -1.4 }],
        ['set Drums to .5 dB', { gainDb: 5 }],
        ['set Drums to -6 d b', { gainDb: -66 }],
    ])('refuses "%s" for a figure other than the one it states', (prompt, value) => {
        const result = bridgeDrums(prompt, value);

        expect(result.actions).toEqual([]);
    });

    it.each(['Drums volume is -6 dB', 'Drums gain is -6 dB', 'Drums level is -6 dB'])(
        'does not read "%s", which describes the level, as a fader level',
        (prompt) => {
            const result = bridgeDrums(prompt, { gainDb: -6 });

            expect(result.actions).toEqual([]);
        }
    );
});
