import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../models/ProjectContext';
import { bridgeGroundedLlmToolCalls } from '../agentReference/bridgeGroundedLlmToolCalls';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';

/**
 * A compiled command list proves which objects its selectors resolve to, never that the user asked
 * for them (#5295). A target the request protects or excludes is refused. A selector that picks
 * its targets by a whole name, a word-start name fragment or an owner track must pick them by
 * something the request states outside its restrictions and written values, or by its selection
 * reference when it names no object of that kind. Literal targets, owner picks in a request that
 * names and selects no track, and selections by role, kind, device type, condition or no filter
 * ground as the compiler resolves them.
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

function authorityRefusals(result: ReturnType<typeof compileAndBridge>) {
    return result.rejections.filter((rejection) => rejection.reason.startsWith('Compiled target'));
}

describe('a name the request states beside a negation is a stated name (negation reading is #5351)', () => {
    it.each([
        "set Vocals volume to 75% but don't touch Keys",
        'set Vocals volume to 75% without touching Keys',
        'set Vocals volume to 75%, skip Keys',
    ])('admits a Keys selector for "%s" as main does (#5351)', (prompt) => {
        const result = compileMix(prompt, [trackItem('setTrackGain', mixKeys, { gain: 0.75 })]);

        expect(authorityRefusals(result)).toEqual([]);
    });

    it.each([
        "set Vocals volume to 75% but don't touch Keys",
        'set Vocals volume to 75%, skip Keys',
        'set Vocals volume to 75%, Keys unchanged',
        'turn Vocals down 3 dB to make room for Keys',
        'turn Vocals down 3 dB relative to Keys',
        'turn Vocals down 3 dB because Keys is too loud',
        'turn Vocals down 3 dB like Keys',
    ])('grounds the named Vocals selector in "%s"', (prompt) => {
        const value = prompt.startsWith('set') ? { gain: 0.75 } : { deltaDb: -3 };
        const result = compileMix(prompt, [trackItem('setTrackGain', mixVocals, value)]);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([mixVocals.id]);
    });

    it('grounds a named source routed to a bus whose name holds another bus name', () => {
        const plateReverb = createTrack({ id: 'track-mix-plate-reverb', name: 'Plate Reverb', kind: 'bus' });
        const result = compileAndBridge(
            'route Vocals to Plate Reverb',
            [trackItem('setTrackOutput', mixVocals, { outputId: plateReverb.id })],
            [],
            { ...mixContext, tracks: [...mixContext.tracks, plateReverb] }
        );

        expect(result.rejections).toEqual([]);
        expect(result.actions.map((action) => action.payload)).toEqual([
            expect.objectContaining({ trackId: mixVocals.id, outputId: plateReverb.id }),
        ]);
    });
});

const guitarRhythm = createTrack({ id: 'track-fragment-guitar-rhythm', name: 'Guitar Rhythm' });
const guitarLead = createTrack({ id: 'track-fragment-guitar-lead', name: 'Guitar Lead' });
const warmPad = createTrack({ id: 'track-fragment-warm-pad', name: 'Warm Pad', kind: 'midi' });
const darkPad = createTrack({ id: 'track-fragment-dark-pad', name: 'Dark Pad', kind: 'midi' });
const gtrL = createTrack({ id: 'track-fragment-gtr-l', name: 'Gtr L' });
const fragmentContext: ProjectContext = {
    ...projectContext,
    tracks: [guitarRhythm, guitarLead, warmPad, darkPad, gtrL, master],
};

function nameFragmentItem(fragment: string, count: number): CompiledItem {
    return {
        id: `turn-down-${fragment}`,
        name: 'setTrackGain',
        arguments: { deltaDb: -3 },
        selector: {
            targetArgument: 'trackId',
            entity: 'track',
            match: { all: [{ nameIncludes: fragment }] },
            quantity: { unit: 'targets', exactly: count },
        },
    };
}

describe('a name fragment stated inside any word of the request picks its targets', () => {
    it.each([
        ['turn down the guitars by 3 dB', 'guitar', [guitarRhythm.id, guitarLead.id]],
        ['turn down the pads by 3 dB', 'pad', [warmPad.id, darkPad.id]],
        ['turn down Gtr L by 3 dB', 'gtr', [gtrL.id]],
    ])('grounds "%s"', (prompt, fragment, expected) => {
        const result = compileAndBridge(prompt, [nameFragmentItem(fragment, expected.length)], [], fragmentContext);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual(expected);
    });
});

describe('a selection reference states the name a selector picks the selected track by', () => {
    it.each(['add a compressor to this track', 'add a compressor to the selected track', 'add a compressor to it'])(
        'grounds a Keys name selector for "%s" with Keys selected',
        (prompt) => {
            const result = compileAndBridge(prompt, [addDeviceItem(mixKeys, 'builtin-compressor')], [], {
                ...mixContext,
                selectedTrackId: mixKeys.id,
            });

            expect(result.rejections).toEqual([]);
            expect(targetsOf(result)).toEqual([mixKeys.id]);
        }
    );
});

describe('a selection reference states only the track that is selected', () => {
    it('refuses a Keys name selector for "add a compressor to it" with Vocals selected', () => {
        const result = compileAndBridge('add a compressor to it', [addDeviceItem(mixKeys, 'builtin-compressor')], [], {
            ...mixContext,
            selectedTrackId: mixVocals.id,
        });

        expect(result.actions).toEqual([]);
        expect(result.rejections).toContainEqual({ index: 0, name: 'addDevice', reason: UNAUTHORIZED_TRACK });
    });
});

describe('literal targets are taken as the compiler resolved them', () => {
    it.each([
        ['route Vocals to the reverb', 'setTrackOutput', { outputId: mixReverbBus.id }],
        ['route Keys to the main out', 'setTrackOutput', { outputId: master.id }],
    ] as const)('grounds "%s"', (prompt, name, arguments_) => {
        const track = prompt.includes('Keys') ? mixKeys : mixVocals;
        const result = compileMix(prompt, [trackItem(name, track, arguments_)]);

        expect(authorityRefusals(result)).toEqual([]);
    });

    it('grounds "send Vocals to the plate"', () => {
        const plate = createTrack({ id: 'track-mix-plate', name: 'Plate', kind: 'bus' });
        const result = compileAndBridge(
            'send Vocals to the plate',
            [trackItem('addSend', mixVocals, { busId: plate.id })],
            [],
            { ...mixContext, tracks: [...mixContext.tracks, plate] }
        );

        expect(authorityRefusals(result)).toEqual([]);
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

    it('refuses a rename of a track the request names only inside the new name', () => {
        const result = compileAndBridge(
            'Rename Kick to Bass Drum',
            [trackItem('renameTrack', renameBass, { name: 'Bass Drum' })],
            [],
            trackRenameContext
        );

        expect(result.actions).toEqual([]);
        expect(result.rejections).toContainEqual({ index: 0, name: 'renameTrack', reason: UNAUTHORIZED_TRACK });
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

describe('a name written by another rename in the batch picks no target', () => {
    it("refuses a rename of a track the request names only inside the other rename's new name", () => {
        const result = compileAndBridge(
            'Rename Keys to Piano Lead and Vocals to Pads',
            [
                trackItem('renameTrack', coRenameKeys, { name: 'Piano Lead' }),
                trackItem('renameTrack', coRenamePiano, { name: 'Pads' }),
            ],
            [],
            coRenameContext
        );

        expect(result.actions).not.toContainEqual(
            expect.objectContaining({ payload: expect.objectContaining({ trackId: coRenamePiano.id }) })
        );
        expect(result.rejections).toContainEqual({ index: 1, name: 'renameTrack', reason: UNAUTHORIZED_TRACK });
    });
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

function payloadTargets(result: ReturnType<typeof compileAndBridge>) {
    return result.actions.map((action) => {
        const payload = action.payload as Record<string, unknown>;
        return payload.deviceId ?? payload.trackId;
    });
}

describe('a later instruction picks by a name an earlier one in the request states', () => {
    it.each([
        [
            'turn Vocals down 3 dB and pan it 20% left',
            [trackItem('setTrackGain', mixVocals, { deltaDb: -3 }), trackItem('setTrackPan', mixVocals, { pan: -20 })],
            [mixVocals.id, mixVocals.id],
        ],
        [
            'turn Vocals down 3 dB and bypass its EQ',
            [trackItem('setTrackGain', mixVocals, { deltaDb: -3 }), bypassItem(mixVocalsEq, mixVocals.id)],
            [mixVocals.id, mixVocalsEq.id],
        ],
        [
            'mute Vocals and bypass the EQ on it',
            [trackItem('muteTrack', mixVocals, { muted: true }), bypassItem(mixVocalsEq, mixVocals.id)],
            [mixVocals.id, mixVocalsEq.id],
        ],
        [
            'Turn Vocals down 3 dB. Then bypass the EQ on that track.',
            [trackItem('setTrackGain', mixVocals, { deltaDb: -3 }), bypassItem(mixVocalsEq, mixVocals.id)],
            [mixVocals.id, mixVocalsEq.id],
        ],
        [
            'Take the Vocals track and add a compressor to it',
            [addDeviceItem(mixVocals, 'builtin-compressor')],
            [mixVocals.id],
        ],
        ['Select Vocals. Add a compressor to it.', [addDeviceItem(mixVocals, 'builtin-compressor')], [mixVocals.id]],
    ])('grounds "%s"', (prompt, items, expected) => {
        const result = compileMix(prompt, items);

        expect(result.rejections).toEqual([]);
        expect(payloadTargets(result)).toEqual(expected);
    });
});

describe('an owner-track pick answers to a request that names or selects a track', () => {
    it('grounds the only EQ a request that names no track bypasses', () => {
        const result = compileAndBridge('bypass the EQ', [bypassItem(vocalsEq, vocals.id)], [], {
            ...projectContext,
            tracks: [vocals, drums, bass, master],
        });

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result, 'deviceId')).toEqual([vocalsEq.id]);
    });

    it('grounds the EQ of a track the request describes without stating a track name', () => {
        const result = compileMix('bypass the EQ of the vocal track', [bypassItem(mixVocalsEq, mixVocals.id)]);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result, 'deviceId')).toEqual([mixVocalsEq.id]);
    });

    it('refuses devices off the selected track a request bypasses on the selected track', () => {
        const result = compileAndBridge(
            'Bypass all devices on the selected track',
            [
                roleItem(
                    'bypassDevice',
                    { bypassed: true },
                    { targetArgument: 'deviceId', entity: 'device', where: { trackId: mixKeys.id } },
                    1
                ),
            ],
            [],
            { ...mixContext, selectedTrackId: mixVocals.id }
        );

        expect(result.actions).toEqual([]);
        expect(result.rejections).toContainEqual({
            index: 0,
            name: 'bypassDevice',
            reason: 'Compiled target deviceId is not authorized by the user request',
        });
    });
});

describe('a selection reference stands for no track once the request names one', () => {
    it.each(['set Vocals volume to 75% so it sits better', 'set Vocals volume to 75% to match this track'])(
        'refuses a Keys name selector for "%s" with Keys selected',
        (prompt) => {
            const result = compileAndBridge(prompt, [trackItem('setTrackGain', mixKeys, { gain: 0.75 })], [], {
                ...mixContext,
                selectedTrackId: mixKeys.id,
            });

            expect(result.actions).toEqual([]);
            expect(result.rejections).toContainEqual({ index: 0, name: 'setTrackGain', reason: UNAUTHORIZED_TRACK });
        }
    );

    it('refuses the selected Keys EQ for "it" after the request names Vocals', () => {
        const result = compileAndBridge(
            'turn Vocals down 3 dB and bypass the EQ on it',
            [trackItem('setTrackGain', mixVocals, { deltaDb: -3 }), bypassItem(mixKeysEq, mixKeys.id)],
            [],
            { ...mixContext, selectedTrackId: mixKeys.id }
        );

        expect(payloadTargets(result)).toEqual([mixVocals.id]);
        expect(result.rejections).toContainEqual({
            index: 1,
            name: 'bypassDevice',
            reason: 'Compiled target deviceId is not authorized by the user request',
        });
    });
});

const fragmentDrumBus = createTrack({ id: 'track-fragment-drum-bus', name: 'Drum Bus', kind: 'bus' });
const fragmentFxBus = createTrack({ id: 'track-fragment-fx-bus', name: 'FX Bus', kind: 'bus' });
const fragmentKeys = createTrack({ id: 'track-fragment-keys', name: 'Keys', kind: 'midi' });
const wordStartContext: ProjectContext = {
    ...projectContext,
    tracks: [fragmentDrumBus, fragmentFxBus, fragmentKeys, warmPad, darkPad, master],
};

describe('a name fragment picks its targets only as the start of a word', () => {
    it.each([
        ['turn down the buses by 3 dB', 'bus', [fragmentDrumBus.id, fragmentFxBus.id]],
        ['turn down the keys by 3 dB', 'key', [fragmentKeys.id]],
    ])('grounds "%s"', (prompt, fragment, expected) => {
        const result = compileAndBridge(prompt, [nameFragmentItem(fragment, expected.length)], [], wordStartContext);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual(expected);
    });

    it.each([
        ['turn down the busy part by 3 dB', 'bus', 2],
        ['turn down the keyboard by 3 dB', 'key', 1],
        ['turn down 3 dB and update the mix', 'pad', 2],
        ['turn down the launchpad by 3 dB', 'pad', 2],
        ['turn down the padding by 3 dB', 'pad', 2],
    ])('refuses "%s" for a "%s" fragment', (prompt, fragment, count) => {
        const result = compileAndBridge(prompt, [nameFragmentItem(fragment, count)], [], wordStartContext);

        expect(result.actions).toEqual([]);
        expect(result.rejections).toContainEqual({ index: 0, name: 'setTrackGain', reason: UNAUTHORIZED_TRACK });
    });
});

const writtenVocals = createTrack({ id: 'track-written-vocals', name: 'Vocals' });
const writtenKick = createTrack({ id: 'track-written-kick', name: 'Kick' });
const writtenSnare = createTrack({ id: 'track-written-snare', name: 'Snare' });
const writtenValueContext: ProjectContext = {
    ...projectContext,
    tracks: [writtenVocals, writtenKick, writtenSnare, master],
};

describe('a name written by a call of any action in the batch picks no target', () => {
    it('refuses a gain selector picking a track the request names only inside a new name', () => {
        const result = compileAndBridge(
            'rename Kick to Snare 2 and set Vocals volume to 75%',
            [
                trackItem('renameTrack', writtenKick, { name: 'Snare 2' }),
                trackItem('setTrackGain', writtenSnare, { gain: 0.75 }),
            ],
            [],
            writtenValueContext
        );

        expect(payloadTargets(result)).not.toContain(writtenSnare.id);
        expect(result.rejections).toContainEqual({ index: 1, name: 'setTrackGain', reason: UNAUTHORIZED_TRACK });
    });

    it('grounds a gain selector for a track the request also names plainly', () => {
        const result = compileAndBridge(
            'rename Kick to Snare 2 and set Snare volume to 75%',
            [
                trackItem('renameTrack', writtenKick, { name: 'Snare 2' }),
                trackItem('setTrackGain', writtenSnare, { gain: 0.75 }),
            ],
            [],
            writtenValueContext
        );

        expect(result.rejections).toEqual([]);
        expect(payloadTargets(result)).toEqual([writtenKick.id, writtenSnare.id]);
    });
});

const formVocals = createTrack({ id: 'track-form-vocals', name: 'Vocals' });
const formDrums = createTrack({ id: 'track-form-drums', name: 'Drums' });
const formKeys = createTrack({ id: 'track-form-keys', name: 'Keys', kind: 'midi' });
const formPads = createTrack({ id: 'track-form-pads', name: 'Pads', kind: 'midi' });
const formHiHat = createTrack({ id: 'track-form-hi-hat', name: 'Hi-Hat' });
const formCafeKeys = createTrack({ id: 'track-form-cafe-keys', name: 'Café Keys', kind: 'midi' });
const formMelodyOne = createTrack({ id: 'track-form-melody-1', name: 'Melody 1', kind: 'midi' });
const formMelodyTwo = createTrack({ id: 'track-form-melody-2', name: 'Melody 2', kind: 'midi' });
const formHarmonyHigh = createTrack({ id: 'track-form-harmony-high', name: 'Harmony High' });
const formHarmonyLow = createTrack({ id: 'track-form-harmony-low', name: 'Harmony Low' });
const nameFormContext: ProjectContext = {
    ...projectContext,
    tracks: [
        formVocals,
        formDrums,
        formKeys,
        formPads,
        formHiHat,
        formCafeKeys,
        formMelodyOne,
        formMelodyTwo,
        formHarmonyHigh,
        formHarmonyLow,
        master,
    ],
};

describe('a name stated in an ordinary form picks its targets', () => {
    it.each([
        ['set the vocal volume to 75%', formVocals],
        ['set the drum volume to 75%', formDrums],
        ['set the key volume to 75%', formKeys],
        ['set the pad volume to 75%', formPads],
        ['set the hi hat volume to 75%', formHiHat],
        ['set cafe keys volume to 75%', formCafeKeys],
    ])('grounds "%s"', (prompt, track) => {
        const result = compileAndBridge(
            prompt,
            [trackItem('setTrackGain', track, { gain: 0.75 })],
            [],
            nameFormContext
        );

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([track.id]);
    });

    it.each([
        ['set the melodies volume to 75%', 'melody', [formMelodyOne.id, formMelodyTwo.id]],
        ['set the harmonies volume to 75%', 'harmony', [formHarmonyHigh.id, formHarmonyLow.id]],
    ])('grounds "%s" for a "%s" fragment', (prompt, fragment, expected) => {
        const result = compileAndBridge(
            prompt,
            [
                roleItem(
                    'setTrackGain',
                    { gain: 0.75 },
                    { targetArgument: 'trackId', entity: 'track', match: { all: [{ nameIncludes: fragment }] } },
                    expected.length
                ),
            ],
            [],
            nameFormContext
        );

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual(expected);
    });

    it('protects a track a restriction names in an ordinary form', () => {
        const result = compileMix('add an EQ to every audio track but leave the vocal alone', [
            roleItem(
                'addDevice',
                { deviceType: 'builtin-eq' },
                { targetArgument: 'trackId', entity: 'track', where: { kind: 'audio' } },
                4
            ),
        ]);

        expect(targetsOf(result)).toEqual([mixDrums.id, mixBass.id, mixGuitar.id]);
        expect(result.rejections).toEqual([{ index: 0, name: 'addDevice', reason: UNAUTHORIZED_TRACK }]);
    });
});

describe('"its" refers to the selected track as "it" does', () => {
    it('grounds the selected track a request sets through "its"', () => {
        const result = compileAndBridge(
            'set its volume to 75%',
            [trackItem('setTrackGain', mixVocals, { gain: 0.75 })],
            [],
            {
                ...mixContext,
                selectedTrackId: mixVocals.id,
            }
        );

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([mixVocals.id]);
    });

    it('refuses the selected track for "its" once the request names another track', () => {
        const result = compileAndBridge(
            'set Keys volume to 75% so its level sits better',
            [trackItem('setTrackGain', mixVocals, { gain: 0.75 })],
            [],
            { ...mixContext, selectedTrackId: mixVocals.id }
        );

        expect(result.actions).toEqual([]);
        expect(result.rejections).toContainEqual({ index: 0, name: 'setTrackGain', reason: UNAUTHORIZED_TRACK });
    });
});

function namedTracksContext(names: readonly string[]): {
    context: ProjectContext;
    track: (name: string) => ProjectTrack;
} {
    const tracks = names.map((name) => createTrack({ id: `track-named-${names.indexOf(name)}`, name }));
    return {
        context: { ...projectContext, tracks: [...tracks, master] },
        track: (name) => tracks.find((candidate) => candidate.name === name)!,
    };
}

describe('a stated name picks only the track whose name reads it best', () => {
    it.each([
        ['set Vocal volume to 75%', ['Vocal', 'Vocals'], 'Vocals'],
        ['set Vocals volume to 75%', ['Vocal', 'Vocals'], 'Vocal'],
        ['set Café volume to 75%', ['Café', 'Cafe'], 'Cafe'],
        ['set Cafe volume to 75%', ['Café', 'Cafe'], 'Café'],
        ['set Hi-Hat volume to 75%', ['Hi-Hat', 'Hi Hat'], 'Hi Hat'],
        ['set Hi Hat volume to 75%', ['Hi-Hat', 'Hi Hat'], 'Hi-Hat'],
        ['set Drum Bus volume to 75%', ['Drum', 'Drum Bus'], 'Drum'],
        ['set Bass Drum volume to 75%', ['Bass', 'Bass Drum'], 'Bass'],
        ['set Hi-Hat volume to 75%', ['Hat', 'Hi-Hat'], 'Hat'],
    ])('refuses "%s" for the sibling of %j it does not state, %s', (prompt, names, picked) => {
        const { context, track } = namedTracksContext(names);
        const result = compileAndBridge(
            prompt,
            [trackItem('setTrackGain', track(picked), { gain: 0.75 })],
            [],
            context
        );

        expect(result.actions).toEqual([]);
        expect(result.rejections).toContainEqual({ index: 0, name: 'setTrackGain', reason: UNAUTHORIZED_TRACK });
    });

    it.each([
        ['set Vocal volume to 75%', ['Vocal', 'Vocals'], 'Vocal'],
        ['set Vocals volume to 75%', ['Vocal', 'Vocals'], 'Vocals'],
        ['set Café volume to 75%', ['Café', 'Cafe'], 'Café'],
        ['set Hi Hat volume to 75%', ['Hi-Hat', 'Hi Hat'], 'Hi Hat'],
        ['set Drum Bus volume to 75%', ['Drum', 'Drum Bus'], 'Drum Bus'],
    ])('grounds "%s" for the track of %j it states, %s', (prompt, names, picked) => {
        const { context, track } = namedTracksContext(names);
        const result = compileAndBridge(
            prompt,
            [trackItem('setTrackGain', track(picked), { gain: 0.75 })],
            [],
            context
        );

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([track(picked).id]);
    });

    it.each([
        ['turn down the Drum Bus by 3 dB', ['Drum Bus', 'FX Bus'], 'Bus', 'FX Bus'],
        ['turn down the Drum Bus by 3 dB', ['Drum-Bus', 'FX Bus'], 'Bus', 'FX Bus'],
        ['turn down the Drum Bus by 3 dB', ['Drums', 'Drum Bus'], 'Drum', 'Drums'],
    ])(
        'refuses "%s" among %j for the "%s" fragment it states only inside another name, %s',
        (prompt, names, fragment, sibling) => {
            const { context, track } = namedTracksContext(names);
            const result = compileAndBridge(prompt, [nameFragmentItem(fragment, 2)], [], context);

            expect(targetsOf(result)).toEqual(names.filter((name) => name !== sibling).map((name) => track(name).id));
            expect(result.rejections).toContainEqual({
                index: names.indexOf(sibling),
                name: 'setTrackGain',
                reason: UNAUTHORIZED_TRACK,
            });
        }
    );

    it.each([
        ['turn down the guitars by 3 dB', ['Guitar', 'Guitar 2', "Bob's Guitar"], 'guitar'],
        ['turn down the bass tracks by 3 dB', ['Bass', 'Bass Drum', 'Sub Bass'], 'bass'],
        ['turn down the synths by 3 dB', ['Synth', 'Synth 2'], 'synth'],
        ['turn down the vocals by 3 dB', ['Vocals', 'Vocal Lead'], 'vocal'],
        ['turn down all vocal tracks by 3 dB', ['Vocals', 'Vocal Lead'], 'vocal'],
    ])('grounds "%s" among %j for the "%s" fragment a whole name reads no further than', (prompt, names, fragment) => {
        const { context, track } = namedTracksContext(names);
        const result = compileAndBridge(prompt, [nameFragmentItem(fragment, names.length)], [], context);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual(names.map((name) => track(name).id));
    });
});

describe('a name fragment stated only inside a restriction picks no target', () => {
    it('refuses a "bass" fragment the request states only in what it leaves alone', () => {
        const { context } = namedTracksContext(['Drums', 'Bass DI']);
        const result = compileAndBridge(
            'turn down the drums by 3 dB but leave Bass Verse alone',
            [nameFragmentItem('bass', 1)],
            [],
            context
        );

        expect(result.actions).toEqual([]);
        expect(result.rejections).toContainEqual({ index: 0, name: 'setTrackGain', reason: UNAUTHORIZED_TRACK });
    });
});

describe('a name stated with its punctuation folded picks its track as the shared resolver reads it', () => {
    it.each([
        ['set Kick In volume to 75%', 'Kick (In)'],
        ['set Synth 1 volume to 75%', 'Synth #1'],
        ['set Keys volume to 75%', '🎹 Keys'],
        ['set Guitar L R volume to 75%', 'Guitar L/R'],
        ["set Jose's Guitar volume to 75%", 'Jose’s Guitar'],
        ['set Jose’s Guitar volume to 75%', "Jose's Guitar"],
    ])('grounds "%s" for %s', (prompt, name) => {
        const { context, track } = namedTracksContext([name, 'Snare']);
        const result = compileAndBridge(prompt, [trackItem('setTrackGain', track(name), { gain: 0.75 })], [], context);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([track(name).id]);
    });
});

describe('list punctuation between two names never states the name joining them', () => {
    const listed = namedTracksContext(['Bass', 'Drums', 'Bass Drums']);
    const turnDownTrack = (name: string) => trackItem('setTrackGain', listed.track(name), { deltaDb: -3 });
    it.each([
        'Turn down Bass & Drums by 3 dB',
        'Turn down Bass + Drums by 3 dB',
        'Turn down Bass / Drums by 3 dB',
        'Turn down Bass; Drums by 3 dB',
        'Turn down Bass. Drums stay as they are.',
        'Turn down these tracks by 3 dB:\n- Bass\n- Drums',
    ])('refuses a Bass Drums pick for %j', (prompt) => {
        const result = compileAndBridge(prompt, [turnDownTrack('Bass Drums')], [], listed.context);

        expect(result.actions).toEqual([]);
        expect(result.rejections).toContainEqual({ index: 0, name: 'setTrackGain', reason: UNAUTHORIZED_TRACK });
    });

    // "Turn down Bass; Drums by 3 dB" is left out: its first clause states no figure, so the value
    // check refuses the Bass call whatever the target reading.
    it.each([
        'Turn down Bass & Drums by 3 dB',
        'Turn down Bass + Drums by 3 dB',
        'Turn down Bass / Drums by 3 dB',
        'Turn down these tracks by 3 dB:\n- Bass\n- Drums',
        'Turn down Bass and Drums by 3 dB',
    ])('grounds the Bass and Drums picks for %j', (prompt) => {
        const result = compileAndBridge(prompt, [turnDownTrack('Bass'), turnDownTrack('Drums')], [], listed.context);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([listed.track('Bass').id, listed.track('Drums').id]);
    });

    it('grounds a Bass Drums pick the request types', () => {
        const result = compileAndBridge(
            'Turn down Bass Drums by 3 dB',
            [turnDownTrack('Bass Drums')],
            [],
            listed.context
        );

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result)).toEqual([listed.track('Bass Drums').id]);
    });
});

describe('a device name fragment picks only on the track the request names as owner', () => {
    const ownedVocals = createTrack({
        id: 'track-owned-vocals',
        name: 'Vocals',
        devices: [{ id: 'device-owned-vocals-eq', type: 'builtin-eq', name: 'EQ', bypassed: false }],
    });
    const ownedKeys = createTrack({
        id: 'track-owned-keys',
        name: 'Keys',
        kind: 'midi',
        devices: [{ id: 'device-owned-keys-eq', type: 'builtin-eq', name: 'EQ', bypassed: false }],
    });
    const ownedContext: ProjectContext = { ...projectContext, tracks: [ownedVocals, ownedKeys, master] };
    const [vocalsOwnedEq, keysOwnedEq] = [ownedVocals.devices[0]!, ownedKeys.devices[0]!];
    const bypassEqs: CompiledItem = roleItem(
        'bypassDevice',
        { bypassed: true },
        { targetArgument: 'deviceId', entity: 'device', match: { all: [{ nameIncludes: 'EQ' }] } },
        2
    );

    it.each([
        ['bypass the EQ on Vocals', vocalsOwnedEq.id, 1],
        ['bypass the EQ on Keys', keysOwnedEq.id, 0],
    ])('grounds only the EQ "%s" names the owner of', (prompt, keptId, refusedIndex) => {
        const result = compileAndBridge(prompt, [bypassEqs], [], ownedContext);

        expect(targetsOf(result, 'deviceId')).toEqual([keptId]);
        expect(result.rejections).toEqual([
            {
                index: refusedIndex,
                name: 'bypassDevice',
                reason: 'Compiled target deviceId is not authorized by the user request',
            },
        ]);
    });

    it('grounds both EQs for "bypass the EQs on Vocals and Keys"', () => {
        const result = compileAndBridge('bypass the EQs on Vocals and Keys', [bypassEqs], [], ownedContext);

        expect(result.rejections).toEqual([]);
        expect(targetsOf(result, 'deviceId')).toEqual([vocalsOwnedEq.id, keysOwnedEq.id]);
    });
});
