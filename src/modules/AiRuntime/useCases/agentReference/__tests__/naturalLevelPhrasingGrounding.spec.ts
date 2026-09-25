import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { bridgeGroundedLlmToolCalls } from '../bridgeGroundedLlmToolCalls';

/**
 * Level and send requests in the words a musician uses for them.
 *
 * A request names its target between the words of the verb ("turn the Bass DI
 * down"), names the object a new bus becomes between the article and the noun
 * ("create a Bass Crush bus"), and leans on a generic verb whose meaning only the
 * decibel figure settles ("put Backing Vocals L at -9 dB"). Each form grounds
 * exactly the call the words ask for; the refusals pin what the same words do not
 * reach: a generic verb with no figure, a gap holding anything but one reference
 * or the proposed name, a send or master clause read as a track fader, and a
 * figure bound to a different target than the one it follows.
 */

type ProjectTrack = ProjectContext['tracks'][number];
type ProviderCalls = Parameters<typeof bridgeGroundedLlmToolCalls>[0]['calls'];

function createTrack({
    id,
    name,
    kind = 'audio',
    sends = [],
}: {
    id: string;
    name: string;
    kind?: ProjectTrack['kind'];
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
        gain: 1,
        pan: 0,
        automationMode: 'read',
        outputId: kind === 'master' ? 'hw_out' : 'master',
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
        sends,
    };
}

const drumBusSend = { busId: 'track-drum-bus', level: 1, preFader: false };

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
    tracks: [
        createTrack({ id: 'track-kick', name: 'Kick', sends: [drumBusSend] }),
        createTrack({ id: 'track-snare', name: 'Snare', sends: [drumBusSend] }),
        createTrack({ id: 'track-bass-di', name: 'Bass DI' }),
        createTrack({ id: 'track-backing-vocal-left', name: 'Backing Vocals L' }),
        createTrack({ id: 'track-backing-vocal-right', name: 'Backing Vocals R' }),
        createTrack({ id: 'track-guitar', name: 'Guitar' }),
        createTrack({ id: 'track-keys', name: 'Keys', kind: 'midi' }),
        createTrack({ id: 'track-drum-bus', name: 'Drum Bus', kind: 'bus' }),
        createTrack({ id: 'master', name: 'Master', kind: 'master' }),
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'mix',
    playheadPosition: 0,
};

function bridge(calls: ProviderCalls, prompt: string) {
    return bridgeGroundedLlmToolCalls({
        calls,
        prompt,
        context: projectContext,
        markerSignatures: [],
        sectionSignatures: [],
    });
}

const createdBusId = expect.stringMatching(/^bus-ai-/u);

describe('natural level phrasing grounds the call its words ask for', () => {
    it('grounds a relative track change whose verb is split by the target', () => {
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'track-bass-di', deltaDb: -3 } }],
            'Turn the Bass DI down 3 dB.'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: 'track-bass-di', deltaDb: -3 } }]);
    });

    it('grounds an absolute master level set with a generic verb and a figure', () => {
        const result = bridge([{ name: 'setMasterGain', arguments: { gainDb: -1 } }], 'Set the master to -1 dB.');

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([{ type: 'setMasterGain', payload: { gainDb: -1 } }]);
    });

    it('grounds an absolute send level whose verb is split by the source', () => {
        const result = bridge(
            [{ name: 'setSend', arguments: { trackId: 'track-kick', busId: 'track-drum-bus', levelDb: -6 } }],
            'Set the Kick send to the Drum Bus to -6 dB.'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([
            {
                type: 'setSend',
                payload: {
                    trackId: 'track-kick',
                    busId: 'track-drum-bus',
                    levelDb: -6,
                    expectedLevel: 1,
                    expectedPreFader: false,
                },
            },
        ]);
    });

    it('grounds a new bus made with a new-bus phrase and a send into it', () => {
        const result = bridge(
            [
                { name: 'createBus', arguments: { name: 'Guitar Room', binding: 'room' } },
                { name: 'addSend', arguments: { trackId: 'track-guitar', busId: '$room', levelDb: -18 } },
            ],
            'Make a new bus named Guitar Room and send the Guitar to it at -18 dB.'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([
            { type: 'createBus', payload: { name: 'Guitar Room' } },
            {
                type: 'addSend',
                payload: { trackId: 'track-guitar', busId: createdBusId, levelDb: -18, expectedAbsent: true },
            },
        ]);
    });

    it('grounds a bus named between the article and the noun and two sends with their own figures', () => {
        const result = bridge(
            [
                { name: 'createBus', arguments: { name: 'Parallel Drums', binding: 'parallel' } },
                { name: 'addSend', arguments: { trackId: 'track-kick', busId: '$parallel', levelDb: -6 } },
                { name: 'addSend', arguments: { trackId: 'track-snare', busId: '$parallel', levelDb: -9 } },
            ],
            'Create a Parallel Drums bus and send the Kick to it at -6 dB and the Snare at -9 dB.'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([
            { type: 'createBus', payload: { name: 'Parallel Drums' } },
            {
                type: 'addSend',
                payload: { trackId: 'track-kick', busId: createdBusId, levelDb: -6, expectedAbsent: true },
            },
            {
                type: 'addSend',
                payload: { trackId: 'track-snare', busId: createdBusId, levelDb: -9, expectedAbsent: true },
            },
        ]);
    });

    it('grounds an upward track change brought up with a generic verb', () => {
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'track-guitar', deltaDb: 2 } }],
            'Bring the Guitar up 2 dB.'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: 'track-guitar', deltaDb: 2 } }]);
    });

    it('grounds an absolute track level put with a generic verb', () => {
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'track-backing-vocal-left', gainDb: -9 } }],
            'Put Backing Vocals L at -9 dB.'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([
            { type: 'setTrackGain', payload: { trackId: 'track-backing-vocal-left', gainDb: -9 } },
        ]);
    });

    it('grounds a relative master change lowered with a generic verb', () => {
        const result = bridge([{ name: 'setMasterGain', arguments: { deltaDb: -1.5 } }], 'Lower the master by 1.5 dB.');

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([{ type: 'setMasterGain', payload: { deltaDb: -1.5 } }]);
    });

    it('grounds a relative send change lowered with a generic verb', () => {
        const result = bridge(
            [{ name: 'setSend', arguments: { trackId: 'track-snare', busId: 'track-drum-bus', deltaDb: -4 } }],
            'Lower the Snare send to the Drum Bus by 4 dB.'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([
            {
                type: 'setSend',
                payload: {
                    trackId: 'track-snare',
                    busId: 'track-drum-bus',
                    deltaDb: -4,
                    expectedLevel: 1,
                    expectedPreFader: false,
                },
            },
        ]);
    });

    it('grounds a send fed into a bus the same request adds', () => {
        const result = bridge(
            [
                { name: 'createBus', arguments: { name: 'Keys Chorus', binding: 'chorus' } },
                { name: 'addSend', arguments: { trackId: 'track-keys', busId: '$chorus', levelDb: -10 } },
            ],
            'Add a bus called Keys Chorus and feed the Keys into it at -10 dB.'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([
            { type: 'createBus', payload: { name: 'Keys Chorus' } },
            {
                type: 'addSend',
                payload: { trackId: 'track-keys', busId: createdBusId, levelDb: -10, expectedAbsent: true },
            },
        ]);
    });

    it('grounds one figure for each source of a coordinated send list into a bus being set up', () => {
        const result = bridge(
            [
                { name: 'createBus', arguments: { name: 'Vocal Delay', binding: 'delay' } },
                {
                    name: 'addSend',
                    arguments: { trackId: 'track-backing-vocal-left', busId: '$delay', levelDb: -15 },
                },
                {
                    name: 'addSend',
                    arguments: { trackId: 'track-backing-vocal-right', busId: '$delay', levelDb: -15 },
                },
            ],
            'Set up a new bus named Vocal Delay with sends from Backing Vocals L and Backing Vocals R at -15 dB.'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([
            { type: 'createBus', payload: { name: 'Vocal Delay' } },
            {
                type: 'addSend',
                payload: {
                    trackId: 'track-backing-vocal-left',
                    busId: createdBusId,
                    levelDb: -15,
                    expectedAbsent: true,
                },
            },
            {
                type: 'addSend',
                payload: {
                    trackId: 'track-backing-vocal-right',
                    busId: createdBusId,
                    levelDb: -15,
                    expectedAbsent: true,
                },
            },
        ]);
    });

    it('grounds a bus whose proposed name sits between the article and the noun', () => {
        const result = bridge(
            [
                { name: 'createBus', arguments: { name: 'Bass Crush', binding: 'crush' } },
                { name: 'addSend', arguments: { trackId: 'track-bass-di', busId: '$crush', levelDb: -8 } },
            ],
            'Create a Bass Crush bus and send the Bass DI to it at -8 dB.'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([
            { type: 'createBus', payload: { name: 'Bass Crush' } },
            {
                type: 'addSend',
                payload: { trackId: 'track-bass-di', busId: createdBusId, levelDb: -8, expectedAbsent: true },
            },
        ]);
    });
});

describe('natural level phrasing refuses what its words do not reach', () => {
    it('refuses a track level change when the split verb is completed by another word', () => {
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'track-bass-di', deltaDb: -3 } }],
            'Turn the Bass DI off.'
        );

        expect(result.actions).toEqual([]);
    });

    it('refuses a level put on a track when the clause states no decibel figure', () => {
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'track-kick', gainDb: -6 } }],
            'Put the Kick at bar 5.'
        );

        expect(result.actions).toEqual([]);
    });

    it('refuses a master level set when the clause states no decibel figure', () => {
        const result = bridge([{ name: 'setMasterGain', arguments: { gainDb: -1 } }], 'Set the master to mono.');

        expect(result.actions).toEqual([]);
    });

    it('refuses a track brought up when the clause states no decibel figure', () => {
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'track-guitar', deltaDb: 2 } }],
            'Bring the Guitar up.'
        );

        expect(result.actions).toEqual([]);
    });

    it('refuses a new bus whose proposed name is not the name between the article and the noun', () => {
        const result = bridge([{ name: 'createBus', arguments: { name: 'Drum Crush' } }], 'Create a Bass Crush bus.');

        expect(result.actions).toEqual([]);
    });

    it('refuses sends whose figures are swapped between the targets they follow', () => {
        const result = bridge(
            [
                { name: 'createBus', arguments: { name: 'Parallel Drums', binding: 'parallel' } },
                { name: 'addSend', arguments: { trackId: 'track-kick', busId: '$parallel', levelDb: -9 } },
                { name: 'addSend', arguments: { trackId: 'track-snare', busId: '$parallel', levelDb: -6 } },
            ],
            'Create a Parallel Drums bus and send the Kick to it at -6 dB and the Snare at -9 dB.'
        );

        expect(result.actions).toEqual([]);
    });

    it('refuses a track fader change on a clause that names a send', () => {
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'track-snare', deltaDb: -4 } }],
            'Lower the Snare send to the Drum Bus by 4 dB.'
        );

        expect(result.actions).toEqual([]);
    });

    it('refuses a track fader level on a clause that names a send', () => {
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'track-kick', gainDb: -6 } }],
            'Set the Kick send to the Drum Bus to -6 dB.'
        );

        expect(result.actions).toEqual([]);
    });

    it('refuses a track fader change on a clause that names the master', () => {
        const kick = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'track-kick', deltaDb: -1.5 } }],
            'Lower the master by 1.5 dB.'
        );
        const masterTrack = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'master', deltaDb: -1.5 } }],
            'Lower the master by 1.5 dB.'
        );

        expect(kick.actions).toEqual([]);
        expect(masterTrack.actions).toEqual([]);
    });

    it('refuses a split verb whose gap holds more than one reference', () => {
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'track-guitar', deltaDb: -3 } }],
            'Turn the Bass DI and everything else down 3 dB.'
        );

        expect(result.actions).toEqual([]);
    });
});
