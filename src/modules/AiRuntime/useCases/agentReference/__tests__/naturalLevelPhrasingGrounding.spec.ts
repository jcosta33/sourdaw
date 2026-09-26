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

/** A synth whose output parameter is named "Master", as Levain's is. */
const keysSynth: ProjectTrack['devices'][number] = {
    id: 'device-keys-synth',
    type: 'levain',
    bypassed: false,
    parameters: [{ id: 'masterGain', name: 'Master', type: 'float', value: 0.8, minValue: 0, maxValue: 2, unit: '' }],
};

function withKeysSynth(track: ProjectTrack): ProjectTrack {
    if (track.id !== 'track-keys') {
        return track;
    }
    return { ...track, deviceCount: 1, devices: [keysSynth] };
}

/** The fixture with that synth on the Keys track. */
const projectWithMasterParameter: ProjectContext = {
    ...projectContext,
    tracks: projectContext.tracks.map(withKeysSynth),
};

/** The fixture with a track whose name holds the word master. */
const projectWithMasterNamedTrack: ProjectContext = {
    ...projectContext,
    tracks: [...projectContext.tracks, createTrack({ id: 'track-master-vox', name: 'Master Vox' })],
};

function bridge(calls: ProviderCalls, prompt: string, context: ProjectContext = projectContext) {
    return bridgeGroundedLlmToolCalls({
        calls,
        prompt,
        context,
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

    it('grounds a relative master change turned down before the master is named', () => {
        const result = bridge([{ name: 'setMasterGain', arguments: { deltaDb: -3 } }], 'Turn down the master by 3 dB.');

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([{ type: 'setMasterGain', payload: { deltaDb: -3 } }]);
    });

    it('grounds a relative master change whose verb is split by the master', () => {
        const result = bridge([{ name: 'setMasterGain', arguments: { deltaDb: 2 } }], 'Turn the master up 2 dB.');

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([{ type: 'setMasterGain', payload: { deltaDb: 2 } }]);
    });

    it('grounds an absolute master level brought down with a generic verb', () => {
        const result = bridge(
            [{ name: 'setMasterGain', arguments: { gainDb: -1 } }],
            'Bring the master down to -1 dB.'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([{ type: 'setMasterGain', payload: { gainDb: -1 } }]);
    });

    it('grounds a relative master change asked for as a louder master', () => {
        const result = bridge(
            [{ name: 'setMasterGain', arguments: { deltaDb: 2 } }],
            'Make the master louder by 2 dB.'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([{ type: 'setMasterGain', payload: { deltaDb: 2 } }]);
    });

    it('grounds a master level change while a device parameter is also named Master', () => {
        const result = bridge(
            [{ name: 'setMasterGain', arguments: { deltaDb: -1.5 } }],
            'Turn down the master by 1.5 dB.',
            projectWithMasterParameter
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([{ type: 'setMasterGain', payload: { deltaDb: -1.5 } }]);
    });

    it('grounds the track change of a level list whose continuation names the master', () => {
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'track-kick', deltaDb: -3 } }],
            'Turn the Kick down 3 dB and the Master up 2 dB.'
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: 'track-kick', deltaDb: -3 } }]);
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
        const decibels = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'track-kick', gainDb: -6 } }],
            'Put the Kick at bar 5.'
        );
        // The bar number read as a 5% linear level: only the missing decibel figure stops "put" naming it.
        const barNumberAsLevel = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'track-kick', gain: 0.05 } }],
            'Put the Kick at bar 5.'
        );

        expect(decibels.actions).toEqual([]);
        expect(barNumberAsLevel.actions).toEqual([]);
        expect(barNumberAsLevel.rejections).toMatchObject([
            { name: 'setTrackGain', reason: 'Provider action is not grounded in the user request' },
        ]);
    });

    it('refuses a master level set when the clause states no decibel figure', () => {
        const result = bridge([{ name: 'setMasterGain', arguments: { gainDb: -1 } }], 'Set the master to mono.');

        expect(result.actions).toEqual([]);
    });

    it('refuses a track brought up when the clause states no decibel figure', () => {
        const decibels = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'track-guitar', deltaDb: 2 } }],
            'Bring the Guitar up.'
        );
        // A linear level needs no figure in the prompt: only the missing decibel figure stops "bring up" naming it.
        const linearLevel = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'track-guitar', gain: 0.5 } }],
            'Bring the Guitar up.'
        );

        expect(decibels.actions).toEqual([]);
        expect(linearLevel.actions).toEqual([]);
        expect(linearLevel.rejections).toMatchObject([
            { name: 'setTrackGain', reason: 'Provider action is not grounded in the user request' },
        ]);
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

    it('refuses a track fader change on the master turned down before it is named', () => {
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'master', deltaDb: -3 } }],
            'Turn down the master by 3 dB.'
        );

        expect(result.actions).toEqual([]);
        expect(result.rejections).toMatchObject([
            { name: 'setTrackGain', reason: 'Provider action is not grounded in the user request' },
        ]);
    });

    it('refuses a track fader change on the master carried by a level continuation', () => {
        const result = bridge(
            [
                { name: 'setTrackGain', arguments: { trackId: 'track-kick', deltaDb: -3 } },
                { name: 'setTrackGain', arguments: { trackId: 'master', deltaDb: 2 } },
            ],
            'Turn the Kick down 3 dB and the Master up 2 dB.'
        );

        expect(result.actions).not.toContainEqual({
            type: 'setTrackGain',
            payload: { trackId: 'master', deltaDb: 2 },
        });
        expect(result.rejections).toContainEqual(
            expect.objectContaining({
                index: 1,
                name: 'setTrackGain',
                reason: 'Provider action is not grounded in the user request',
            })
        );
    });

    it('refuses a track fader change on a send carried by a level continuation', () => {
        const result = bridge(
            [
                { name: 'setTrackGain', arguments: { trackId: 'track-kick', deltaDb: -3 } },
                { name: 'setTrackGain', arguments: { trackId: 'track-kick', deltaDb: -2 } },
            ],
            'Turn the Kick down 3 dB and the Kick send down 2 dB.'
        );

        expect(result.actions).not.toContainEqual({
            type: 'setTrackGain',
            payload: { trackId: 'track-kick', deltaDb: -2 },
        });
        expect(result.rejections).toContainEqual(
            expect.objectContaining({
                index: 1,
                name: 'setTrackGain',
                reason: 'Provider action is not grounded in the user request',
            })
        );
    });

    it('refuses a track fader change on the master while a device parameter is also named Master', () => {
        const direct = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'master', deltaDb: -1.5 } }],
            'Lower the master by 1.5 dB.',
            projectWithMasterParameter
        );
        const continuation = bridge(
            [
                { name: 'setTrackGain', arguments: { trackId: 'track-kick', deltaDb: -3 } },
                { name: 'setTrackGain', arguments: { trackId: 'master', deltaDb: 2 } },
            ],
            'Turn the Kick down 3 dB and the Master up 2 dB.',
            projectWithMasterParameter
        );

        expect(direct.actions).toEqual([]);
        expect(direct.rejections).toMatchObject([
            { name: 'setTrackGain', reason: 'Provider action is not grounded in the user request' },
        ]);
        expect(continuation.actions).not.toContainEqual({
            type: 'setTrackGain',
            payload: { trackId: 'master', deltaDb: 2 },
        });
        expect(continuation.rejections).toContainEqual(
            expect.objectContaining({
                index: 1,
                name: 'setTrackGain',
                reason: 'Provider action is not grounded in the user request',
            })
        );
    });

    it('refuses a master level change on a track whose name holds the word master', () => {
        const turnedDown = bridge(
            [{ name: 'setMasterGain', arguments: { deltaDb: -3 } }],
            'Turn down the Master Vox by 3 dB.',
            projectWithMasterNamedTrack
        );
        const lowered = bridge(
            [{ name: 'setMasterGain', arguments: { deltaDb: -3 } }],
            'Lower the Master Vox by 3 dB.',
            projectWithMasterNamedTrack
        );

        expect(turnedDown.actions).toEqual([]);
        expect(lowered.actions).toEqual([]);
        expect(turnedDown.rejections).toMatchObject([
            { name: 'setMasterGain', reason: 'Provider action is not grounded in the user request' },
        ]);
        expect(lowered.rejections).toMatchObject([
            { name: 'setMasterGain', reason: 'Provider action is not grounded in the user request' },
        ]);
    });

    it('refuses a master level change when the clause states no decibel figure', () => {
        const relative = bridge([{ name: 'setMasterGain', arguments: { deltaDb: -3 } }], 'Turn the master down a bit.');
        const absolute = bridge([{ name: 'setMasterGain', arguments: { gainDb: -3 } }], 'Turn the master down a bit.');

        expect(relative.actions).toEqual([]);
        expect(absolute.actions).toEqual([]);
        expect(relative.rejections).toMatchObject([
            { name: 'setMasterGain', reason: 'Provider action is not grounded in the user request' },
        ]);
        expect(absolute.rejections).toMatchObject([
            { name: 'setMasterGain', reason: 'Provider action is not grounded in the user request' },
        ]);
    });

    it('refuses a split verb whose gap holds more than one reference', () => {
        const result = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'track-guitar', deltaDb: -3 } }],
            'Turn the Bass DI and everything else down 3 dB.'
        );

        expect(result.actions).toEqual([]);
    });
});
