import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { forgetStoredControllerEngagements } from '../../../services/storedControllerEngagement';
import { metronomeSchedulingState } from '../../scheduling/metronomeSchedulingState';
import { executePlayheadSeek } from '../../transportControls/executePlayheadSeek';
import { disposePlayheadScheduler } from '../disposePlayheadScheduler';
import { schedulerSession } from '../schedulerSession';
import { startPlayheadScheduler } from '../startPlayheadScheduler';
import { stopPlayheadScheduler } from '../stopPlayheadScheduler';

/**
 * What an instrument ends up holding when stored clip controllers were posted for
 * a look-ahead the playhead then leaves: a follow-action jump, a late loop wrap, a
 * seek while playing, a stop. The scheduler, the real `scheduleMidiNotes`, the real
 * stored-controller projection and the engagement records all run. The engine is a
 * small model of the contract the real queues keep (their own specs, in the
 * AudioEngine module, pin it against `createGrandBouleFrameQueue` and the Levain
 * processor): a framed move waits for its frame, a frameless move applies at once,
 * a move marked `stored` is the only kind `discardStored*` drops, and a frameless
 * stored move supersedes nothing. Every assertion reads the value the instrument
 * holds after the whole queue has drained, not the order of the posts.
 */

type Move = { key: string; value: number; frame: number; stored: boolean };

function createEngineModel() {
    const applied = new Map<string, number>();
    let pending: Move[] = [];
    function advanceTo(frame: number): void {
        const due = pending.filter((move) => move.frame <= frame).sort((a, b) => a.frame - b.frame);
        pending = pending.filter((move) => move.frame > frame);
        for (const move of due) {
            applied.set(move.key, move.value);
        }
    }
    return {
        post(key: string, value: number, frame: number | undefined, stored: boolean): void {
            if (frame === undefined) {
                if (!stored) {
                    pending = pending.filter((move) => move.key !== key);
                }
                applied.set(key, value);
                return;
            }
            pending.push({ key, value, frame, stored });
        },
        discardStored(): void {
            pending = pending.filter((move) => !move.stored);
        },
        advanceTo,
        drainAll: () => advanceTo(Number.POSITIVE_INFINITY),
        value: (key: string) => applied.get(key),
        reset(): void {
            applied.clear();
            pending = [];
        },
    };
}

const engine = createEngineModel();
const callLog: string[] = [];

const transportStoreState: { value: typeof defaultTransportState | null } = { value: null };
const trackStoreState: { value: { tracks: unknown[] } | null } = { value: { tracks: [] } };
const midiStoreState: {
    value: {
        notesByClipId: Record<string, unknown[]>;
        ccByClipId: Record<string, unknown[]>;
        probabilitySeed: number;
    } | null;
} = { value: null };
const ctxTime = { now: 0 };

const SAMPLE_RATE = 48_000;
const audioContextStub = {
    sampleRate: SAMPLE_RATE,
    get currentTime() {
        return ctxTime.now;
    },
    createGain: () => ({ connect: () => {} }),
};

const grandBouleControls = {
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    noteExpression: vi.fn(),
    setSustain: (position: number, frame?: number, stored?: boolean) => {
        callLog.push(
            `sustain ${position} ${frame === undefined ? 'now' : 'framed'}${stored === true ? ' stored' : ''}`
        );
        engine.post('sustain', position, frame, stored === true);
    },
    setSostenuto: vi.fn(),
    setUnaCorda: vi.fn(),
    discardStoredPedals: () => {
        callLog.push('discard');
        engine.discardStored();
    },
};

const levainControls = {
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    noteExpression: vi.fn(),
    handleCc: (cc: number, value: number, frame?: number, stored?: boolean) => {
        callLog.push(`cc${cc} ${value} ${frame === undefined ? 'now' : 'framed'}${stored === true ? ' stored' : ''}`);
        engine.post(`cc${cc}`, value, frame, stored === true);
    },
    discardStoredCc: () => {
        callLog.push('discard');
        engine.discardStored();
    },
};

const trackStripStub = {
    gainNode: {},
    deviceNodes: [] as unknown[],
    preFaderTap: { connect: () => {} },
};

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return trackStoreState.value;
        },
    },
    takeLaneStore: { value: { lanes: [] } },
    activeRecordingRef: { current: [] },
    // Pulled in transitively by the real MIDI barrel this spec runs the projection through.
    persistDeviceParam: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn(),
    appendClipToTrack: vi.fn(),
    resolveEligibleClipWriteTarget: vi.fn(),
    updateClipInStore: vi.fn(),
    clipSelectionStore: { value: null },
}));
vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    midiStore: {
        get value() {
            return midiStoreState.value;
        },
    },
}));
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    resetMidiState: vi.fn(),
}));
vi.mock('../../../stores/transportStore', () => ({
    transportStore: {
        get value() {
            return transportStoreState.value;
        },
        set(next: typeof defaultTransportState | null) {
            transportStoreState.value = next;
        },
    },
}));
vi.mock('../../../stores/tempoMapStore', () => ({ tempoMapStore: { value: { changes: [] } } }));
vi.mock('../../../stores/timeSignatureMapStore', () => ({ timeSignatureMapStore: { value: { changes: [] } } }));
vi.mock('#/modules/Toaster/stores', () => ({ toasterStore: { value: null } }));
vi.mock('#/modules/Automation/stores', () => ({ automationStore: { value: null } }));
vi.mock('#/modules/Automation/useCases', () => ({
    startAutomationRecording: vi.fn(),
    stopAutomationRecording: vi.fn(),
    applyModulation: vi.fn(),
    applyModulationToEngine: vi.fn(),
    getAutomationValueAtBeat: vi.fn(() => null),
    isRecordingAutomation: vi.fn(() => false),
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    discardRecording: vi.fn(),
    startRecording: vi.fn(() => []),
    stopRecording: vi.fn(),
    addTakeLane: vi.fn(),
    addTake: vi.fn(),
    stageRecordingTake: vi.fn(),
    commitRecording: vi.fn(),
    updateClip: vi.fn(),
    resolveClipsWithComping: (_trackId: string, clips: { startBeat: number; endBeat: number }[]) =>
        clips.map((clip) => ({
            ...clip,
            regionStartBeat: clip.startBeat,
            regionEndBeat: clip.endBeat,
            sourceStartBeat: clip.startBeat,
        })),
    getSynthParamsForTrack: () => ({}),
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    startFaustNote: vi.fn(),
    soundsNativeNotes: vi.fn(() => false),
    writeNativeBuiltinParameters: vi.fn(),
    getAudioContext: () => audioContextStub,
    getCurrentTime: () => ctxTime.now,
    scheduleClick: vi.fn(),
    getCompensationDelay: () => 0,
    getDefaultBendRangeSemitones: () => 48,
    getDrumKitByIndex: () => null,
    ensureTrackStrip: () => trackStripStub,
    getTrackStrip: () => trackStripStub,
    applyNoteExpression: vi.fn(),
    registerScheduledSource: vi.fn(),
    scheduleFaustNote: vi.fn(),
    audioEngine: { setTransportInfo: vi.fn() },
    stopAllScheduled: vi.fn(),
    startAudioRecording: vi.fn(),
    stopAudioRecording: vi.fn(),
    cancelTrackAutomationRamps: vi.fn(),
    repositionNativeLiveGraphSession: vi.fn(() => Promise.resolve({ outcome: 'declined', reason: 'no session' })),
    cacheAudioBuffer: vi.fn(),
    refreshSidechainAlignment: vi.fn(),
    scheduleAdjustmentLayers: vi.fn(),
    createBufferSource: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    getFactoryDrumKitByIndex: vi.fn(),
    readNativeEnginePlayheadSeconds: (): number | null => null,
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiControl: () => Promise.resolve(true),
    sendNativeLiveMidiNote: () => Promise.resolve(true),
}));
vi.mock('#/modules/Synth/useCases', () => ({
    getDrumKitDefByIndex: () => null,
    scheduleDrumKitNote: vi.fn(),
    scheduleKitNote: vi.fn(),
    scheduleNote: vi.fn(),
    getSynthParamsFromDevices: vi.fn(),
}));
vi.mock('#/modules/PluginHost/useCases', () => ({ isFaustInstrumentModule: () => false }));
vi.mock('#/modules/Yeast/useCases', () => ({
    processYeastMidi: vi.fn(),
    getYeastSchedulingLookahead: () => ({ earlyBeats: 0, lateBeats: 0 }),
}));
vi.mock('../../scheduling/scheduleAudioClips', () => ({ scheduleAudioClips: vi.fn() }));
vi.mock('../../scheduling/applyAutomation/applyAutomation', () => ({
    applyAutomation: vi.fn(() => new Set<string>()),
}));
vi.mock('../../scheduling/applyAutomation/applyVcaGains', () => ({ applyVcaGains: vi.fn() }));
vi.mock('../../transportControls/panicYeastRuntime', () => ({ panicYeastRuntime: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: (patch: Partial<typeof defaultTransportState>) => {
        if (transportStoreState.value) {
            transportStoreState.value = { ...transportStoreState.value, ...patch };
        }
    },
}));

const evaluateFollowActionsMock = vi.fn<
    (tracks: unknown[], from: number, to: number) => { jumpToPosition: number | null; shouldStop: boolean }
>(() => ({ jumpToPosition: null, shouldStop: false }));
vi.mock('../../evaluateFollowActions', () => ({
    evaluateFollowActions: (...args: unknown[]) => (evaluateFollowActionsMock as (...a: unknown[]) => unknown)(...args),
}));

const TEMPO_BPM = 120;
/** 0.07 s per tick, deliberately not a divisor of the loop, so a wrap overshoots. */
const TICK_SECONDS = 0.07;

type DeviceKind = 'grand-boule' | 'levain';

function row(id: string, controller: number, value: number, beat: number) {
    return { id, controller, value, beat, channel: 0 };
}

/** One 8-beat clip on a track whose instrument is the given device, carrying the given controller lane and no notes. */
function loadClip(device: DeviceKind, lane: ReturnType<typeof row>[]): void {
    const nodes: Record<DeviceKind, unknown> = {
        'grand-boule': { type: 'grand-boule', deviceId: 'dev-1', grandBouleControls },
        levain: { type: 'levain', deviceId: 'dev-1', levainControls },
    };
    trackStripStub.deviceNodes = [nodes[device]];
    trackStoreState.value = {
        tracks: [
            {
                id: 'track-1',
                kind: 'midi',
                muted: false,
                armed: false,
                parentId: null,
                followChordTrack: false,
                automationMode: 'read',
                devices: [{ id: 'dev-1', type: device }],
                sends: [],
                clips: [
                    {
                        id: 'clip-1',
                        type: 'midi',
                        muted: false,
                        startBeat: 0,
                        endBeat: 8,
                        gain: 1,
                        loopEnabled: false,
                        midiOffsetBeats: 0,
                    },
                ],
                freezeState: { status: 'unfrozen', frozenBufferId: null },
            },
        ],
    };
    midiStoreState.value = { notesByClipId: { 'clip-1': [] }, ccByClipId: { 'clip-1': lane }, probabilitySeed: 1 };
}

function playingState(overrides: Partial<typeof defaultTransportState> = {}): typeof defaultTransportState {
    return { ...defaultTransportState, isPlaying: true, tempo: TEMPO_BPM, playheadPosition: 0, ...overrides };
}

type SchedulerWorkerHarness = { onmessage: ((event: { data: unknown }) => void) | null };

let schedulerTickSequence = 0;

async function runTick(): Promise<void> {
    const worker = schedulerSession.worker as unknown as SchedulerWorkerHarness;
    ctxTime.now += TICK_SECONDS;
    schedulerTickSequence++;
    const receivedAtMs = performance.timeOrigin + performance.now();
    worker.onmessage?.({
        data: {
            type: 'tick',
            generation: schedulerSession.generation,
            sequence: schedulerTickSequence,
            scheduledAtMs: receivedAtMs - 2,
            sentAtMs: receivedAtMs - 1,
        },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Ticks, then tests `done` once per tick: it may keep state between calls. */
async function runTicksUntil(done: () => boolean, maxTicks = 500): Promise<void> {
    for (let tick = 0; tick < maxTicks; tick++) {
        await runTick();
        if (done()) {
            return;
        }
    }
    throw new Error(`the awaited scheduler state was not reached in ${maxTicks} ticks`);
}

function frameNow(): number {
    return Math.round(ctxTime.now * SAMPLE_RATE);
}

/** The jump or seek destination: a beat inside the clip where the lane's first value is in force. */
const DESTINATION_BEAT = 2;

/** Pedal down at 1, lifted at 3.35: a lift the look-ahead posts while the playhead is still ~0.17 beats short of it. */
const pedalLane = () => [row('down', 64, 127, 1), row('up', 64, 0, 3.35)];
/** Expression at 100 from beat 1, dropped to 20 at 3.35. */
const expressionLane = () => [row('high', 11, 100, 1), row('low', 11, 20, 3.35)];

async function playUntilQueued(lowValueCall: string): Promise<void> {
    await runTicksUntil(() => callLog.some((entry) => entry.startsWith(lowValueCall)));
}

describe('stored controller moves posted for a look-ahead playback then leaves', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        callLog.length = 0;
        engine.reset();
        forgetStoredControllerEngagements();
        evaluateFollowActionsMock.mockImplementation(() => ({ jumpToPosition: null, shouldStop: false }));
        midiStoreState.value = null;
        trackStoreState.value = { tracks: [] };
        metronomeSchedulingState.lastBeat = -1;
        metronomeSchedulingState.firedClickTimes.clear();
        ctxTime.now = 0;
        schedulerTickSequence = 0;
        disposePlayheadScheduler();
        vi.stubGlobal(
            'Worker',
            class {
                onmessage: ((event: { data: unknown }) => void) | null = null;
                postMessage = vi.fn();
                terminate = vi.fn();
                addEventListener = vi.fn();
                removeEventListener = vi.fn();
            }
        );
    });

    afterEach(() => {
        disposePlayheadScheduler();
        vi.unstubAllGlobals();
    });

    describe('follow-action jump', () => {
        it('leaves the Grand Boule sustain down at the destination, the queued lift for the old timeline dropped', async () => {
            loadClip('grand-boule', pedalLane());
            transportStoreState.value = playingState({ playheadPosition: 0.8 });
            startPlayheadScheduler();
            await playUntilQueued('sustain 0');
            engine.advanceTo(frameNow());
            expect(engine.value('sustain')).toBe(1);

            evaluateFollowActionsMock.mockImplementationOnce(() => ({
                jumpToPosition: DESTINATION_BEAT,
                shouldStop: false,
            }));
            await runTick();
            engine.drainAll();

            expect(engine.value('sustain')).toBe(1);
        });

        it('leaves the Levain CC11 at the value in force at the destination, the queued move for the old timeline dropped', async () => {
            loadClip('levain', expressionLane());
            transportStoreState.value = playingState({ playheadPosition: 0.8 });
            startPlayheadScheduler();
            await playUntilQueued('cc11 20');
            engine.advanceTo(frameNow());
            expect(engine.value('cc11')).toBe(100);

            evaluateFollowActionsMock.mockImplementationOnce(() => ({
                jumpToPosition: DESTINATION_BEAT,
                shouldStop: false,
            }));
            await runTick();
            engine.drainAll();

            expect(engine.value('cc11')).toBe(100);
        });

        it('drops the discard before the destination restore posts, so the restore is not the thing it drops', async () => {
            loadClip('levain', expressionLane());
            transportStoreState.value = playingState({ playheadPosition: 0.8 });
            startPlayheadScheduler();
            await playUntilQueued('cc11 20');
            callLog.length = 0;

            evaluateFollowActionsMock.mockImplementationOnce(() => ({
                jumpToPosition: DESTINATION_BEAT,
                shouldStop: false,
            }));
            await runTick();

            expect(callLog).toEqual(['discard', 'cc11 100 framed stored']);
        });
    });

    describe('late loop wrap', () => {
        // A region shorter than the look-ahead cannot hand a pass over early, so it
        // posts the beats past its end and wraps after the playhead crosses it. The
        // first window reaches 3.54, the incoming pass's only 3.53, so a row at 3.535
        // is posted by the old timeline and never by the new one.
        const SHORT_LOOP = { loopStart: 3.3, loopEnd: 3.45 };
        const STALE_BEAT = 3.535;

        function hasWrapped(previous: { beat: number }): () => boolean {
            return () => {
                const wrapped = schedulerSession.accumulatedPosition < previous.beat;
                previous.beat = schedulerSession.accumulatedPosition;
                return wrapped;
            };
        }

        it('leaves the Grand Boule sustain down at the loop start, the lift posted past the loop end dropped', async () => {
            loadClip('grand-boule', [row('down', 64, 127, 0), row('up', 64, 0, STALE_BEAT)]);
            transportStoreState.value = playingState({ playheadPosition: 3.2, isLooping: true, ...SHORT_LOOP });
            startPlayheadScheduler();

            await runTicksUntil(hasWrapped({ beat: 3.2 }));
            engine.drainAll();

            expect(engine.value('sustain')).toBe(1);
        });

        it('leaves the Levain CC11 at the value in force at the loop start, the move posted past the loop end dropped', async () => {
            loadClip('levain', [row('high', 11, 100, 0), row('low', 11, 20, STALE_BEAT)]);
            transportStoreState.value = playingState({ playheadPosition: 3.2, isLooping: true, ...SHORT_LOOP });
            startPlayheadScheduler();

            await runTicksUntil(hasWrapped({ beat: 3.2 }));
            engine.drainAll();

            expect(engine.value('cc11')).toBe(100);
        });
    });

    describe('seek while playing', () => {
        it('lifts the Grand Boule sustain a dropped queued lift would have left down', async () => {
            loadClip('grand-boule', pedalLane());
            transportStoreState.value = playingState({ playheadPosition: 0.8 });
            startPlayheadScheduler();
            await playUntilQueued('sustain 0');
            engine.advanceTo(frameNow());
            expect(engine.value('sustain')).toBe(1);

            await executePlayheadSeek(DESTINATION_BEAT);
            engine.drainAll();

            expect(engine.value('sustain')).toBe(0);
        });

        it('keeps the Levain CC11 at the value it last applied, the queued move for the old timeline dropped', async () => {
            loadClip('levain', expressionLane());
            transportStoreState.value = playingState({ playheadPosition: 0.8 });
            startPlayheadScheduler();
            await playUntilQueued('cc11 20');
            engine.advanceTo(frameNow());

            await executePlayheadSeek(DESTINATION_BEAT);
            engine.drainAll();

            expect(engine.value('cc11')).toBe(100);
        });
    });

    describe('stop', () => {
        it('does not apply a queued CC11 move after the stop, and changes no CC1, CC7 or CC11 already applied', async () => {
            loadClip('levain', [
                row('mod', 1, 64, 1),
                row('volume', 7, 100, 1),
                row('high', 11, 100, 1),
                row('low', 11, 20, 3.35),
            ]);
            transportStoreState.value = playingState({ playheadPosition: 0.8 });
            startPlayheadScheduler();
            await playUntilQueued('cc11 20');
            engine.advanceTo(frameNow());
            callLog.length = 0;

            stopPlayheadScheduler();
            engine.drainAll();

            expect([engine.value('cc1'), engine.value('cc7'), engine.value('cc11')]).toEqual([64, 100, 100]);
            // Nothing but the discard reached the instrument: a controller that is not
            // a pedal is not written by a stop.
            expect(callLog).toEqual(['discard']);
        });

        it('lifts a Grand Boule sustain whose lift was still queued, so the stop leaves no pedal down', async () => {
            loadClip('grand-boule', pedalLane());
            transportStoreState.value = playingState({ playheadPosition: 0.8 });
            startPlayheadScheduler();
            await playUntilQueued('sustain 0');
            engine.advanceTo(frameNow());

            stopPlayheadScheduler();
            engine.drainAll();

            expect(engine.value('sustain')).toBe(0);
        });
    });

    describe('a performer move', () => {
        const FAR_FUTURE = 10_000_000;

        it('queued on the Grand Boule is never dropped by a jump', async () => {
            loadClip('grand-boule', pedalLane());
            transportStoreState.value = playingState({ playheadPosition: 0.8 });
            startPlayheadScheduler();
            await playUntilQueued('sustain 0');
            // A half pedal played live, stamped past everything stored playback posted.
            grandBouleControls.setSustain(0.3, FAR_FUTURE);

            evaluateFollowActionsMock.mockImplementationOnce(() => ({
                jumpToPosition: DESTINATION_BEAT,
                shouldStop: false,
            }));
            await runTick();
            engine.drainAll();

            expect(engine.value('sustain')).toBe(0.3);
        });

        it('queued on the Levain is never dropped by a stop', async () => {
            loadClip('levain', expressionLane());
            transportStoreState.value = playingState({ playheadPosition: 0.8 });
            startPlayheadScheduler();
            await playUntilQueued('cc11 20');
            levainControls.handleCc(1, 77, FAR_FUTURE);

            stopPlayheadScheduler();
            engine.drainAll();

            expect(engine.value('cc1')).toBe(77);
        });
    });
});
