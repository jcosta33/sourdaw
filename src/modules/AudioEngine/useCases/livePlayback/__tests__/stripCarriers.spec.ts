/**
 * Which engine sounds each track, and the reason a musician is given (#3564).
 *
 * The law is conservative in one direction and wrong in the other: a track
 * called native the engine cannot build goes silent, and a track left on Web
 * Audio the native engine also plays is heard twice. Every case below therefore
 * drives one rule to its `web` answer and reads the reason, because the reason
 * is the notice text and a wrong reason is a wrong notice.
 *
 * The law is pure, so nothing is mocked.
 */

import { describe, expect, it } from 'vitest';

import { type Device, type Track } from '#/modules/Arrangement/stores';

import { type AudioGraphClipPlayback } from '../../../models/AudioGraphBackend';
import { type LiveGraphProgramme } from '../projectLiveGraphProgramme';
import { projectStripCarriers, type StripCarriersInput } from '../stripCarriers';

function createTrack(overrides: Partial<Track> & { id: string }): Track {
    return {
        name: `name-${overrides.id}`,
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
    return { name: overrides.id, type: 'builtin-filter', bypassed: false, parameterValues: {}, ...overrides };
}

/** A built-in effect `daw-engine` builds a body for. */
function nativeDevice(id: string): Device {
    return createDevice({ id, type: 'knead' });
}

/** A built-in instrument `daw-engine` builds a body for, and registers a note store on. */
function nativeInstrumentDevice(id: string): Device {
    return createDevice({ id, type: 'fermenter' });
}

/** The sampler the engine splices by the device's own id rather than building. */
function crumbsDevice(input: { id: string; name?: string }): Device {
    return createDevice({
        id: input.id,
        type: 'builtin-crumbs',
        ...(input.name === undefined ? {} : { name: input.name }),
    });
}

function pluginDevice(input: { id: string; name: string; instanceId?: string }): Device {
    return createDevice({
        id: input.id,
        name: input.name,
        type: 'external-plugin',
        externalPluginId: 'clap:com.example.reverb',
        ...(input.instanceId === undefined ? {} : { externalInstanceId: input.instanceId }),
    });
}

/** A programme giving every named strip one playback, which is rule 1's whole question. */
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

function carriersOf(overrides: Partial<StripCarriersInput> & { stripTracks: readonly Track[] }) {
    return projectStripCarriers({
        attachedInstanceIds: new Set(),
        programme: programmeFor(overrides.stripTracks.map((track) => track.id)),
        inputMonitoredTrackIds: new Set(),
        // The default keeps every existing case's ordinal reading unchanged:
        // only the fixtures for #4180 that actually drop a sibling from the
        // live strip list need to pass a real `projectTracks` of their own.
        projectTracks: overrides.stripTracks,
        ...overrides,
    });
}

function carrierOf(overrides: Partial<StripCarriersInput> & { stripTracks: readonly Track[] }, trackId: string) {
    return carriersOf(overrides).get(trackId);
}

describe('projectStripCarriers', () => {
    it('carries a playing track with an empty chain straight out to master natively', () => {
        expect(carrierOf({ stripTracks: [createTrack({ id: 'audio-1' })] }, 'audio-1')).toEqual({ carrier: 'native' });
    });

    it('leaves a bus out of the answer entirely, because the two carriers share it', () => {
        const carriers = carriersOf({
            stripTracks: [createTrack({ id: 'audio-1' }), createTrack({ id: 'bus-1', kind: 'bus' })],
            attachedInstanceIds: new Set(),
            programme: programmeFor(['audio-1', 'bus-1']),
            inputMonitoredTrackIds: new Set(),
        });

        expect([...carriers.keys()]).toEqual(['audio-1']);
    });

    // Rule 1. Nothing to play is not a defect and must not read as a missing
    // plugin, which is why it is reported before any of the chain rules.
    it('leaves a track with nothing scheduled on Web Audio, and says so', () => {
        const carriers = carriersOf({
            stripTracks: [createTrack({ id: 'audio-1', devices: [pluginDevice({ id: 'd', name: 'Valhalla' })] })],
            attachedInstanceIds: new Set(),
            programme: programmeFor([]),
            inputMonitoredTrackIds: new Set(),
        });

        expect(carriers.get('audio-1')).toEqual({ carrier: 'web', reason: 'nothing scheduled' });
    });

    // Rule 1, the other half: "nothing to play" is about the strip having
    // nothing to sound, and a plugin the engine holds sounds on its own —
    // instruments are spliced into the chain as generators. Web Audio builds no
    // body for a hosted plugin at all, so a clip-less track sent there over this
    // rule is a track nothing voices for the whole take.
    it('carries a clip-less track whose hosted plugin the engine already holds', () => {
        const carriers = carriersOf({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    devices: [pluginDevice({ id: 'd', name: 'Harness Tone', instanceId: 'i1' })],
                }),
            ],
            attachedInstanceIds: new Set(['i1']),
            programme: programmeFor([]),
            inputMonitoredTrackIds: new Set(),
        });

        expect(carriers.get('audio-1')).toEqual({ carrier: 'native' });
    });

    // Rule 1, the bound on that half. The native programme drops an audio clip
    // whose material is not decoded, whose expansion overruns the strip's clip
    // ceiling, or whose frozen bake is missing, and names the strip web-voiced
    // for it. Carrying such a strip natively for its plugin's sake gates the
    // Web Audio strip still playing that material out of the mix.
    it('leaves a track whose clips Web Audio voices on Web Audio, however attached its plugin', () => {
        const carriers = carriersOf({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    devices: [pluginDevice({ id: 'd', name: 'Harness Tone', instanceId: 'i1' })],
                }),
            ],
            attachedInstanceIds: new Set(['i1']),
            programme: programmeFor([], [], ['audio-1']),
            inputMonitoredTrackIds: new Set(),
        });

        expect(carriers.get('audio-1')).toEqual({ carrier: 'web', reason: 'its clips play on Web Audio' });
    });

    // A clip-less MIDI track with an attached instrument is the live-keys case:
    // no clip is scheduled and none ever will be, but the engine holds the
    // plugin the notes are addressed to, so the strip is the engine's to voice
    // (#3892). Leaving it on Web Audio would double a part the engine plays.
    it('carries a clip-less MIDI track natively when its instrument plugin is attached', () => {
        const carriers = carriersOf({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    kind: 'midi',
                    devices: [pluginDevice({ id: 'd', name: 'Harness Tone', instanceId: 'i1' })],
                }),
            ],
            attachedInstanceIds: new Set(['i1']),
            programme: programmeFor([]),
            inputMonitoredTrackIds: new Set(),
        });

        expect(carriers.get('audio-1')).toEqual({ carrier: 'native' });
    });

    // The producer, not the kind, decides which MIDI strips stay web-voiced: a
    // strip it names is one it could not carry, and the reason it is given is
    // the one every web-voiced strip gets rather than a claim about MIDI as
    // such, which is no longer true of MIDI as such.
    it('names the clips for a MIDI strip the MIDI producer could not carry', () => {
        const carriers = carriersOf({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    kind: 'midi',
                    devices: [pluginDevice({ id: 'd', name: 'Harness Tone', instanceId: 'i1' })],
                }),
            ],
            attachedInstanceIds: new Set(['i1']),
            programme: programmeFor([], [], ['audio-1']),
            inputMonitoredTrackIds: new Set(),
        });

        expect(carriers.get('audio-1')).toEqual({ carrier: 'web', reason: 'its clips play on Web Audio' });
    });

    // The plugin that carries a clip-less strip past rule 1 is the *attached*
    // one. A device naming an instance the engine does not hold names nothing
    // that could sound, so the strip is as unscheduled as one with no plugin.
    it('leaves a clip-less track whose plugin names an instance the engine does not hold on Web Audio', () => {
        const carriers = carriersOf({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    devices: [pluginDevice({ id: 'd', name: 'Harness Tone', instanceId: 'i1' })],
                }),
            ],
            attachedInstanceIds: new Set(),
            programme: programmeFor([]),
            inputMonitoredTrackIds: new Set(),
        });

        expect(carriers.get('audio-1')).toEqual({ carrier: 'web', reason: 'nothing scheduled' });
    });

    // Web-voiced material is not a reason of its own: with no plugin on the
    // chain the strip never reached the question, and the musician is told the
    // first thing that is true of it.
    it('tells a web-voiced track with no plugin that nothing is scheduled', () => {
        const carriers = carriersOf({
            stripTracks: [createTrack({ id: 'audio-1', kind: 'midi' })],
            attachedInstanceIds: new Set(),
            programme: programmeFor([], [], ['audio-1']),
            inputMonitoredTrackIds: new Set(),
        });

        expect(carriers.get('audio-1')).toEqual({ carrier: 'web', reason: 'nothing scheduled' });
    });

    // Getting a track past rule 1 is not getting it past the law: the rules
    // after it answer for a clip-less track exactly as they do for a playing
    // one, in the order they always did.
    it('leaves a clip-less track carrying an attached plugin on Web Audio while its input is monitored', () => {
        const carriers = carriersOf({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    devices: [pluginDevice({ id: 'd', name: 'Harness Tone', instanceId: 'i1' })],
                }),
            ],
            attachedInstanceIds: new Set(['i1']),
            programme: programmeFor([]),
            inputMonitoredTrackIds: new Set(['audio-1']),
        });

        expect(carriers.get('audio-1')).toEqual({ carrier: 'web', reason: 'input monitoring is on' });
    });

    it('judges the whole chain of a clip-less track its attached plugin carried past rule 1', () => {
        const carriers = carriersOf({
            stripTracks: [
                createTrack({
                    id: 'audio-1',
                    devices: [
                        pluginDevice({ id: 'd', name: 'Harness Tone', instanceId: 'i1' }),
                        createDevice({ id: 'd2', type: 'builtin-eq' }),
                    ],
                }),
            ],
            attachedInstanceIds: new Set(['i1']),
            programme: programmeFor([]),
            inputMonitoredTrackIds: new Set(),
        });

        expect(carriers.get('audio-1')).toEqual({ carrier: 'web', reason: 'device builtin-eq has no native body' });
    });

    // Rule 2. The live input reaches the Web Audio strip and nothing else, so
    // gating that strip would take a musician's own signal out of their
    // headphones mid-take.
    it('leaves an input-monitored track on Web Audio however representable its chain is', () => {
        const carrier = carrierOf(
            {
                stripTracks: [createTrack({ id: 'audio-1' })],
                inputMonitoredTrackIds: new Set(['audio-1']),
            },
            'audio-1'
        );

        expect(carrier).toEqual({ carrier: 'web', reason: 'input monitoring is on' });
    });

    // Rule 3, the built-in half.
    it('leaves a track carrying a device with no native body on Web Audio, naming the type', () => {
        const carrier = carrierOf(
            { stripTracks: [createTrack({ id: 'audio-1', devices: [createDevice({ id: 'd', type: 'builtin-eq' })] })] },
            'audio-1'
        );

        expect(carrier).toEqual({ carrier: 'web', reason: 'device builtin-eq has no native body' });
    });

    it('carries a track whose whole chain the engine builds', () => {
        const carrier = carrierOf(
            { stripTracks: [createTrack({ id: 'audio-1', devices: [nativeDevice('d')] })] },
            'audio-1'
        );

        expect(carrier).toEqual({ carrier: 'native' });
    });

    // The Tuner is a body like any other now that the engine builds one, and
    // it is the analyser most likely to be sitting on a strip while the take
    // rolls — a player checks their tuning and leaves the device in the chain.
    // Leaving that strip on Web Audio for a pass-through analyser would cost
    // the take its native timeline for a device that changes nothing about the
    // signal.
    it('carries a track whose chain holds a tuner', () => {
        const carrier = carrierOf(
            {
                stripTracks: [
                    createTrack({ id: 'audio-1', devices: [createDevice({ id: 'd', type: 'native-scoring' })] }),
                ],
            },
            'audio-1'
        );

        expect(carrier).toEqual({ carrier: 'native' });
    });

    // Every built-in the engine registers is a body, not only the effect it
    // started with: a strip playing clips through an instrument insert is one
    // the engine can build whole, and leaving it on Web Audio for a body the
    // engine was ready to run costs the take its native timeline.
    it('carries a playing track whose chain holds a built-in instrument', () => {
        const carrier = carrierOf(
            { stripTracks: [createTrack({ id: 'audio-1', devices: [nativeInstrumentDevice('d')] })] },
            'audio-1'
        );

        expect(carrier).toEqual({ carrier: 'native' });
    });

    // The engine addresses notes to any device holding a note store, and a
    // built-in instrument holds one by type alone — it needs no attach state
    // the way a hosted plugin does. A clip-less MIDI strip whose only body is
    // a built-in instrument is therefore the engine's to voice, exactly like
    // one carrying an attached instrument plugin.
    it('carries a clip-less MIDI track whose only body is a built-in instrument natively', () => {
        const carriers = carriersOf({
            stripTracks: [createTrack({ id: 'audio-1', kind: 'midi', devices: [nativeInstrumentDevice('d')] })],
            attachedInstanceIds: new Set(),
            programme: programmeFor([]),
            inputMonitoredTrackIds: new Set(),
        });

        expect(carriers.get('audio-1')).toEqual({ carrier: 'native' });
    });

    // The sampler is the one body the engine builds from staged material
    // rather than from its record, and it used to be the reason an orchestral
    // strip stayed on Web Audio. It is a native instrument like any other now:
    // the bank reaches the store before the batch that maps the device.
    it('carries an orchestral sampler strip natively', () => {
        const carriers = carriersOf({
            stripTracks: [
                createTrack({ id: 'audio-1', kind: 'midi', devices: [createDevice({ id: 'd', type: 'levain' })] }),
            ],
            attachedInstanceIds: new Set(),
            programme: programmeFor([]),
            inputMonitoredTrackIds: new Set(),
        });

        expect(carriers.get('audio-1')).toEqual({ carrier: 'native' });
    });

    // The bound on that: a built-in *effect* is still not something for a
    // clip-less strip to sound. It processes an input and generates nothing on
    // its own, so a strip whose only body is one is as unscheduled as a strip
    // with no body at all.
    it('leaves a clip-less track whose only body is a built-in effect on Web Audio', () => {
        const carriers = carriersOf({
            stripTracks: [createTrack({ id: 'audio-1', kind: 'midi', devices: [nativeDevice('d')] })],
            attachedInstanceIds: new Set(),
            programme: programmeFor([]),
            inputMonitoredTrackIds: new Set(),
        });

        expect(carriers.get('audio-1')).toEqual({ carrier: 'web', reason: 'nothing scheduled' });
    });

    // The MIDI producer's own qualification, not the device kind, decides
    // which strips stay web-voiced — same bound as the hosted-plugin case
    // above, now for a built-in instrument.
    it("leaves a MIDI track whose built-in instrument's clips Web Audio voices on Web Audio", () => {
        const carriers = carriersOf({
            stripTracks: [createTrack({ id: 'audio-1', kind: 'midi', devices: [nativeInstrumentDevice('d')] })],
            attachedInstanceIds: new Set(),
            programme: programmeFor([], [], ['audio-1']),
            inputMonitoredTrackIds: new Set(),
        });

        expect(carriers.get('audio-1')).toEqual({ carrier: 'web', reason: 'its clips play on Web Audio' });
    });

    // Rule 3, the plugin half: a plugin has a native body exactly when the
    // engine reports the instance attached.
    it('carries a track whose plugin the engine already holds', () => {
        const carrier = carrierOf(
            {
                stripTracks: [
                    createTrack({ id: 'audio-1', devices: [pluginDevice({ id: 'd', name: 'V', instanceId: 'i1' })] }),
                ],
                attachedInstanceIds: new Set(['i1']),
            },
            'audio-1'
        );

        expect(carrier).toEqual({ carrier: 'native' });
    });

    it('leaves a track whose plugin the engine has not taken on Web Audio, naming the plugin', () => {
        const carrier = carrierOf(
            {
                stripTracks: [
                    createTrack({
                        id: 'audio-1',
                        devices: [pluginDevice({ id: 'd', name: 'Valhalla', instanceId: 'i1' })],
                    }),
                ],
                attachedInstanceIds: new Set(),
            },
            'audio-1'
        );

        expect(carrier).toEqual({ carrier: 'web', reason: 'plugin "Valhalla" is not attached to the engine' });
    });

    it('passes a frozen strip, whose bake replaces the chain rather than feeding it', () => {
        const carriers = carriersOf({
            stripTracks: [createTrack({ id: 'audio-1', devices: [createDevice({ id: 'd', type: 'builtin-eq' })] })],
            attachedInstanceIds: new Set(),
            programme: programmeFor(['audio-1'], ['audio-1']),
            inputMonitoredTrackIds: new Set(),
        });

        expect(carriers.get('audio-1')).toEqual({ carrier: 'native' });
    });

    // Rule 4. The native engine would play this track through a bus missing the
    // processing the project puts there, which is a different mix rather than a
    // late one.
    it('leaves a track routed through a bus the engine cannot build on Web Audio', () => {
        const carrier = carrierOf(
            {
                stripTracks: [
                    createTrack({ id: 'audio-1', outputId: 'bus-1' }),
                    createTrack({
                        id: 'bus-1',
                        kind: 'bus',
                        name: 'Reverb Bus',
                        devices: [createDevice({ id: 'd', type: 'builtin-reverb' })],
                    }),
                ],
            },
            'audio-1'
        );

        expect(carrier).toEqual({
            carrier: 'web',
            reason: 'output path through "Reverb Bus" holds builtin-reverb',
        });
    });

    it('follows the output path past a representable bus to the one that stops it', () => {
        const carrier = carrierOf(
            {
                stripTracks: [
                    createTrack({ id: 'audio-1', outputId: 'bus-1' }),
                    createTrack({
                        id: 'bus-1',
                        kind: 'bus',
                        name: 'Sub Bus',
                        outputId: 'bus-2',
                        devices: [nativeDevice('ok')],
                    }),
                    createTrack({
                        id: 'bus-2',
                        kind: 'bus',
                        name: 'Master Bus',
                        devices: [pluginDevice({ id: 'd', name: 'Glue' })],
                    }),
                ],
            },
            'audio-1'
        );

        expect(carrier).toEqual({
            carrier: 'web',
            reason: 'output path through "Master Bus" holds plugin "Glue", not attached to the engine',
        });
    });

    it('carries a track through a bus chain the engine can build all the way to master', () => {
        const carrier = carrierOf(
            {
                stripTracks: [
                    createTrack({ id: 'audio-1', outputId: 'bus-1' }),
                    createTrack({ id: 'bus-1', kind: 'bus', devices: [nativeDevice('ok')] }),
                ],
            },
            'audio-1'
        );

        expect(carrier).toEqual({ carrier: 'native' });
    });

    // A track may be routed into another *track*, not only into a bus, and
    // `resolveOutputTarget` answers `kind: 'track'` for it. The obstruction walk
    // has to follow that edge too: a rule that only ever looked at buses would
    // call this track native and let the engine play it through a strip missing
    // the processing the project puts there.
    it('follows an output path that targets another track, not a bus', () => {
        const carriers = carriersOf({
            stripTracks: [
                createTrack({ id: 'audio-1', outputId: 'audio-2' }),
                createTrack({
                    id: 'audio-2',
                    name: 'Guitar Sub',
                    devices: [createDevice({ id: 'd', type: 'builtin-reverb' })],
                }),
            ],
        });

        expect(carriers.get('audio-1')).toEqual({
            carrier: 'web',
            reason: 'output path through "Guitar Sub" holds builtin-reverb',
        });
        // The target's own reason names its chain rather than its path, which is
        // what proves the walk stepped onto it instead of stopping at the source.
        expect(carriers.get('audio-2')).toEqual({
            carrier: 'web',
            reason: 'device builtin-reverb has no native body',
        });
    });

    // Rule 5. A send that reaches an unrepresentable bus is audio the native
    // engine would drop rather than delay.
    it('leaves a track sending into a bus the engine cannot build on Web Audio', () => {
        const carrier = carrierOf(
            {
                stripTracks: [
                    createTrack({
                        id: 'audio-1',
                        sends: [{ busId: 'bus-1', level: 0.5, preFader: false }],
                    }),
                    createTrack({
                        id: 'bus-1',
                        kind: 'bus',
                        name: 'Plate',
                        devices: [createDevice({ id: 'd', type: 'builtin-reverb' })],
                    }),
                ],
            },
            'audio-1'
        );

        expect(carrier).toEqual({ carrier: 'web', reason: 'send to "Plate" holds builtin-reverb' });
    });

    it('ignores a send naming no built bus, which carries no audio path either', () => {
        const carrier = carrierOf(
            {
                stripTracks: [
                    createTrack({ id: 'audio-1', sends: [{ busId: 'bus-gone', level: 0.5, preFader: false }] }),
                ],
            },
            'audio-1'
        );

        expect(carrier).toEqual({ carrier: 'native' });
    });

    // A project can route a bus back into the track feeding it. The recursion
    // has to stop rather than run the stack out.
    it('answers a routing cycle with a reason instead of recursing forever', () => {
        const carrier = carrierOf(
            {
                stripTracks: [
                    createTrack({ id: 'audio-1', outputId: 'bus-1' }),
                    createTrack({ id: 'bus-1', kind: 'bus', outputId: 'bus-2' }),
                    createTrack({ id: 'bus-2', kind: 'bus', outputId: 'bus-1' }),
                ],
            },
            'audio-1'
        );

        expect(carrier).toEqual({ carrier: 'web', reason: 'output path loops' });
    });

    // Crumbs is the built-in the engine splices rather than builds (#4204): the
    // mapper borrows the instance `commands::crumbs` holds, under the device's
    // own id, and refuses the device by name when it holds none. Answering it
    // from `nativeBuiltinBodies` — where it deliberately has no row — carried
    // every Crumbs strip to a batch the mapper refuses.
    it('carries a track whose Crumbs instance the engine reports attached', () => {
        const carrier = carrierOf(
            {
                stripTracks: [createTrack({ id: 'audio-1', devices: [crumbsDevice({ id: 'd-crumbs' })] })],
                attachedInstanceIds: new Set(['d-crumbs']),
            },
            'audio-1'
        );

        expect(carrier).toEqual({ carrier: 'native' });
    });

    it('leaves a track whose Crumbs instance the engine does not hold on Web Audio, and names the sampler', () => {
        const carrier = carrierOf(
            {
                stripTracks: [
                    createTrack({ id: 'audio-1', devices: [crumbsDevice({ id: 'd-crumbs', name: 'Break Kit' })] }),
                ],
                attachedInstanceIds: new Set(),
            },
            'audio-1'
        );

        expect(carrier).toEqual({
            carrier: 'web',
            reason: 'Crumbs sampler "Break Kit" is not attached to the engine',
        });
    });

    // The attach set is keyed by device id for a Crumbs device, so a set
    // carrying some other id must not answer for it.
    it('does not carry a Crumbs device on another instance id being attached', () => {
        const carrier = carrierOf(
            {
                stripTracks: [createTrack({ id: 'audio-1', devices: [crumbsDevice({ id: 'd-crumbs' })] })],
                attachedInstanceIds: new Set(['some-other-instance']),
            },
            'audio-1'
        );

        expect(carrier).toEqual({
            carrier: 'web',
            reason: 'Crumbs sampler "d-crumbs" is not attached to the engine',
        });
    });

    // The label travels through a different sentence than `chainReason`, and a
    // route obstructed by a sampler must name it as one rather than fall back
    // to "device builtin-crumbs", which would claim the engine has no body for
    // the type at all.
    it('names an unattached Crumbs device on the output path as a sampler', () => {
        const carrier = carrierOf(
            {
                stripTracks: [
                    createTrack({ id: 'audio-1', outputId: 'bus-1' }),
                    createTrack({
                        id: 'bus-1',
                        kind: 'bus',
                        name: 'Drum Bus',
                        devices: [crumbsDevice({ id: 'd-crumbs', name: 'Break Kit' })],
                    }),
                ],
                attachedInstanceIds: new Set(),
            },
            'audio-1'
        );

        expect(carrier).toEqual({
            carrier: 'web',
            reason: 'output path through "Drum Bus" holds Crumbs sampler "Break Kit", not attached to the engine',
        });
    });

    // Toaster pad bindings (#4180). The native graph has no multi-output
    // device and no child strip, so a Toaster whose pads reach child tracks is
    // unrepresentable on either strip — the check runs first, ahead of rule 1,
    // so the reason a musician reads names the actual obstruction rather than
    // "nothing scheduled".
    it('keeps a Toaster and its pad-bound child on Web Audio, each naming the other', () => {
        const stripTracks = [
            createTrack({
                id: 'toaster-1',
                name: 'Drum Toaster',
                devices: [createDevice({ id: 'd', type: 'toaster' })],
            }),
            createTrack({ id: 'pad-1', parentId: 'toaster-1' }),
        ];
        const carriers = projectStripCarriers({
            stripTracks,
            projectTracks: stripTracks,
            attachedInstanceIds: new Set(),
            programme: programmeFor(['toaster-1', 'pad-1']),
            inputMonitoredTrackIds: new Set(),
        });

        expect(carriers.get('toaster-1')).toEqual({ carrier: 'web', reason: 'its pads route to child tracks' });
        expect(carriers.get('pad-1')).toEqual({ carrier: 'web', reason: 'it plays a pad of "Drum Toaster"' });
    });

    // A Toaster with no children is exactly the built-in-instrument case rule 3
    // already carries: nothing about this rule touches it.
    it('carries a Toaster track with no child tracks natively', () => {
        const carrier = carrierOf(
            {
                stripTracks: [createTrack({ id: 'toaster-1', devices: [createDevice({ id: 'd', type: 'toaster' })] })],
            },
            'toaster-1'
        );

        expect(carrier).toEqual({ carrier: 'native' });
    });

    // The rule is Toaster-specific: a child of a track that hosts no Toaster
    // gets no pad-binding answer and falls through to the ordinary rules.
    // Mutation this must catch: dropping the `hostsToaster` requirement so any
    // track with children answers web — `parent-1` would then read `web`.
    it('leaves a child track whose parent hosts no Toaster to the ordinary rules', () => {
        const carriers = carriersOf({
            stripTracks: [
                createTrack({ id: 'parent-1', devices: [nativeDevice('d')] }),
                createTrack({ id: 'child-1', parentId: 'parent-1' }),
            ],
        });

        expect(carriers.get('child-1')).toEqual({ carrier: 'native' });
        expect(carriers.get('parent-1')).toEqual({ carrier: 'native' });
    });

    // The pad ordinal is counted over the full project track list, the same
    // list routing binds pads over (`setTrackOutput.ts`,
    // `refreshToasterPadBindings.ts`, `compileTrackStripInitializationSnapshot.ts`),
    // not over the shorter live-strip list: a nested plain folder builds no
    // live strip but still occupies a pad slot, so it shifts every later
    // child's ordinal on the strip list without shifting it in `projectTracks`.
    // Mutation this must catch: resolving over `stripTracks` again, which
    // would count `child-16` as ordinal 15 (bound) instead of ordinal 16
    // (unbound, past the 16-pad limit).
    it('counts the pad ordinal over the full project track list, not the live-strip list', () => {
        const toaster = createTrack({
            id: 'toaster-1',
            name: 'Drum Toaster',
            devices: [createDevice({ id: 'd', type: 'toaster' })],
        });
        // A nested plain folder: a project track with no live strip of its own.
        const noStripChild = createTrack({ id: 'child-0', kind: 'folder', parentId: 'toaster-1', devices: [] });
        const children = Array.from({ length: 16 }, (_, index) =>
            createTrack({ id: `child-${index + 1}`, parentId: 'toaster-1' })
        );
        const projectTracks = [toaster, noStripChild, ...children];
        const stripTracks = [toaster, ...children];

        const carriers = carriersOf({ stripTracks, projectTracks });

        // Ordinal 16 on the full project list (toaster, child-0..child-16):
        // past the 16-pad limit, so the binding leaves it unbound, exactly as
        // routing does.
        expect(carriers.get('child-16')).toEqual({ carrier: 'native' });
        expect(carriers.get('child-1')).toEqual({
            carrier: 'web',
            reason: 'it plays a pad of "Drum Toaster"',
        });
        expect(carriers.get('toaster-1')).toEqual({ carrier: 'web', reason: 'its pads route to child tracks' });
    });

    // The parent-hosts-children check must read `projectTracks`, not
    // `stripTracks`: a disabled child drops out of the live strip list but
    // still occupies a pad slot for routing, so the Toaster is still
    // unrepresentable even though its only child builds no live strip.
    // Mutation this must catch: reading `stripTracks` instead of
    // `projectTracks` for this check, which would carry `toaster-1` natively
    // because it would see no children at all.
    it('keeps a Toaster on Web Audio when its only child is absent from stripTracks but present in projectTracks', () => {
        const toaster = createTrack({
            id: 'toaster-1',
            name: 'Drum Toaster',
            devices: [createDevice({ id: 'd', type: 'toaster' })],
        });
        const child = createTrack({ id: 'child-1', parentId: 'toaster-1', disabled: true });
        const carriers = carriersOf({
            stripTracks: [toaster],
            projectTracks: [toaster, child],
        });

        expect(carriers.get('toaster-1')).toEqual({ carrier: 'web', reason: 'its pads route to child tracks' });
    });

    // The parent's name is likewise read from `projectTracks`, not the
    // live-strip map: a disabled Toaster folder builds no live strip at all
    // (`readLiveStripTracks` filters `!track.disabled`), so a bound child
    // still names it. Mutation this must catch: naming the parent from
    // `context.stripById` instead of `context.projectTrackById`, which would
    // answer `null` here because the disabled parent has no live strip.
    it("names a pad child's disabled Toaster parent from the project track list", () => {
        const toaster = createTrack({
            id: 'toaster-1',
            name: 'Drum Toaster',
            disabled: true,
            devices: [createDevice({ id: 'd', type: 'toaster' })],
        });
        const pad = createTrack({ id: 'pad-1', parentId: 'toaster-1' });
        const carriers = carriersOf({
            stripTracks: [pad],
            projectTracks: [toaster, pad],
        });

        expect(carriers.get('pad-1')).toEqual({ carrier: 'web', reason: 'it plays a pad of "Drum Toaster"' });
        expect(carriers.get('toaster-1')).toBeUndefined();
    });
});
