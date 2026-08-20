/**
 * The engine choice itself, and the promise attached to it (#2225).
 *
 * `selectOfflineRenderEngine` is where a desktop export decides whether the
 * native engine takes it, and the file's own header makes two promises about
 * that decision:
 *
 *   1. **Every web answer carries a reason**, and a *degraded* one — a native
 *      engine that existed here and was passed over — reaches the user. The
 *      last case below measures that end to end, through `renderOffline` and
 *      out of `onWarning`, because a reason nobody surfaces is not
 *      observability.
 *   2. **A content gate degrades instead of exporting into a native refusal.**
 *      Each gate therefore gets a case that names the shape it refuses, so a
 *      gate deleted or narrowed reds here rather than in a bounce that falls
 *      back after building the whole graph twice.
 *
 * Only the probe is mocked. The gates run against real `Track` values, because
 * the gate predicates read project fields and a stubbed project would let a
 * gate that reads the wrong field pass.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { type Track, type TrackStoreState } from '#/modules/Arrangement/stores';
import { LEGACY_MIDI_PROBABILITY_SEED, type MidiStoreState } from '#/modules/MIDI/stores';
import { type TransportState } from '#/modules/Transport/stores';

import { type NativeGraphTransport } from '../../../repositories/nativeGraph/nativeGraphTransport';
import { type NativeGraphAvailability } from '../../../repositories/nativeGraph/probeNativeGraphTransport';
import { renderOffline } from '../../renderOffline';
import { type OfflineRenderContext } from '../resolveRenderContext';
import { selectOfflineRenderEngine } from '../selectOfflineRenderEngine';

import { createNullTestRenderHarness } from './nullTestRenderHarness';

const mocks = vi.hoisted(() => {
    const state: {
        /** What `probeNativeGraphTransport` answers. The whole desktop half. */
        availability: unknown;
        /** The project `renderOffline` resolves, for the last case only. */
        renderContext: unknown;
    } = { availability: null, renderContext: null };
    return state;
});

vi.mock('../../../repositories/nativeGraph/probeNativeGraphTransport', () => ({
    probeNativeGraphTransport: () => Promise.resolve(mocks.availability as NativeGraphAvailability),
}));

vi.mock('../resolveRenderContext', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../resolveRenderContext')>();
    return { ...actual, resolveRenderContext: () => mocks.renderContext as OfflineRenderContext };
});

/**
 * Stands in for the addon's transport. Every method throws: the selection
 * issues no command, and a case that started issuing one would say so here
 * rather than pass on a silently permissive stub.
 */
const stubTransport: NativeGraphTransport = {
    registerTimelineSample: () => Promise.reject(new Error('the selection spec issues no command')),
    renderGraphOffline: () => Promise.reject(new Error('the selection spec issues no command')),
    mapGraphBatch: () => Promise.reject(new Error('the selection spec issues no command')),
    applyGraphCommands: () => Promise.reject(new Error('the selection spec issues no command')),
};

// Field-identical replica of Arrangement's TrackDummy fixture — foreign test
// fixtures have no compliant cross-module path (models are not re-exported).
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

function createClip(
    overrides: Partial<Track['clips'][number]> & { id: string; trackId: string }
): Track['clips'][number] {
    return {
        name: overrides.id,
        startBeat: 0,
        endBeat: 1,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#00ff00',
        locked: false,
        muted: false,
        ...overrides,
    };
}

/** A project the native engine can hold: no gate applies. */
function cleanProject(): { renderableTracks: Track[]; scheduledTracks: Track[] } {
    const track = createTrack({
        id: 'track-a',
        clips: [createClip({ id: 'clip-a', trackId: 'track-a', audioBufferId: 'mat-a' })],
        sends: [{ busId: 'bus-1', level: 0.5, preFader: false }] as Track['sends'],
    });
    const bus = createTrack({ id: 'bus-1', name: 'Bus 1', kind: 'bus' });
    return { renderableTracks: [track, bus], scheduledTracks: [track] };
}

describe('selectOfflineRenderEngine — the choice and its reason (#2225)', () => {
    beforeEach(() => {
        mocks.availability = { available: false, reason: 'no desktop bridge (browser runtime)', runtime: 'browser' };
        mocks.renderContext = null;
    });

    it('renders a browser export through Web Audio without calling it a degradation', async () => {
        const selection = await selectOfflineRenderEngine(cleanProject());

        expect(selection).toEqual({
            engine: 'web-audio/offline',
            reason: 'no desktop bridge (browser runtime)',
            degraded: false,
        });
    });

    it('degrades a desktop export whose addon does not answer, and keeps the probe reason', async () => {
        mocks.availability = {
            available: false,
            reason: 'native graph commands unavailable: addon not loaded',
            runtime: 'desktop',
        };

        const selection = await selectOfflineRenderEngine(cleanProject());

        expect(selection).toEqual({
            engine: 'web-audio/offline',
            reason: 'native graph commands unavailable: addon not loaded',
            degraded: true,
        });
    });

    it('hands a healthy desktop export of a holdable project to the native engine', async () => {
        mocks.availability = { available: true, transport: stubTransport };

        const selection = await selectOfflineRenderEngine(cleanProject());

        // The transport identity matters: the caller renders through exactly
        // the transport the probe proved, never a second one it constructs.
        expect(selection).toEqual({ engine: 'native/offline', transport: stubTransport });
    });

    describe('content gates — a shape the native engine refuses degrades instead', () => {
        /**
         * One case per clause of `contentGateReason`. The expected text is the
         * clause's own vocabulary, not a paraphrase: it is what the user reads
         * on `onWarning`, so a reason quietly reworded should red.
         */
        const cases: {
            name: string;
            project: () => { renderableTracks: Track[]; scheduledTracks: Track[] };
            reason: string;
        }[] = [
            {
                name: 'a frozen track',
                project: () => {
                    const track = createTrack({
                        id: 'track-a',
                        name: 'Frozen A',
                        frozen: true,
                        freezeState: { status: 'frozen', frozenBufferId: 'freeze-1' },
                    });
                    return { renderableTracks: [track], scheduledTracks: [track] };
                },
                reason: 'track "Frozen A" is frozen and replays a pre-rendered buffer',
            },
            {
                name: 'a device chain',
                project: () => {
                    const track = createTrack({
                        id: 'track-a',
                        name: 'Chained A',
                        devices: [
                            {
                                id: 'device-1',
                                name: 'Gain',
                                type: 'builtin-gain',
                                bypassed: false,
                                parameterValues: {},
                            },
                        ],
                    });
                    return { renderableTracks: [track], scheduledTracks: [track] };
                },
                reason: 'track "Chained A" carries a device chain',
            },
            {
                name: 'MIDI programme',
                project: () => {
                    const track = createTrack({
                        id: 'track-a',
                        name: 'Keys A',
                        clips: [createClip({ id: 'clip-a', trackId: 'track-a', type: 'midi' })],
                    });
                    return { renderableTracks: [track], scheduledTracks: [track] };
                },
                reason: 'track "Keys A" plays MIDI programme',
            },
            {
                name: 'a time-stretched clip',
                project: () => {
                    const track = createTrack({
                        id: 'track-a',
                        name: 'Stretched A',
                        clips: [
                            createClip({
                                id: 'clip-a',
                                trackId: 'track-a',
                                stretchMode: 'repitch',
                                stretchRatio: 1.5,
                            }),
                        ],
                    });
                    return { renderableTracks: [track], scheduledTracks: [track] };
                },
                reason: 'clip "clip-a" on track "Stretched A" is time-stretched (#2219)',
            },
            {
                name: 'a shaped bus',
                project: () => {
                    const bus = createTrack({ id: 'bus-1', name: 'Wide', kind: 'bus', pan: 25 });
                    return { renderableTracks: [bus], scheduledTracks: [] };
                },
                reason: 'bus "Wide" is panned or muted, which the native bus strip cannot hold',
            },
            {
                name: 'a send configured on a bus',
                project: () => {
                    const source = createTrack({
                        id: 'bus-1',
                        name: 'Cue',
                        kind: 'bus',
                        sends: [{ busId: 'bus-2', level: 0.4, preFader: false }] as Track['sends'],
                    });
                    const target = createTrack({ id: 'bus-2', name: 'Verb', kind: 'bus' });
                    return { renderableTracks: [source, target], scheduledTracks: [] };
                },
                reason: 'bus "Cue" carries a send, which the native bus strip has no tap for',
            },
            {
                name: 'a bus routed into a track',
                project: () => {
                    const track = createTrack({ id: 'track-a', name: 'Sum A' });
                    const bus = createTrack({
                        id: 'bus-1',
                        name: 'Feeder',
                        kind: 'bus',
                        outputId: 'track-a',
                    });
                    return { renderableTracks: [track, bus], scheduledTracks: [] };
                },
                reason: 'bus "Feeder" routes into a track, which the native engine refuses',
            },
        ];

        it.each(cases)('degrades $name with its own reason', async ({ project, reason }) => {
            mocks.availability = { available: true, transport: stubTransport };

            const selection = await selectOfflineRenderEngine(project());

            expect(selection).toEqual({ engine: 'web-audio/offline', reason, degraded: true });
        });
    });

    describe('the reason reaches the user', () => {
        const emptyMidi: NonNullable<MidiStoreState> = {
            probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        beforeEach(() => {
            const harness = createNullTestRenderHarness();
            vi.stubGlobal('OfflineAudioContext', harness.OfflineAudioContext);
            mocks.renderContext = {
                tracks: { tracks: [] } as unknown as TrackStoreState,
                midi: emptyMidi,
                transport: { masterGain: 80 } as TransportState,
                defaultTempo: 120,
                changes: [],
                startBeat: 0,
                durationSeconds: 0.5,
                tailSeconds: 0,
                projectMidiEvents: ({ events }) => events,
                selectMidiEventProbability: () => true,
                projectChordPitch: ({ pitch }) => pitch,
                projectPpqEndpoints: ({ startPpq, endPpq, sampleRate }) => {
                    const startSeconds = startPpq * 0.5;
                    const endSeconds = endPpq * 0.5;
                    return {
                        startSamples: startSeconds * sampleRate,
                        endSamples: endSeconds * sampleRate,
                        durationSamples: (endSeconds - startSeconds) * sampleRate,
                        startSeconds,
                        endSeconds,
                        durationSeconds: endSeconds - startSeconds,
                    };
                },
                processYeastMidi: null,
                evaluateAutomationValue: null,
            } satisfies OfflineRenderContext;
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        it('warns on a degraded desktop export and still delivers the file', async () => {
            mocks.availability = {
                available: false,
                reason: 'native graph commands unavailable: addon not loaded',
                runtime: 'desktop',
            };
            const warnings: string[] = [];

            const buffer = await renderOffline({
                durationBeats: 1,
                sampleRate: 44_100,
                onWarning: (message) => warnings.push(message),
            });

            expect(warnings).toContain(
                'Desktop export fell back to the Web Audio renderer: ' +
                    'native graph commands unavailable: addon not loaded'
            );
            expect(buffer.length).toBeGreaterThan(0);
        });

        it('says nothing about the renderer in a browser, where Web Audio is the platform', async () => {
            const warnings: string[] = [];

            await renderOffline({
                durationBeats: 1,
                sampleRate: 44_100,
                onWarning: (message) => warnings.push(message),
            });

            expect(warnings.filter((message) => message.includes('Web Audio renderer'))).toEqual([]);
        });
    });
});
