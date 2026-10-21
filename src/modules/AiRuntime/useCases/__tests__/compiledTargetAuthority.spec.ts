import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../models/ProjectContext';
import { bridgeGroundedLlmToolCalls } from '../agentReference/bridgeGroundedLlmToolCalls';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';

/**
 * A compiled command list proves which objects its selectors resolve to, never that the user asked
 * for them (#5295). A target the request protects or excludes is refused. A target picked by a
 * name, name fragment, owner track or literal id must be picked by something the clause states,
 * and a single such target must be the one the direct route grounds in the clause. Selections by
 * role, kind, device type, condition or no filter ground as the compiler resolves them.
 */

type ProjectTrack = ProjectContext['tracks'][number];
type CompiledItem = {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    selector?: {
        targetArgument: string;
        entity: 'track' | 'device' | 'clip';
        where?: Record<string, string>;
        match?: { all?: Record<string, string>[]; any?: Record<string, string>[] };
        excludeIds?: string[];
        condition?: { field: 'muted'; equals: boolean };
        quantity: { unit: 'targets'; exactly: number };
    };
    dependsOn?: string[];
};

const REVISION = 'revision-compiled-target-authority';

function createTrack({
    id,
    name,
    kind = 'audio',
    devices = [],
    sends = [],
}: {
    id: string;
    name: string;
    kind?: ProjectTrack['kind'];
    devices?: ProjectTrack['devices'];
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
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        outputId: kind === 'master' ? 'hw_out' : 'master',
        clipCount: 0,
        deviceCount: devices.length,
        clips: [],
        devices,
        sends,
    };
}

const vocals = createTrack({
    id: 'track-vocals',
    name: 'Vocals',
    devices: [{ id: 'device-vocals-eq', type: 'builtin-eq', bypassed: false }],
});
const keys = createTrack({
    id: 'track-keys',
    name: 'Keys',
    kind: 'midi',
    devices: [{ id: 'device-keys-eq', type: 'builtin-eq', bypassed: false }],
});
const drumBus = createTrack({ id: 'track-drum-bus', name: 'Drum Bus', kind: 'bus' });
const drums = createTrack({
    id: 'track-drums',
    name: 'Drums',
    sends: [{ busId: drumBus.id, level: 1, preFader: false }],
});
const bass = createTrack({ id: 'track-bass', name: 'Bass' });
const master = createTrack({ id: 'master', name: 'Master', kind: 'master' });
const vocalsEq = vocals.devices[0]!;
const keysEq = keys.devices[0]!;

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
    tracks: [vocals, keys, drums, bass, drumBus, master],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'mix',
    playheadPosition: 0,
    availableDeviceTypes: [{ id: 'builtin-eq', name: 'EQ' }],
};

function trackItem(name: string, track: ProjectTrack, arguments_: Record<string, unknown>): CompiledItem {
    return {
        id: `${name}-${track.id}`,
        name,
        arguments: arguments_,
        selector: {
            targetArgument: 'trackId',
            entity: 'track',
            where: { name: track.name },
            quantity: { unit: 'targets', exactly: 1 },
        },
    };
}

/** Bypasses every device on one track, the selector "every device on <track>" compiles to. */
function bypassTrackDevicesItem(ownerId: string): CompiledItem {
    return {
        id: `bypass-devices-${ownerId}`,
        name: 'bypassDevice',
        arguments: { bypassed: true },
        selector: {
            targetArgument: 'deviceId',
            entity: 'device',
            where: { trackId: ownerId },
            quantity: { unit: 'targets', exactly: 1 },
        },
    };
}

function bypassItem(device: ProjectTrack['devices'][number], ownerId: string): CompiledItem {
    return {
        id: `bypass-${device.id}`,
        name: 'bypassDevice',
        arguments: { bypassed: true },
        selector: {
            targetArgument: 'deviceId',
            entity: 'device',
            where: { trackId: ownerId, type: device.type },
            quantity: { unit: 'targets', exactly: 1 },
        },
    };
}

const createPlateBusItem: CompiledItem = {
    id: 'create-plate-bus',
    name: 'createBus',
    arguments: { name: 'Plate Bus', binding: 'plate-bus' },
};

function compileAndBridge(
    prompt: string,
    items: CompiledItem[],
    targetIds: string[],
    context: ProjectContext = projectContext
) {
    const compiled = compileArbitraryCommandList({
        context,
        revision: REVISION,
        calls: [
            {
                name: 'command.batch.propose',
                arguments: {
                    plan: {
                        semantic: { classification: 'simple', uncertainty: [] },
                        objective: prompt,
                        constraints: [],
                        scope: { targetIds, targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                        capabilityIds: [],
                        assetIds: [],
                        alternatives: [],
                        validationStrategy: [],
                        stoppingConditions: [],
                    },
                    list: { schemaVersion: 1, items },
                },
            },
        ],
    });
    if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
        throw new Error(`Expected the list to compile: ${JSON.stringify(compiled)}`);
    }
    const { compilerEvidence } = compiled;
    return bridgeGroundedLlmToolCalls({
        calls: compilerEvidence.commands,
        compilerEvidence,
        context,
        projectRevision: REVISION,
        prompt,
    });
}

function targetsOf(result: ReturnType<typeof compileAndBridge>, argument = 'trackId') {
    return result.actions.map((action) => (action.payload as Record<string, unknown>)[argument]);
}

function expectRefused(result: ReturnType<typeof compileAndBridge>, targetId: string, argument = 'trackId') {
    expect(targetsOf(result, argument)).not.toContain(targetId);
    expect(result.rejections).not.toEqual([]);
}

const SEND_DUCK_PROMPT = 'Duck the Drums send to the Drum Bus to -12 dB over bars 5 to 8.';

function sendDuckItem(track: ProjectTrack, busId: string): CompiledItem {
    return trackItem('automateParameterRange', track, {
        parameterId: `send:${busId}`,
        range: { startBar: 5, endBar: 8 },
        valueDb: -12,
    });
}

describe('a send destination the request names is not a competing track target', () => {
    it('grounds the sending track when the request also names the bus it sends to', () => {
        const result = compileAndBridge(SEND_DUCK_PROMPT, [sendDuckItem(drums, drumBus.id)], [drums.id, drumBus.id]);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([drums.id]);
    });

    it('refuses the bus swapped in as the sending track', () => {
        const result = compileAndBridge(SEND_DUCK_PROMPT, [sendDuckItem(drumBus, drums.id)], [drums.id, drumBus.id]);

        expectRefused(result, drumBus.id);
        expect(result.actions).toEqual([]);
        // Drum Bus does not send to Drums, so Drums is not set aside as a send destination and the
        // clause still names both tracks; setting Drums aside would leave Drum Bus the unique
        // reference and pass the swap on to the send check instead.
        expect(result.rejections).toEqual([
            {
                index: 0,
                name: 'automateParameterRange',
                reason: 'Compiled target trackId is not authorized by the user request',
            },
        ]);
    });

    it('sets no bus aside for a track that does not send to it, leaving both named tracks in the clause', () => {
        // Drum Bus does not send to itself, so the clause still names both tracks and the compiled
        // sender is refused as one of a named set the batch does not cover; setting the bus aside
        // regardless would leave Drums the unique reference and refuse it as a mismatch instead.
        const result = compileAndBridge(SEND_DUCK_PROMPT, [sendDuckItem(drumBus, drumBus.id)], [drumBus.id]);

        expect(result.actions).toEqual([]);
        expect(result.rejections).toEqual([
            {
                index: 0,
                name: 'automateParameterRange',
                reason: 'Compiled target trackId is not authorized by the user request',
            },
        ]);
    });

    it('refuses a sending track the request does not name', () => {
        const result = compileAndBridge(
            'Duck the Vocals send to the Drum Bus to -12 dB over bars 5 to 8.',
            [sendDuckItem(drums, drumBus.id)],
            [drums.id, drumBus.id]
        );

        expectRefused(result, drums.id);
        expect(result.actions).toEqual([]);
    });
});

describe('a compiled selector cannot replace a target the request names', () => {
    it('refuses a gain selector for a track the request does not name', () => {
        const result = compileAndBridge(
            'set Vocals volume to 75%',
            [trackItem('setTrackGain', keys, { gain: 0.75 })],
            [keys.id]
        );

        expectRefused(result, keys.id);
        expect(result.actions).toEqual([]);
        // The selector picks Keys by a name the request never states.
        expect(result.rejections).toContainEqual({
            index: 0,
            name: 'setTrackGain',
            reason: 'Compiled target trackId is not authorized by the user request',
        });
    });

    it('refuses a name the clause states only inside the name of the track it grounds', () => {
        const bassDiTrack = createTrack({ id: 'track-bass-di', name: 'Bass DI' });
        const result = compileAndBridge(
            'set Bass DI volume to 50%',
            [trackItem('setTrackGain', bass, { gain: 0.5 })],
            [bass.id],
            { ...projectContext, tracks: [...projectContext.tracks, bassDiTrack] }
        );

        // "Bass" is stated, but the direct route reads the clause as naming Bass DI.
        expect(result.actions).toEqual([]);
        expect(result.rejections).toContainEqual({
            index: 0,
            name: 'setTrackGain',
            reason: 'Provider target trackId does not match the uniquely grounded project reference',
        });
    });

    it('refuses a gain selector for an unnamed track in the coordinated request', () => {
        const result = compileAndBridge(
            'set Vocals volume to 75% and set Drums and Bass volume to 50%',
            [
                trackItem('setTrackGain', keys, { gain: 0.75 }),
                trackItem('setTrackGain', drums, { gain: 0.5 }),
                trackItem('setTrackGain', bass, { gain: 0.5 }),
            ],
            [keys.id, drums.id, bass.id]
        );

        expectRefused(result, keys.id);
    });

    it('refuses an extra gain selector beside a compiled coordinated list', () => {
        const result = compileAndBridge(
            'turn Vocals up 1 dB and turn the Drums and the Bass down 3 dB',
            [
                trackItem('setTrackGain', vocals, { deltaDb: 1 }),
                trackItem('setTrackGain', keys, { deltaDb: 1 }),
                trackItem('setTrackGain', drums, { deltaDb: -3 }),
                trackItem('setTrackGain', bass, { deltaDb: -3 }),
            ],
            [vocals.id, keys.id, drums.id, bass.id]
        );

        expectRefused(result, keys.id);
    });

    it('refuses a gain selector replacing the single named track beside a compiled coordinated list', () => {
        const result = compileAndBridge(
            'turn Vocals up 1 dB and turn the Drums and the Bass down 3 dB',
            [
                trackItem('setTrackGain', keys, { deltaDb: 1 }),
                trackItem('setTrackGain', drums, { deltaDb: -3 }),
                trackItem('setTrackGain', bass, { deltaDb: -3 }),
            ],
            [keys.id, drums.id, bass.id]
        );

        expectRefused(result, keys.id);
    });

    it('refuses a pan selector for a track the request does not name', () => {
        const result = compileAndBridge(
            'pan Vocals 20% left',
            [trackItem('setTrackPan', keys, { pan: -20 })],
            [keys.id]
        );

        expectRefused(result, keys.id);
        expect(result.actions).toEqual([]);
    });

    it('refuses a selector for a track the request names only to protect it', () => {
        const result = compileAndBridge(
            'set Vocals volume to 75% but leave Keys alone',
            [trackItem('setTrackGain', keys, { gain: 0.75 })],
            [keys.id]
        );

        expectRefused(result, keys.id);
        expect(result.actions).toEqual([]);
    });

    it('refuses a device selector for a device on a track the request does not name', () => {
        const result = compileAndBridge('bypass the EQ on Vocals', [bypassItem(keysEq, keys.id)], [keysEq.id]);

        expectRefused(result, keysEq.id, 'deviceId');
        expect(result.actions).toEqual([]);
    });

    it('refuses a device selector off the track that owns the devices the request selects', () => {
        const result = compileAndBridge(
            'bypass every device on Vocals',
            [bypassTrackDevicesItem(keys.id)],
            [keysEq.id]
        );

        expectRefused(result, keysEq.id, 'deviceId');
        expect(result.actions).toEqual([]);
    });
});

function audioTrackGroupItem(): CompiledItem {
    return {
        id: 'group-audio-tracks',
        name: 'createVcaGroup',
        arguments: { name: 'Rhythm' },
        selector: {
            targetArgument: 'trackIds',
            entity: 'track',
            where: { kind: 'audio' },
            quantity: { unit: 'targets', exactly: 3 },
        },
    };
}

describe('a compiled set selector cannot widen the tracks the request names', () => {
    it('refuses a set selector reaching by name a track the request does not name', () => {
        const result = compileAndBridge(
            'create VCA group for Vocals and Drums named Rhythm',
            [
                {
                    id: 'group-named-tracks',
                    name: 'createVcaGroup',
                    arguments: { name: 'Rhythm' },
                    selector: {
                        targetArgument: 'trackIds',
                        entity: 'track',
                        match: {
                            any: [{ nameIncludes: 'Vocals' }, { nameIncludes: 'Drums' }, { nameIncludes: 'Bass' }],
                        },
                        quantity: { unit: 'targets', exactly: 3 },
                    },
                },
            ],
            [vocals.id, drums.id, bass.id]
        );

        expect(result.actions).toEqual([]);
        expect(result.rejections).not.toEqual([]);
    });

    it('grounds a set selector resolving exactly the tracks the request names', () => {
        const result = compileAndBridge(
            'create VCA group for Vocals, Drums and Bass named Rhythm',
            [audioTrackGroupItem()],
            [vocals.id, drums.id, bass.id]
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([
            { type: 'createVcaGroup', payload: { name: 'Rhythm', trackIds: [vocals.id, drums.id, bass.id] } },
        ]);
    });
});

describe('a compiled selector cannot stand in for an object the same batch creates', () => {
    it('refuses an existing track selected where the request names only a track the batch creates', () => {
        const result = compileAndBridge(
            'Create a Plate Bus and set the Plate Bus volume to 50%',
            [createPlateBusItem, trackItem('setTrackGain', keys, { gain: 0.5 })],
            [keys.id]
        );

        expectRefused(result, keys.id);
    });

    it('grounds a selection sent to a bus the batch creates and the clause names', () => {
        const result = compileAndBridge(
            'Create a Plate Bus and send every audio track to the Plate Bus at -6 dB',
            [
                createPlateBusItem,
                {
                    id: 'send-audio-tracks',
                    name: 'addSend',
                    arguments: { busId: '$plate-bus', levelDb: -6 },
                    selector: {
                        targetArgument: 'trackId',
                        entity: 'track',
                        where: { kind: 'audio' },
                        quantity: { unit: 'targets', exactly: 3 },
                    },
                    dependsOn: [createPlateBusItem.id],
                },
            ],
            [vocals.id, drums.id, bass.id]
        );

        expect(result.rejections).toEqual([]);
        expect(
            result.actions
                .filter((action) => action.type === 'addSend')
                .map((action) => (action.payload as Record<string, unknown>).trackId)
        ).toEqual([vocals.id, drums.id, bass.id]);
    });

    it('grounds an existing track the request names beside a track the batch creates', () => {
        const result = compileAndBridge(
            'Create a Plate Bus, set its gain, then remove the Keys track.',
            [
                createPlateBusItem,
                {
                    id: 'gain-plate-bus',
                    name: 'setTrackGain',
                    arguments: { trackId: '$plate-bus', gain: 0.8 },
                    dependsOn: [createPlateBusItem.id],
                },
                trackItem('removeTrack', keys, {}),
            ],
            [keys.id]
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions.map((action) => action.type)).toEqual(['createBus', 'setTrackGain', 'removeTrack']);
        expect(result.actions[2]?.payload).toEqual({ trackId: keys.id });
    });
});

describe('a compiled selector the request authorizes still grounds', () => {
    it('grounds a gain selector for the named track', () => {
        const result = compileAndBridge(
            'set Vocals volume to 75%',
            [trackItem('setTrackGain', vocals, { gain: 0.75 })],
            [vocals.id]
        );

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([vocals.id]);
    });

    it('grounds a pan selector for the named track', () => {
        const result = compileAndBridge(
            'pan Vocals 20% left',
            [trackItem('setTrackPan', vocals, { pan: -20 })],
            [vocals.id]
        );

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([vocals.id]);
    });

    it('grounds a device selector for the named device on the named track', () => {
        const result = compileAndBridge('bypass the EQ on Vocals', [bypassItem(vocalsEq, vocals.id)], [vocalsEq.id]);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result, 'deviceId')).toEqual([vocalsEq.id]);
    });

    it('grounds a device selector on the track that owns the devices the request selects', () => {
        const result = compileAndBridge(
            'bypass every device on Vocals',
            [bypassTrackDevicesItem(vocals.id)],
            [vocalsEq.id]
        );

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result, 'deviceId')).toEqual([vocalsEq.id]);
    });

    it('grounds a compiled coordinated list beside a single named track', () => {
        const result = compileAndBridge(
            'turn Vocals up 1 dB and turn the Drums and the Bass down 3 dB',
            [
                trackItem('setTrackGain', vocals, { deltaDb: 1 }),
                trackItem('setTrackGain', drums, { deltaDb: -3 }),
                trackItem('setTrackGain', bass, { deltaDb: -3 }),
            ],
            [vocals.id, drums.id, bass.id]
        );

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([vocals.id, drums.id, bass.id]);
    });

    it('grounds a bounded selector over every audio track', () => {
        const result = compileAndBridge(
            'mute all audio tracks',
            [
                {
                    id: 'all-audio-tracks',
                    name: 'muteTrack',
                    arguments: { muted: true },
                    selector: {
                        targetArgument: 'trackId',
                        entity: 'track',
                        where: { kind: 'audio' },
                        quantity: { unit: 'targets', exactly: 3 },
                    },
                },
            ],
            [vocals.id, drums.id, bass.id]
        );

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([vocals.id, drums.id, bass.id]);
    });
});

const UNAUTHORIZED_TRACK = 'Compiled target trackId is not authorized by the user request';

const mixVocals = createTrack({
    id: 'track-mix-vocals',
    name: 'Vocals',
    devices: [
        { id: 'device-mix-vocals-eq', type: 'builtin-eq', bypassed: false },
        { id: 'device-mix-vocals-compressor', type: 'builtin-compressor', bypassed: false },
    ],
});
const mixKeys = createTrack({
    id: 'track-mix-keys',
    name: 'Keys',
    kind: 'midi',
    devices: [{ id: 'device-mix-keys-eq', type: 'builtin-eq', bypassed: false }],
});
const mixDrums = createTrack({ id: 'track-mix-drums', name: 'Drums' });
const mixBass = createTrack({ id: 'track-mix-bass', name: 'Bass' });
const mixGuitar = createTrack({ id: 'track-mix-guitar', name: 'Guitar' });
const mixReverbBus = createTrack({ id: 'track-mix-reverb-bus', name: 'Reverb Bus', kind: 'bus' });
const mixDrumBus = createTrack({ id: 'track-mix-drum-bus', name: 'Drum Bus', kind: 'bus' });
const mixVocalsEq = mixVocals.devices[0]!;
const mixVocalsCompressor = mixVocals.devices[1]!;
const mixKeysEq = mixKeys.devices[0]!;

const mixContext: ProjectContext = {
    ...projectContext,
    tracks: [mixVocals, mixKeys, mixDrums, mixBass, mixGuitar, mixReverbBus, mixDrumBus, master],
    availableDeviceTypes: [
        { id: 'builtin-eq', name: 'EQ' },
        { id: 'builtin-compressor', name: 'Compressor' },
    ],
};

function compileMix(prompt: string, items: CompiledItem[]) {
    return compileAndBridge(prompt, items, [], mixContext);
}

function addDeviceItem(track: ProjectTrack, deviceType: string): CompiledItem {
    return trackItem('addDevice', track, { deviceType });
}

function everyAudioTrackExceptVocals(name: string, arguments_: Record<string, unknown>): CompiledItem {
    return {
        id: `${name}-audio-tracks`,
        name,
        arguments: arguments_,
        selector: {
            targetArgument: 'trackId',
            entity: 'track',
            where: { kind: 'audio' },
            excludeIds: [mixVocals.id],
            quantity: { unit: 'targets', exactly: 3 },
        },
    };
}

describe('a selection never reaches a track the request excepts', () => {
    it('refuses the excepted track a kind selection reaches', () => {
        const result = compileMix('add an EQ to every audio track except Vocals', [
            roleItem(
                'addDevice',
                { deviceType: 'builtin-eq' },
                { targetArgument: 'trackId', entity: 'track', where: { kind: 'audio' } },
                4
            ),
        ]);

        expect(targetsOf(result)).toEqual([mixDrums.id, mixBass.id, mixGuitar.id]);
        expect(result.rejections).toEqual([
            { index: 0, name: 'addDevice', reason: 'Compiled target trackId is not authorized by the user request' },
        ]);
    });
});

describe('a name stated only inside a protection picks no target', () => {
    it('refuses a set member picked by a name the request states only inside a track it protects', () => {
        const bassDiTrack = createTrack({ id: 'track-bass-di', name: 'Bass DI' });
        const result = compileAndBridge(
            'create VCA group named Low but leave Bass DI alone',
            [
                {
                    id: 'group-bass',
                    name: 'createVcaGroup',
                    arguments: { name: 'Low' },
                    selector: {
                        targetArgument: 'trackIds',
                        entity: 'track',
                        where: { name: 'Bass' },
                        quantity: { unit: 'targets', exactly: 1 },
                    },
                },
            ],
            [],
            { ...projectContext, tracks: [vocals, keys, drums, bass, bassDiTrack, master] }
        );

        expect(result.actions).toEqual([]);
        expect(result.rejections).not.toEqual([]);
    });

    it('refuses a track picked by a name the request states only in the clip it protects', () => {
        const bassWithVerse: ProjectTrack = {
            ...bass,
            clipCount: 1,
            clips: [
                { id: 'clip-bass-verse', name: 'Bass Verse', type: 'audio', startBeat: 0, endBeat: 8, noteCount: 0 },
            ],
        };
        const result = compileAndBridge(
            'set the volume to 75% but leave Bass Verse alone',
            [trackItem('setTrackGain', bass, { gain: 0.75 })],
            [bass.id],
            { ...projectContext, tracks: [vocals, keys, drums, bassWithVerse, master] }
        );

        expect(result.actions).toEqual([]);
        expect(result.rejections).toContainEqual({
            index: 0,
            name: 'setTrackGain',
            reason: 'Compiled target trackId is not authorized by the user request',
        });
    });
});

describe('a compiled selector cannot take authority the request does not give', () => {
    it.each(['set Vocalz volume to 75%', 'set Vocal volume to 75%'])(
        'refuses a selector where "%s" only approximates a track name',
        (prompt) => {
            const result = compileMix(prompt, [trackItem('setTrackGain', mixKeys, { gain: 0.75 })]);

            expect(result.actions).toEqual([]);
            expect(result.rejections).toContainEqual({ index: 0, name: 'setTrackGain', reason: UNAUTHORIZED_TRACK });
        }
    );

    it('refuses a selection member the request protects', () => {
        const result = compileMix('set the volume of the audio tracks to 75% but leave Keys alone', [
            trackItem('setTrackGain', mixKeys, { gain: 0.75 }),
        ]);

        expect(result.actions).toEqual([]);
        expect(result.rejections).toContainEqual({ index: 0, name: 'setTrackGain', reason: UNAUTHORIZED_TRACK });
    });

    it('refuses a selection member that meets the selection but the request protects', () => {
        const result = compileMix('set the volume of the audio tracks to 75% but leave Guitar alone', [
            trackItem('setTrackGain', mixGuitar, { gain: 0.75 }),
        ]);

        expect(result.actions).toEqual([]);
        expect(result.rejections).toContainEqual({ index: 0, name: 'setTrackGain', reason: UNAUTHORIZED_TRACK });
    });

    it('refuses a device on a track the request protects', () => {
        const result = compileMix('bypass the EQs but leave Keys alone', [bypassItem(mixKeysEq, mixKeys.id)]);

        expect(result.actions).toEqual([]);
        expect(result.rejections).toContainEqual({
            index: 0,
            name: 'bypassDevice',
            reason: 'Compiled target deviceId is not authorized by the user request',
        });
    });

    it('refuses a selector for a request that names and selects no track', () => {
        const result = compileMix('set volume to 75%', [trackItem('setTrackGain', mixKeys, { gain: 0.75 })]);

        expect(result.actions).toEqual([]);
        expect(result.rejections).toContainEqual({ index: 0, name: 'setTrackGain', reason: UNAUTHORIZED_TRACK });
    });
});

describe('compiled selectors for objects the request names or selects still ground', () => {
    it('grounds one selector resolving both named tracks', () => {
        const result = compileMix('add a compressor to Vocals and Bass', [
            {
                id: 'compress-vocals-and-bass',
                name: 'addDevice',
                arguments: { deviceType: 'builtin-compressor' },
                selector: {
                    targetArgument: 'trackId',
                    entity: 'track',
                    match: { any: [{ nameIncludes: 'Vocals' }, { nameIncludes: 'Bass' }] },
                    quantity: { unit: 'targets', exactly: 2 },
                },
            },
        ]);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([mixVocals.id, mixBass.id]);
    });

    it('grounds one selector per named track', () => {
        const result = compileMix('add a compressor to Vocals and Bass', [
            addDeviceItem(mixVocals, 'builtin-compressor'),
            addDeviceItem(mixBass, 'builtin-compressor'),
        ]);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([mixVocals.id, mixBass.id]);
    });

    it('grounds a selector for each of three named tracks', () => {
        const result = compileMix('add an EQ to Drums, Bass and Guitar', [
            addDeviceItem(mixDrums, 'builtin-eq'),
            addDeviceItem(mixBass, 'builtin-eq'),
            addDeviceItem(mixGuitar, 'builtin-eq'),
        ]);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([mixDrums.id, mixBass.id, mixGuitar.id]);
    });

    it('grounds sources beside the destinations the request routes them to', () => {
        const result = compileMix('route Vocals to the Reverb Bus and Keys to the Drum Bus', [
            trackItem('setTrackOutput', mixVocals, { outputId: mixReverbBus.id }),
            trackItem('setTrackOutput', mixKeys, { outputId: mixDrumBus.id }),
        ]);

        expect(result.rejections).toEqual([]);
        expect(result.actions.map((action) => action.payload)).toEqual([
            expect.objectContaining({ trackId: mixVocals.id, outputId: mixReverbBus.id }),
            expect.objectContaining({ trackId: mixKeys.id, outputId: mixDrumBus.id }),
        ]);
    });

    it('grounds both named devices on one named track', () => {
        const result = compileMix('bypass the EQ and the compressor on Vocals', [
            bypassItem(mixVocalsEq, mixVocals.id),
            bypassItem(mixVocalsCompressor, mixVocals.id),
        ]);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result, 'deviceId')).toEqual([mixVocalsEq.id, mixVocalsCompressor.id]);
    });

    it('grounds a named device on each of two named tracks', () => {
        const result = compileMix('bypass the EQ on Vocals and the EQ on Keys', [
            bypassItem(mixVocalsEq, mixVocals.id),
            bypassItem(mixKeysEq, mixKeys.id),
        ]);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result, 'deviceId')).toEqual([mixVocalsEq.id, mixKeysEq.id]);
    });

    it('grounds a bounded selection less the track it excepts', () => {
        const result = compileMix('add an EQ to every audio track except Vocals', [
            everyAudioTrackExceptVocals('addDevice', { deviceType: 'builtin-eq' }),
        ]);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([mixDrums.id, mixBass.id, mixGuitar.id]);
    });

    it('grounds a bounded selection less the track it names as other than the selection', () => {
        const result = compileMix('lower every audio track other than Vocals by 3 dB', [
            everyAudioTrackExceptVocals('setTrackGain', { deltaDb: -3 }),
        ]);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([mixDrums.id, mixBass.id, mixGuitar.id]);
    });
});

const renameTrack: ProjectTrack = {
    ...createTrack({ id: 'track-rename-bass', name: 'Bass' }),
    clipCount: 2,
    clips: [
        { id: 'clip-rename-verse', name: 'Bass Verse', type: 'audio', startBeat: 0, endBeat: 8, noteCount: 0 },
        { id: 'clip-rename-lead', name: 'Lead', type: 'audio', startBeat: 8, endBeat: 16, noteCount: 0 },
    ],
};
const renameContext: ProjectContext = {
    ...projectContext,
    tracks: [renameTrack, master],
    selectedTrackId: renameTrack.id,
    selectedClipId: 'clip-rename-verse',
    selectedClipIds: ['clip-rename-verse'],
};

function renameClip(prompt: string, clipName: string) {
    return compileAndBridge(
        prompt,
        [
            {
                id: 'rename-clip',
                name: 'renameClip',
                arguments: { name: 'Bridge Solo' },
                selector: {
                    targetArgument: 'clipId',
                    entity: 'clip',
                    where: { name: clipName },
                    quantity: { unit: 'targets', exactly: 1 },
                },
            },
        ],
        [],
        renameContext
    );
}

describe('a compiled clip rename answers to the request that names its source', () => {
    it('grounds the named source clip when a protected clip name contains the track name', () => {
        const result = renameClip('rename Lead to Bridge Solo; leave Bass Verse unchanged', 'Lead');

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([
            { type: 'renameClip', payload: { clipId: 'clip-rename-lead', name: 'Bridge Solo' } },
        ]);
    });

    it('grounds the selected clip a request renames without naming it', () => {
        const result = renameClip('rename clip to Bridge Solo', 'Bass Verse');

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([
            { type: 'renameClip', payload: { clipId: 'clip-rename-verse', name: 'Bridge Solo' } },
        ]);
    });

    it('refuses a selector for a clip the request does not rename', () => {
        const result = renameClip('rename Lead to Bridge Solo', 'Bass Verse');

        expect(result.actions).toEqual([]);
        expect(result.rejections).not.toEqual([]);
    });

    it('refuses a selector for the clip the request protects', () => {
        const result = renameClip('rename Lead to Bridge Solo; leave Lead unchanged', 'Lead');

        expect(result.actions).toEqual([]);
        expect(result.rejections).not.toEqual([]);
    });
});

function roleTrack(
    id: string,
    name: string,
    role: string,
    devices: ProjectTrack['devices'] = [],
    kind: ProjectTrack['kind'] = 'audio'
): ProjectTrack {
    return {
        ...createTrack({ id, name, kind, devices }),
        canonicalRole: { role, source: 'authored', evidence: 'authored-role' },
    };
}

const leadVox = roleTrack('track-role-lead-vox', 'Lead Vox', 'lead vocal', [
    { id: 'device-lead-vox-compressor', type: 'builtin-compressor', bypassed: false },
    { id: 'device-lead-vox-reverb', type: 'builtin-reverb', bypassed: false },
]);
const backingVoxOne = roleTrack('track-role-bv-1', 'BV 1', 'backing vocal', [
    { id: 'device-bv-1-compressor', type: 'builtin-compressor', bypassed: false },
    { id: 'device-bv-1-reverb', type: 'builtin-reverb', bypassed: false },
]);
const backingVoxTwo = roleTrack('track-role-bv-2', 'BV 2', 'backing vocal');
const kickIn = roleTrack('track-role-kick-in', 'Kick In', 'kick');
const snareTop = roleTrack('track-role-snare-top', 'Snare Top', 'snare');
const bassDi = roleTrack('track-role-bass-di', 'Bass DI', 'bass');
const gtrLeft = roleTrack('track-role-gtr-l', 'Gtr L', 'guitar');
const gtrRight = roleTrack('track-role-gtr-r', 'Gtr R', 'guitar');
const auxVerb = roleTrack(
    'track-role-aux-verb',
    'Aux Verb',
    'bus',
    [{ id: 'device-aux-verb-reverb', type: 'builtin-reverb', bypassed: false }],
    'bus'
);
const auxDelay = roleTrack('track-role-aux-delay', 'Aux Delay', 'bus', [], 'bus');
const moogLead = roleTrack('track-role-moog-lead', 'Moog Lead', 'synth');
const rhodes = roleTrack('track-role-rhodes', 'Rhodes', 'keys');

const roleContext: ProjectContext = {
    ...projectContext,
    tracks: [
        leadVox,
        backingVoxOne,
        backingVoxTwo,
        kickIn,
        snareTop,
        bassDi,
        gtrLeft,
        gtrRight,
        auxVerb,
        auxDelay,
        moogLead,
        rhodes,
        master,
    ],
    availableDeviceTypes: [
        { id: 'builtin-compressor', name: 'Compressor' },
        { id: 'builtin-reverb', name: 'Reverb' },
    ],
};

function roleItem(
    name: string,
    arguments_: Record<string, unknown>,
    selector: Omit<NonNullable<CompiledItem['selector']>, 'quantity'>,
    exactly: number
): CompiledItem {
    return {
        id: `${name}-role-selection`,
        name,
        arguments: arguments_,
        selector: { ...selector, quantity: { unit: 'targets', exactly } },
    };
}

function turnDown(match: Record<string, string>, exactly: number): CompiledItem {
    return roleItem(
        'setTrackGain',
        { deltaDb: -3 },
        { targetArgument: 'trackId', entity: 'track', match: { all: [match] } },
        exactly
    );
}

describe('role, kind and device-type selections ground as the compiler resolves them', () => {
    it.each([
        ['turn down the lead vocal by 3 dB', { role: 'lead vocal' }, [leadVox.id]],
        ['turn down the kick by 3 dB', { role: 'kick' }, [kickIn.id]],
        ['turn down the bass by 3 dB', { roleFamily: 'bass' }, [bassDi.id]],
        ['turn down both guitars by 3 dB', { roleFamily: 'guitar' }, [gtrLeft.id, gtrRight.id]],
        ['turn down all guitars by 3 dB', { roleFamily: 'guitar' }, [gtrLeft.id, gtrRight.id]],
        ['turn down the guitars by 3 dB', { roleFamily: 'guitar' }, [gtrLeft.id, gtrRight.id]],
        ['turn down the vocals by 3 dB', { roleFamily: 'vocal' }, [leadVox.id, backingVoxOne.id, backingVoxTwo.id]],
        ['turn down the drums by 3 dB', { roleFamily: 'drums' }, [kickIn.id, snareTop.id]],
        [
            'turn down the three vocal tracks by 3 dB',
            { roleFamily: 'vocal' },
            [leadVox.id, backingVoxOne.id, backingVoxTwo.id],
        ],
    ])('grounds "%s"', (prompt, match, expected) => {
        const result = compileAndBridge(prompt, [turnDown(match, expected.length)], [], roleContext);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual(expected);
    });

    it('grounds every bus a request for all aux tracks selects', () => {
        const result = compileAndBridge(
            'mute all aux tracks',
            [
                roleItem(
                    'muteTrack',
                    { muted: true },
                    { targetArgument: 'trackId', entity: 'track', where: { kind: 'bus' } },
                    2
                ),
            ],
            [],
            roleContext
        );

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([auxVerb.id, auxDelay.id]);
    });

    it('grounds every compressor a request for all the compressors selects', () => {
        const result = compileAndBridge(
            'bypass all the compressors',
            [
                roleItem(
                    'bypassDevice',
                    { bypassed: true },
                    { targetArgument: 'deviceId', entity: 'device', where: { type: 'builtin-compressor' } },
                    2
                ),
            ],
            [],
            roleContext
        );

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result, 'deviceId')).toEqual(['device-lead-vox-compressor', 'device-bv-1-compressor']);
    });

    it('grounds the reverbs a request selects on the vocal tracks', () => {
        const result = compileAndBridge(
            'bypass the reverbs on the vocals',
            [
                roleItem(
                    'bypassDevice',
                    { bypassed: true },
                    {
                        targetArgument: 'deviceId',
                        entity: 'device',
                        where: { type: 'builtin-reverb' },
                        match: { all: [{ roleFamily: 'vocal' }] },
                    },
                    2
                ),
            ],
            [],
            roleContext
        );

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result, 'deviceId')).toEqual(['device-lead-vox-reverb', 'device-bv-1-reverb']);
    });
});

describe('a compiled selector cannot outlast a negation the direct route reads', () => {
    it.each([
        "set Vocals volume to 75% but don't touch Keys",
        'set Vocals volume to 75% without touching Keys',
        'set Vocals volume to 75%, skip Keys',
    ])('refuses a Keys selector for "%s"', (prompt) => {
        const result = compileMix(prompt, [trackItem('setTrackGain', mixKeys, { gain: 0.75 })]);
        const direct = bridgeGroundedLlmToolCalls({
            calls: [{ name: 'setTrackGain', arguments: { trackId: mixKeys.id, gain: 0.75 } }],
            context: mixContext,
            prompt,
        });

        expect(direct.actions).toEqual([]);
        expect(result.actions).toEqual([]);
        expect(result.rejections).not.toEqual([]);
    });
});

const renameKick = createTrack({ id: 'track-rename-kick', name: 'Kick' });
const renameSnare = createTrack({ id: 'track-rename-snare', name: 'Snare' });
const renameMoog = createTrack({ id: 'track-rename-moog', name: 'Moog', kind: 'midi' });
const renameBass = createTrack({ id: 'track-rename-bass', name: 'Bass' });
const trackRenameContext: ProjectContext = {
    ...projectContext,
    tracks: [renameKick, renameSnare, renameMoog, renameBass, master],
};

describe('a compiled rename reads its target apart from the name it writes', () => {
    it.each([
        ['Rename Kick to Bass Drum', renameKick, 'Bass Drum'],
        ['Rename Snare to Kick Snare', renameSnare, 'Kick Snare'],
        ['Rename Moog to Bass Synth', renameMoog, 'Bass Synth'],
        ['Rename Kick to Kick In', renameKick, 'Kick In'],
    ])('grounds "%s"', (prompt, track, name) => {
        const result = compileAndBridge(prompt, [trackItem('renameTrack', track, { name })], [], trackRenameContext);

        expect(result.rejections).toEqual([]);
        expect(result.actions).toEqual([{ type: 'renameTrack', payload: { trackId: track.id, name } }]);
    });
});

describe('role-family selections worded in the singular or by another name ground as on main', () => {
    it.each([
        ['turn down the drum tracks by 3 dB', { roleFamily: 'drums' }, [kickIn.id, snareTop.id]],
        ['turn down the drum kit by 3 dB', { roleFamily: 'drums' }, [kickIn.id, snareTop.id]],
    ])('grounds "%s"', (prompt, match, expected) => {
        const result = compileAndBridge(prompt, [turnDown(match, expected.length)], [], roleContext);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual(expected);
    });

    it.each([
        ['turn down the vox by 3 dB', { roleFamily: 'vocal' }, [leadVox.id, backingVoxOne.id, backingVoxTwo.id]],
        ['turn down the synths by 3 dB', { roleFamily: 'keys' }, [moogLead.id, rhodes.id]],
        ['turn down the keyboards by 3 dB', { roleFamily: 'keys' }, [moogLead.id, rhodes.id]],
    ])('grounds "%s" as the role-family selection the compiler resolved', (prompt, match, expected) => {
        const result = compileAndBridge(prompt, [turnDown(match, expected.length)], [], roleContext);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual(expected);
    });
});

const mutedDrums = { ...drums, muted: true };
const mutedBass = { ...bass, muted: true };
const mutedContext: ProjectContext = {
    ...projectContext,
    tracks: [vocals, keys, mutedDrums, mutedBass, master],
};
const unmasteredContext: ProjectContext = { ...projectContext, tracks: [vocals, keys, drums, bass] };

function everyObjectItem(name: string, arguments_: Record<string, unknown>, entity: 'track' | 'device', count: number) {
    return roleItem(name, arguments_, { targetArgument: entity === 'track' ? 'trackId' : 'deviceId', entity }, count);
}

describe('selections that pick no object by name ground as the compiler resolves them', () => {
    it('grounds the muted tracks a request to unmute all muted tracks selects', () => {
        const result = compileAndBridge(
            'Unmute all muted tracks',
            [
                roleItem(
                    'muteTrack',
                    { muted: false },
                    { targetArgument: 'trackId', entity: 'track', condition: { field: 'muted', equals: true } },
                    2
                ),
            ],
            [],
            mutedContext
        );

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([mutedDrums.id, mutedBass.id]);
    });

    it.each([
        ['Mute all tracks', 'muteTrack', { muted: true }],
        ['Set the volume of every track to -6 dB', 'setTrackGain', { gainDb: -6 }],
    ])('grounds every track for "%s"', (prompt, name, arguments_) => {
        const result = compileAndBridge(prompt, [everyObjectItem(name, arguments_, 'track', 4)], [], unmasteredContext);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([vocals.id, keys.id, drums.id, bass.id]);
    });

    it.each(['Bypass all the effects', 'Bypass every device'])('grounds every device for "%s"', (prompt) => {
        const result = compileMix(prompt, [everyObjectItem('bypassDevice', { bypassed: true }, 'device', 3)]);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result, 'deviceId')).toEqual([mixVocalsEq.id, mixVocalsCompressor.id, mixKeysEq.id]);
    });

    it('grounds every track a request to unmute all tracks selects', () => {
        const result = compileAndBridge(
            'Unmute all tracks',
            [everyObjectItem('muteTrack', { muted: false }, 'track', 4)],
            [],
            unmasteredContext
        );

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([vocals.id, keys.id, drums.id, bass.id]);
    });

    it('grounds the instrument tracks a request to mute them selects by kind', () => {
        const result = compileAndBridge(
            'Mute all instrument tracks',
            [
                roleItem(
                    'muteTrack',
                    { muted: true },
                    { targetArgument: 'trackId', entity: 'track', where: { kind: 'midi' } },
                    1
                ),
            ],
            [],
            unmasteredContext
        );

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([keys.id]);
    });

    it('grounds a named track beside the tracks a role selects', () => {
        const namedVocals = roleTrack('track-guitar-pair-vocals', 'Vocals', 'lead vocal');
        const guitarPairContext: ProjectContext = {
            ...projectContext,
            tracks: [namedVocals, gtrLeft, gtrRight, master],
        };
        const result = compileAndBridge(
            'turn Vocals down 3 dB and turn the guitars down 3 dB',
            [trackItem('setTrackGain', namedVocals, { deltaDb: -3 }), turnDown({ roleFamily: 'guitar' }, 2)],
            [],
            guitarPairContext
        );

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([namedVocals.id, gtrLeft.id, gtrRight.id]);
    });
});

describe('a selector on a track stands on the request selecting that track', () => {
    it.each(['Bypass all devices on the selected track', 'Bypass all devices on this track'])(
        'grounds the selected track\'s devices for "%s"',
        (prompt) => {
            const result = compileAndBridge(
                prompt,
                [
                    roleItem(
                        'bypassDevice',
                        { bypassed: true },
                        { targetArgument: 'deviceId', entity: 'device', where: { trackId: mixVocals.id } },
                        2
                    ),
                ],
                [],
                { ...mixContext, selectedTrackId: mixVocals.id }
            );

            expect(result.rejections).toEqual([]);
            expect(targetsOf(result, 'deviceId')).toEqual([mixVocalsEq.id, mixVocalsCompressor.id]);
        }
    );
});

const coRenameKeys = createTrack({ id: 'track-co-keys', name: 'Keys', kind: 'midi' });
const coRenameVocals = createTrack({ id: 'track-co-vocals', name: 'Vocals' });
const coRenamePiano = createTrack({ id: 'track-co-piano', name: 'Piano', kind: 'midi' });
const coRenameContext: ProjectContext = {
    ...projectContext,
    tracks: [coRenameKeys, coRenameVocals, coRenamePiano, master],
};

describe('compiled renames in one clause read no written name as a target', () => {
    it.each([
        ['Rename Keys to Pads and Vocals to Piano Lead', [coRenameKeys, 'Pads'], [coRenameVocals, 'Piano Lead']],
        [
            'Rename Vocals to Lead Vocals and Keys to Piano Roll',
            [coRenameVocals, 'Lead Vocals'],
            [coRenameKeys, 'Piano Roll'],
        ],
    ] as const)(
        'refuses neither rename target in "%s"',
        (prompt, [firstTrack, firstName], [secondTrack, secondName]) => {
            const result = compileAndBridge(
                prompt,
                [
                    trackItem('renameTrack', firstTrack, { name: firstName }),
                    trackItem('renameTrack', secondTrack, { name: secondName }),
                ],
                [],
                coRenameContext
            );

            // The other rename's written name ("Piano Lead", "Piano Roll") is not read as naming the
            // Piano track, so no target is refused. The second rename's value is refused by the existing
            // value check on the compiled route, which refuses it on main too; that is not a target decision.
            expect(result.rejections.filter((rejection) => rejection.reason.includes('trackId'))).toEqual([]);
            expect(result.actions).toContainEqual({
                type: 'renameTrack',
                payload: { trackId: firstTrack.id, name: firstName },
            });
        }
    );
});

describe('a role selection worded by a two-word name grounds as on main', () => {
    it('grounds the backing vocals a request for the background vocals selects', () => {
        const result = compileAndBridge(
            'turn down the background vocals by 3 dB',
            [turnDown({ role: 'backing vocal' }, 2)],
            [],
            roleContext
        );

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([backingVoxOne.id, backingVoxTwo.id]);
    });
});
