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

import { type AudioGraphClipPlayback, type AudioGraphCommand } from '../../../models/AudioGraphBackend';
import { type LiveGraphProgramme } from '../projectLiveGraphProgramme';
import { projectLiveGraphTopology, type LiveGraphTopologyInput } from '../projectLiveGraphTopology';

/**
 * A programme naming `stripIds`, one unity-rate playback each. The producer
 * under test reads only which strips play and how many playbacks they carry —
 * the arithmetic that fills these in is `projectLiveGraphProgramme`'s, and its
 * agreement with the export is proven by rendering both
 * (`projectLiveGraphProgrammeParity.spec.ts`).
 */
function programmeFor(
    stripIds: readonly string[],
    bakedStripIds: readonly string[] = [],
    webVoicedStripIds: readonly string[] = []
): LiveGraphProgramme {
    return {
        playbacksByStripId: new Map(
            stripIds.map((stripId): [string, readonly AudioGraphClipPlayback[]] => [
                stripId,
                [
                    {
                        trackId: stripId,
                        source: { sourceId: `material-${stripId}` },
                        startTime: 0,
                        sourceOffsetSeconds: 0,
                        durationSeconds: 1,
                        playbackRate: 1,
                        gain: 1,
                        fade: { microFadeSeconds: 0.003 },
                    },
                ],
            ])
        ),
        bakedStripIds: new Set(bakedStripIds),
        webVoicedStripIds: new Set(webVoicedStripIds),
        exclusions: [],
    };
}

const NO_PROGRAMME: LiveGraphProgramme = {
    playbacksByStripId: new Map(),
    bakedStripIds: new Set(),
    webVoicedStripIds: new Set(),
    exclusions: [],
};

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
        attachedInstanceIds: new Set(),
        transport: { playing: true, positionSeconds: 0 },
        monitor: 'shadowed',
        masterGain: 0.8,
        programme: NO_PROGRAMME,
        inputMonitoredTrackIds: new Set(),
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

    // The engine resolves a built-in's parameter keys against the instrument's
    // own vocabulary and refuses the whole batch over one it cannot name, so a
    // chain carried in the ids a panel authors takes every other strip in the
    // batch down with it.
    it('carries a built-in chain in the names the engine answers to, not the ids the project stores', () => {
        const commands = project({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    devices: [createDevice({ id: 'device-a', type: 'fermenter', parameterValues: { oscEngine: 2 } })],
                }),
            ],
        });

        const creation = stripCreation(commands, 'audio-1');
        expect(creation?.kind === 'create-track-strip' && creation.devices[0]?.parameterValues).toEqual({ engine: 2 });
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

    it('builds a strip with nothing to play as contributing no audio', () => {
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

    it('builds a clip-less strip whose hosted plugin the engine holds as contributing audio', () => {
        // The plugin has a native body and no other kind: Web Audio builds
        // nothing for it, and the engine splices an instrument in as a
        // generator. A strip left off the native side here has no clip to play
        // and no carrier to sound its plugin either, so it is silent outright.
        const commands = project({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    devices: [
                        createDevice({
                            id: 'dev-1',
                            type: 'external-plugin',
                            externalPluginId: 'clap:harness-tone',
                            externalInstanceId: 'i1',
                        }),
                    ],
                }),
            ],
            attachedInstanceIds: new Set(['i1']),
        });

        const creation = stripCreation(commands, 'audio-1');
        expect(creation?.kind === 'create-track-strip' && creation.contributesAudio).toBe(true);
    });

    it('leaves a strip whose clips Web Audio voices out of the native contribution', () => {
        // The strip's plugin is attached, but its material — a MIDI clip the
        // programme never admitted — is playing on the Web Audio path.
        // Contributing it here gates that strip out of Web Audio, and the notes
        // stop for the whole take.
        const commands = project({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    kind: 'midi',
                    devices: [
                        createDevice({
                            id: 'dev-1',
                            type: 'external-plugin',
                            externalPluginId: 'clap:harness-tone',
                            externalInstanceId: 'i1',
                        }),
                    ],
                }),
            ],
            attachedInstanceIds: new Set(['i1']),
            programme: programmeFor([], [], ['audio-1']),
        });

        const creation = stripCreation(commands, 'audio-1');
        expect(creation?.kind === 'create-track-strip' && creation.contributesAudio).toBe(false);
    });

    it('builds a playing strip whose whole chain is native as contributing audio', () => {
        const commands = project({
            stripTracks: [createTrack({ id: 'audio-1', devices: [createDevice({ id: 'dev-1', type: 'knead' })] })],
            programme: programmeFor(['audio-1']),
        });

        const creation = stripCreation(commands, 'audio-1');
        expect(creation?.kind === 'create-track-strip' && creation.contributesAudio).toBe(true);
    });

    it('keeps a playing strip carrying a WASM device off contributing audio, and still schedules it', () => {
        // `map_device` refuses the *whole batch* over a bodiless device on a
        // contributing strip, so the flag is what keeps one WASM built-in from
        // costing the session every strip it has. The clips still go.
        const commands = project({
            stripTracks: [
                createTrack({ id: 'audio-1', devices: [createDevice({ id: 'dev-1', type: 'builtin-filter' })] }),
            ],
            programme: programmeFor(['audio-1']),
        });

        const creation = stripCreation(commands, 'audio-1');
        expect(creation?.kind === 'create-track-strip' && creation.contributesAudio).toBe(false);
        expect(commands.filter((command) => command.kind === 'schedule-clip')).toHaveLength(1);
    });

    it('keeps a playing strip carrying an external plugin off contributing audio', () => {
        const commands = project({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    devices: [createDevice({ id: 'dev-1', type: 'knead', externalPluginId: 'clap:reverb' })],
                }),
            ],
            programme: programmeFor(['audio-1']),
            attachedInstanceIds: new Set(),
        });

        const creation = stripCreation(commands, 'audio-1');
        expect(creation?.kind === 'create-track-strip' && creation.contributesAudio).toBe(false);
    });

    it('builds a playing strip whose external plugin the engine holds as contributing audio', () => {
        // The mapper splices the engine-owned instance into the chain, so the
        // device has a native body and the whole chain is representable. Read
        // as unrepresentable, this strip renders without the plugin the
        // engineer loaded.
        const commands = project({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    devices: [
                        createDevice({ id: 'dev-1', type: 'knead' }),
                        createDevice({
                            id: 'dev-2',
                            type: 'external-plugin',
                            externalPluginId: 'clap:reverb',
                            externalInstanceId: 'i1',
                        }),
                    ],
                }),
            ],
            programme: programmeFor(['audio-1']),
            attachedInstanceIds: new Set(['i1']),
        });

        const creation = stripCreation(commands, 'audio-1');
        expect(creation?.kind === 'create-track-strip' && creation.contributesAudio).toBe(true);
        // The identity the mapper resolves the instance by still travels with
        // the device: a chain the strip claims to build and cannot name is a
        // batch the native side refuses whole.
        expect(
            creation?.kind === 'create-track-strip' &&
                creation.devices.map((device) => device.externalInstanceId).includes('i1')
        ).toBe(true);
    });

    it('keeps a strip whose external plugin the engine has not taken off contributing audio', () => {
        const commands = project({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    devices: [
                        createDevice({ id: 'dev-1', type: 'knead' }),
                        createDevice({
                            id: 'dev-2',
                            type: 'external-plugin',
                            externalPluginId: 'clap:reverb',
                            externalInstanceId: 'i1',
                        }),
                    ],
                }),
            ],
            programme: programmeFor(['audio-1']),
            attachedInstanceIds: new Set(),
        });

        const creation = stripCreation(commands, 'audio-1');
        expect(creation?.kind === 'create-track-strip' && creation.contributesAudio).toBe(false);
    });

    it('judges the whole chain, so an attached plugin cannot carry a WASM device past the mapper', () => {
        const commands = project({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    devices: [
                        createDevice({ id: 'dev-1', type: 'knead' }),
                        createDevice({
                            id: 'dev-2',
                            type: 'external-plugin',
                            externalPluginId: 'clap:reverb',
                            externalInstanceId: 'i1',
                        }),
                        createDevice({ id: 'dev-3', type: 'builtin-filter' }),
                    ],
                }),
            ],
            programme: programmeFor(['audio-1']),
            attachedInstanceIds: new Set(['i1']),
        });

        const creation = stripCreation(commands, 'audio-1');
        expect(creation?.kind === 'create-track-strip' && creation.contributesAudio).toBe(false);
    });

    it('never claims a bus contributes audio, however representable its own chain is', () => {
        // A bus is shared: both carriers route into it, and whichever tracks
        // are native carry their own contribution through it. A bus claiming
        // its own would let the native side sum the strip twice.
        const commands = project({
            stripTracks: [
                createTrack({
                    id: 'bus-1',
                    kind: 'bus',
                    devices: [
                        createDevice({
                            id: 'dev-1',
                            type: 'external-plugin',
                            externalPluginId: 'clap:reverb',
                            externalInstanceId: 'i1',
                        }),
                    ],
                }),
            ],
            programme: programmeFor(['bus-1']),
            attachedInstanceIds: new Set(['i1']),
        });

        const creation = stripCreation(commands, 'bus-1');
        expect(creation?.kind === 'create-bus-strip' && creation.contributesAudio).toBe(false);
    });

    it('keeps an input-monitored strip off contributing audio, so its live signal stays audible', () => {
        // Gating this strip out of Web Audio is what taking it native means,
        // and the live input reaches nothing else — a performer would lose
        // their own signal mid-take.
        const commands = project({
            stripTracks: [createTrack({ id: 'audio-1' })],
            programme: programmeFor(['audio-1']),
            inputMonitoredTrackIds: new Set(['audio-1']),
        });

        const creation = stripCreation(commands, 'audio-1');
        expect(creation?.kind === 'create-track-strip' && creation.contributesAudio).toBe(false);
    });

    it('keeps a strip routed through a bus it cannot build off contributing audio', () => {
        const commands = project({
            stripTracks: [
                createTrack({ id: 'audio-1', outputId: 'bus-1' }),
                createTrack({
                    id: 'bus-1',
                    kind: 'bus',
                    devices: [createDevice({ id: 'dev-1', type: 'builtin-filter' })],
                }),
            ],
            programme: programmeFor(['audio-1']),
        });

        const creation = stripCreation(commands, 'audio-1');
        expect(creation?.kind === 'create-track-strip' && creation.contributesAudio).toBe(false);
    });

    it('schedules only the strips it carries when the session is audible', () => {
        // An audible session sounds what it schedules, so a clip on a strip
        // Web Audio is still playing would be heard from both engines at once.
        const commands = project({
            stripTracks: [
                createTrack({ id: 'audio-1', devices: [createDevice({ id: 'dev-1', type: 'knead' })] }),
                createTrack({ id: 'audio-2', devices: [createDevice({ id: 'dev-2', type: 'builtin-filter' })] }),
            ],
            programme: programmeFor(['audio-1', 'audio-2']),
            monitor: 'audible',
        });

        expect(createdStripIds(commands)).toEqual(['audio-1', 'audio-2']);
        expect(
            commands.flatMap((command) => (command.kind === 'schedule-clip' ? [command.playback.trackId] : []))
        ).toEqual(['audio-1']);
    });

    it('renders the whole programme into the shadowed monitor, carried strip or not', () => {
        // A shadowed session sounds nothing, so it exists to be compared
        // against Web Audio — and a comparison that silently omitted the
        // strips this engine would not carry would compare two shorter
        // programmes and call them equal.
        const commands = project({
            stripTracks: [
                createTrack({ id: 'audio-1' }),
                createTrack({ id: 'audio-2', devices: [createDevice({ id: 'dev-1', type: 'builtin-filter' })] }),
            ],
            programme: programmeFor(['audio-1', 'audio-2']),
        });

        // The engine holds a real timeline; the monitor above it is what keeps
        // that inaudible beside Web Audio (#3123).
        expect(commands[0]).toEqual({ kind: 'set-monitor-shadow', shadowed: true });
        expect(
            commands.flatMap((command) => (command.kind === 'schedule-clip' ? [command.playback.trackId] : []))
        ).toEqual(['audio-1', 'audio-2']);
    });

    it('schedules every clip after the strip that plays it', () => {
        const commands = project({
            stripTracks: [createTrack({ id: 'audio-1' })],
            programme: programmeFor(['audio-1']),
        });

        const stripAt = commands.findIndex((command) => command.kind === 'create-track-strip');
        const clipAt = commands.findIndex((command) => command.kind === 'schedule-clip');
        expect(stripAt).toBeGreaterThanOrEqual(0);
        expect(clipAt).toBeGreaterThan(stripAt);
    });

    it('locates before it builds a strip, so the seek cannot cancel the mix the strip states', () => {
        // `set-transport` maps to a `SeekFrames`, and a seek cancels every
        // mixer write stamped at or past the frame it lands on. A strip states
        // its fader, pan and sends as writes at frame 0, so a transport after
        // the strips would leave every strip at the engine's default — silently
        // and only until someone listens.
        const commands = project({
            stripTracks: [createTrack({ id: 'audio-1', gain: 0.4 })],
            transport: { playing: true, positionSeconds: 0 },
            programme: programmeFor(['audio-1']),
        });

        const transportAt = commands.findIndex((command) => command.kind === 'set-transport');
        const stripAt = commands.findIndex((command) => command.kind === 'create-track-strip');
        const routeAt = commands.findIndex((command) => command.kind === 'set-track-output');
        expect(transportAt).toBeGreaterThanOrEqual(0);
        expect(stripAt).toBeGreaterThan(transportAt);
        expect(routeAt).toBeGreaterThan(transportAt);
    });

    it('drops a frozen strip’s device chain, because its bake already carries the processing', () => {
        const commands = project({
            stripTracks: [
                createTrack({ id: 'audio-1', devices: [createDevice({ id: 'dev-1', type: 'builtin-filter' })] }),
            ],
            programme: programmeFor(['audio-1'], ['audio-1']),
        });

        const creation = stripCreation(commands, 'audio-1');
        expect(creation?.kind === 'create-track-strip' && creation.devices).toEqual([]);
        // An empty chain is trivially native-representable, so the bake is
        // free to contribute audio.
        expect(creation?.kind === 'create-track-strip' && creation.contributesAudio).toBe(true);
    });

    it('carries the transport it was asked for', () => {
        const commands = project({
            stripTracks: [createTrack({ id: 'audio-1' })],
            transport: { playing: true, positionSeconds: 12.5 },
        });

        expect(commands[1]).toEqual({ kind: 'set-transport', playing: true, positionSeconds: 12.5 });
    });

    it('carries a stopped transport as faithfully as a playing one', () => {
        const commands = project({ transport: { playing: false, positionSeconds: 3 } });

        expect(commands).toEqual([
            { kind: 'set-monitor-shadow', shadowed: true },
            { kind: 'set-transport', playing: false, positionSeconds: 3 },
            { kind: 'set-master-gain', gain: 0.8 },
        ]);
    });

    it('carries the master level the fader is standing at', () => {
        const commands = project({ masterGain: 0.35 });

        expect(commands).toContainEqual({ kind: 'set-master-gain', gain: 0.35 });
    });

    it('states the master level before any strip it governs can sound', () => {
        // The level every strip in this batch is heard through, so it belongs
        // in the opening group with the monitor gate rather than after the
        // strips. It cannot be stated ahead of the gate itself: the gate is
        // what decides whether this engine reaches the speakers at all.
        const commands = project({
            stripTracks: [createTrack({ id: 'audio-1' })],
            transport: { playing: true, positionSeconds: 0 },
            masterGain: 0.35,
        });

        const monitorAt = commands.findIndex((command) => command.kind === 'set-monitor-shadow');
        const masterAt = commands.findIndex((command) => command.kind === 'set-master-gain');
        const firstStripAt = commands.findIndex((command) => command.kind === 'create-track-strip');
        expect(monitorAt).toBe(0);
        expect(masterAt).toBeGreaterThan(monitorAt);
        expect(masterAt).toBeLessThan(firstStripAt);
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
