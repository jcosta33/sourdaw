/**
 * What the live producer owes the native engine (#3066).
 *
 * The producer is the only thing standing between project truth and a native
 * graph, and its whole failure mode is *omission*: a strip, a chain, a plugin
 * or a route that never reaches the command stream is not an error anywhere —
 * it is a native graph that quietly is not the project. Every case below
 * therefore asserts a topology element's presence in the stream, so dropping it
 * from the producer reds here rather than at a musician's first play.
 *
 * The producer is pure, so nothing is mocked: the assertions read the commands
 * it returns.
 */

import { describe, expect, it } from 'vitest';

import { type Device, type Track } from '#/modules/Arrangement/stores';
import { createTrack as createTrackFromProjectDefaults } from '#/modules/Arrangement/useCases';

import { type AudioGraphCommand } from '../../../models/AudioGraphBackend';
import { projectLiveGraphTopology, type LiveGraphTopologyInput } from '../projectLiveGraphTopology';

function createTrack(overrides?: Partial<Track>): Track {
    return {
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'hw_out',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
        ...overrides,
    };
}

function createDevice(overrides: Partial<Device> & { id: string }): Device {
    return {
        name: overrides.id,
        type: 'builtin-filter',
        bypassed: false,
        parameterValues: {},
        ...overrides,
    };
}

function project(overrides: Partial<LiveGraphTopologyInput>): readonly AudioGraphCommand[] {
    return projectLiveGraphTopology({
        stripTracks: [],
        soloGatedTrackIds: new Set(),
        vcaMultiplierByTrackId: new Map(),
        transport: { playing: true, positionSeconds: 0 },
        monitor: 'shadowed',
        ...overrides,
    });
}

/** Every strip id the batch creates, whichever creation command carried it. */
function createdStripIds(commands: readonly AudioGraphCommand[]): string[] {
    return commands.flatMap((command) => {
        if (command.kind === 'create-track-strip') {
            return [command.trackId];
        }
        return command.kind === 'create-bus-strip' ? [command.busId] : [];
    });
}

function stripCreation(commands: readonly AudioGraphCommand[], id: string) {
    return commands.find(
        (command) =>
            (command.kind === 'create-track-strip' && command.trackId === id) ||
            (command.kind === 'create-bus-strip' && command.busId === id)
    );
}

describe('projectLiveGraphTopology', () => {
    it('creates a strip for every track and every bus in the session', () => {
        const commands = project({
            stripTracks: [
                createTrack({ id: 'audio-1' }),
                createTrack({ id: 'audio-2' }),
                createTrack({ id: 'bus-1', kind: 'bus' }),
            ],
        });

        expect(createdStripIds(commands)).toEqual(['audio-1', 'audio-2', 'bus-1']);
        expect(stripCreation(commands, 'bus-1')?.kind).toBe('create-bus-strip');
        expect(stripCreation(commands, 'audio-1')?.kind).toBe('create-track-strip');
    });

    it('carries a strip device chain in project order', () => {
        const devices = [createDevice({ id: 'device-a' }), createDevice({ id: 'device-b' })];

        const commands = project({ stripTracks: [createTrack({ id: 'audio-1', devices })] });

        const creation = stripCreation(commands, 'audio-1');
        expect(creation?.kind === 'create-track-strip' && creation.devices.map((device) => device.id)).toEqual([
            'device-a',
            'device-b',
        ]);
    });

    it('carries a bus device chain, which is the whole point of a send bus', () => {
        const commands = project({
            stripTracks: [createTrack({ id: 'bus-1', kind: 'bus', devices: [createDevice({ id: 'reverb' })] })],
        });

        const creation = stripCreation(commands, 'bus-1');
        expect(creation?.kind === 'create-bus-strip' && creation.devices.map((device) => device.id)).toEqual([
            'reverb',
        ]);
    });

    it('carries the project bus mute, pan and solo gate onto the native strip', () => {
        const commands = project({
            stripTracks: [createTrack({ id: 'bus-1', kind: 'bus', pan: -30, muted: true, gain: 0.9 })],
            soloGatedTrackIds: new Set(['bus-1']),
        });

        const creation = stripCreation(commands, 'bus-1');
        expect(creation?.kind === 'create-bus-strip' && creation.state).toEqual({
            gain: 0.9,
            pan: -30,
            muted: true,
            soloGated: true,
            vcaMultiplier: 1,
        });
        expect(creation?.kind === 'create-bus-strip' && creation.honorMuted).toBe(true);
    });

    it('keeps the track gates a track strip does hold', () => {
        const commands = project({
            stripTracks: [createTrack({ id: 'audio-1', pan: -30, muted: true })],
            soloGatedTrackIds: new Set(['audio-1']),
        });

        const creation = stripCreation(commands, 'audio-1');
        expect(creation?.kind === 'create-track-strip' && creation.state.pan).toBe(-30);
        expect(creation?.kind === 'create-track-strip' && creation.state.soloGated).toBe(true);
        expect(creation?.kind === 'create-track-strip' && creation.honorMuted).toBe(true);
    });

    it('carries an external plugin device with the identity the host resolves it by', () => {
        const plugin = createDevice({
            id: 'device-plugin',
            type: 'external-plugin',
            externalPluginId: 'clap:com.example.reverb',
            externalInstanceId: 'instance-77',
        });

        const commands = project({ stripTracks: [createTrack({ id: 'audio-1', devices: [plugin] })] });

        const creation = stripCreation(commands, 'audio-1');
        expect(creation?.kind === 'create-track-strip' && creation.devices).toEqual([plugin]);
    });

    it('routes every strip output on the shared precedence', () => {
        const commands = project({
            stripTracks: [
                createTrack({ id: 'audio-1', outputId: 'bus-1' }),
                createTrack({ id: 'audio-2', outputId: 'hw_out' }),
                createTrack({ id: 'bus-1', kind: 'bus', outputId: 'hw_out' }),
            ],
        });

        expect(commands.filter((command) => command.kind === 'set-track-output')).toEqual([
            { kind: 'set-track-output', trackId: 'audio-1', target: { kind: 'bus', busId: 'bus-1' } },
            { kind: 'set-track-output', trackId: 'audio-2', target: { kind: 'master' } },
            { kind: 'set-track-output', trackId: 'bus-1', target: { kind: 'master' } },
        ]);
    });

    it('routes a session built from project defaults to a batch the engine accepts', () => {
        // Nothing here is chosen: `createTrack` is the production route every
        // added track and bus takes, so a plain new session has a master track
        // called `master` and every other strip pointed at it. The engine takes
        // a bus → track edge, so the bus keeps that default and its audio runs
        // through the master strip's device chain — the same mix Web Audio
        // builds. Rewriting the bus onto the engine sum would bypass those
        // inserts.
        const commands = project({
            stripTracks: [
                createTrackFromProjectDefaults({ name: 'Master', kind: 'master' }),
                createTrackFromProjectDefaults({ id: 'audio-1', name: 'Audio 1', kind: 'audio' }),
                createTrackFromProjectDefaults({ id: 'bus-1', name: 'Bus 1', kind: 'bus' }),
            ],
        });

        expect(commands.filter((command) => command.kind === 'set-track-output')).toEqual([
            { kind: 'set-track-output', trackId: 'master', target: { kind: 'master' } },
            { kind: 'set-track-output', trackId: 'audio-1', target: { kind: 'track', trackId: 'master' } },
            { kind: 'set-track-output', trackId: 'bus-1', target: { kind: 'track', trackId: 'master' } },
        ]);
    });

    it('routes a bus at an ordinary track the same way it routes a track there', () => {
        const commands = project({
            stripTracks: [
                createTrack({ id: 'audio-1', outputId: 'hw_out' }),
                createTrack({ id: 'bus-1', kind: 'bus', outputId: 'audio-1' }),
            ],
        });

        expect(commands.filter((command) => command.kind === 'set-track-output')).toEqual([
            { kind: 'set-track-output', trackId: 'audio-1', target: { kind: 'master' } },
            { kind: 'set-track-output', trackId: 'bus-1', target: { kind: 'track', trackId: 'audio-1' } },
        ]);
    });

    it('carries each send with the tap it was configured on', () => {
        const commands = project({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    sends: [
                        { busId: 'bus-1', level: 0.4, preFader: true },
                        { busId: 'bus-2', level: 0.25, preFader: false },
                    ],
                }),
                createTrack({ id: 'bus-1', kind: 'bus' }),
                createTrack({ id: 'bus-2', kind: 'bus' }),
            ],
        });

        expect(commands.filter((command) => command.kind === 'add-send')).toEqual([
            { kind: 'add-send', trackId: 'audio-1', busId: 'bus-1', tap: 'pre-fader', level: 0.4 },
            { kind: 'add-send', trackId: 'audio-1', busId: 'bus-2', tap: 'post-fader', level: 0.25 },
        ]);
    });

    it('drops a send whose source is a bus, which the native graph refuses outright', () => {
        // Bus into bus is ordinary practice — a reverb bus feeding a parallel
        // compressor — and the sanctioned add-send path admits it, because a
        // bus accepts sends. The native send tap sits on track strips only, so
        // emitting it would refuse the batch and start no engine for the whole
        // project. The track's own send must survive that filter.
        const commands = project({
            stripTracks: [
                createTrack({ id: 'audio-1', sends: [{ busId: 'verb', level: 0.3, preFader: false }] }),
                createTrack({
                    id: 'verb',
                    kind: 'bus',
                    sends: [{ busId: 'parallel-comp', level: 0.5, preFader: false }],
                }),
                createTrack({ id: 'parallel-comp', kind: 'bus' }),
            ],
        });

        expect(commands.filter((command) => command.kind === 'add-send')).toEqual([
            { kind: 'add-send', trackId: 'audio-1', busId: 'verb', tap: 'post-fader', level: 0.3 },
        ]);
    });

    it('drops a send naming no built bus, because it names no audio path either', () => {
        const commands = project({
            stripTracks: [createTrack({ id: 'audio-1', sends: [{ busId: 'ghost-bus', level: 1, preFader: false }] })],
        });

        expect(commands.filter((command) => command.kind === 'add-send')).toEqual([]);
    });

    it('creates every strip before the first route that names one', () => {
        const commands = project({
            stripTracks: [createTrack({ id: 'audio-1', outputId: 'bus-1' }), createTrack({ id: 'bus-1', kind: 'bus' })],
        });

        const lastCreation = commands.findLastIndex(
            (command) => command.kind === 'create-track-strip' || command.kind === 'create-bus-strip'
        );
        const firstRoute = commands.findIndex(
            (command) => command.kind === 'set-track-output' || command.kind === 'add-send'
        );
        expect(lastCreation).toBeLessThan(firstRoute);
    });

    it('carries the mixer state, the solo gate and the VCA multiplier onto the strip', () => {
        const commands = project({
            stripTracks: [createTrack({ id: 'audio-1', gain: 1.4, pan: -20, muted: true })],
            soloGatedTrackIds: new Set(['audio-1']),
            vcaMultiplierByTrackId: new Map([['audio-1', 0.5]]),
        });

        const creation = stripCreation(commands, 'audio-1');
        expect(creation?.kind === 'create-track-strip' && creation.state).toEqual({
            gain: 1.4,
            pan: -20,
            muted: true,
            soloGated: true,
            vcaMultiplier: 0.5,
        });
        expect(creation?.kind === 'create-track-strip' && creation.honorMuted).toBe(true);
    });

    it('leaves a strip the solo law is not gating open', () => {
        const commands = project({
            stripTracks: [createTrack({ id: 'audio-1' })],
            soloGatedTrackIds: new Set(['audio-2']),
        });

        const creation = stripCreation(commands, 'audio-1');
        expect(creation?.kind === 'create-track-strip' && creation.state.soloGated).toBe(false);
    });

    it('builds every strip as contributing no audio while nothing is scheduled on it', () => {
        const commands = project({
            stripTracks: [createTrack({ id: 'audio-1' }), createTrack({ id: 'bus-1', kind: 'bus' })],
        });

        for (const id of ['audio-1', 'bus-1']) {
            const creation = stripCreation(commands, id);
            expect(
                creation?.kind === 'create-track-strip' || creation?.kind === 'create-bus-strip'
                    ? creation.contributesAudio
                    : 'no creation command'
            ).toBe(false);
        }
    });

    it('schedules no clip, so the engine this batch starts renders silence beside Web Audio', () => {
        const commands = project({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    clips: [
                        {
                            id: 'clip-1',
                            trackId: 'audio-1',
                            name: 'clip-1',
                            startBeat: 0,
                            endBeat: 4,
                            type: 'audio',
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            gain: 1,
                            color: '#00ff00',
                            locked: false,
                            muted: false,
                            audioBufferId: 'buffer-1',
                        },
                    ],
                }),
            ],
        });

        expect(commands.filter((command) => command.kind === 'schedule-clip')).toEqual([]);
    });

    it('ends the batch with the transport it was asked for', () => {
        const commands = project({
            stripTracks: [createTrack({ id: 'audio-1' })],
            transport: { playing: true, positionSeconds: 12.5 },
        });

        expect(commands.at(-1)).toEqual({ kind: 'set-transport', playing: true, positionSeconds: 12.5 });
    });

    it('carries a stopped transport as faithfully as a playing one', () => {
        const commands = project({ transport: { playing: false, positionSeconds: 3 } });

        expect(commands).toEqual([
            { kind: 'set-monitor-shadow', shadowed: true },
            { kind: 'set-transport', playing: false, positionSeconds: 3 },
        ]);
    });

    it('opens the batch with the monitor mode, ahead of anything that could be audible', () => {
        const commands = project({
            stripTracks: [createTrack({ id: 'audio-1' })],
            monitor: 'shadowed',
        });

        // The batch applies whole at one block boundary, so ordering inside it
        // is a statement rather than a race — but the statement is the point:
        // nothing in this batch may be read as audible before the mode that
        // decides it.
        expect(commands[0]).toEqual({ kind: 'set-monitor-shadow', shadowed: true });
    });

    it('asks for an open monitor only when the caller asks for the cutover', () => {
        const commands = project({ stripTracks: [createTrack({ id: 'audio-1' })], monitor: 'audible' });

        expect(commands[0]).toEqual({ kind: 'set-monitor-shadow', shadowed: false });
    });
});
