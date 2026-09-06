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
        const carriers = projectStripCarriers({
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
        const carriers = projectStripCarriers({
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
        const carriers = projectStripCarriers({
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
        const carriers = projectStripCarriers({
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
        const carriers = projectStripCarriers({
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
        const carriers = projectStripCarriers({
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
        const carriers = projectStripCarriers({
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
        const carriers = projectStripCarriers({
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
        const carriers = projectStripCarriers({
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
        const carriers = projectStripCarriers({
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

    // The bound on that: a built-in body is not something for a clip-less strip
    // to sound. The engine addresses a strip's notes to a plugin instance, so a
    // MIDI strip whose only body is a built-in instrument has no note reaching
    // it, and carrying it natively would silence the part Web Audio still
    // voices (#3893).
    it('leaves a clip-less MIDI track whose only body is a built-in instrument on Web Audio', () => {
        const carriers = projectStripCarriers({
            stripTracks: [createTrack({ id: 'audio-1', kind: 'midi', devices: [nativeInstrumentDevice('d')] })],
            attachedInstanceIds: new Set(),
            programme: programmeFor([]),
            inputMonitoredTrackIds: new Set(),
        });

        expect(carriers.get('audio-1')).toEqual({ carrier: 'web', reason: 'nothing scheduled' });
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
        const carriers = projectStripCarriers({
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
});
