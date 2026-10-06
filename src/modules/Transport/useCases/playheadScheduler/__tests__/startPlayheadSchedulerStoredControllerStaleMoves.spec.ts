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
 * processor): a framed move waits for its frame, a frameless Levain controller
 * applies at once while a frameless Grand Boule pedal or latch queues at the
 * current frame (so a later discard drops it), a move marked `stored` is the only
 * kind `discardStored*` drops, and a frameless stored move supersedes nothing.
 * Every assertion reads the value the instrument
 * holds after the whole queue has drained, not the order of the posts.
 */

type Move = { key: string; value: number; frame: number; stored: boolean };

function createEngineModel(currentFrame: () => number) {
    const applied = new Map<string, number>();
    /** Every value a key has taken, in order: a lift that was never applied never shows here. */
    const history = new Map<string, number[]>();
    let pending: Move[] = [];
    function apply(key: string, value: number): void {
        applied.set(key, value);
        const values = history.get(key) ?? [];
        values.push(value);
        history.set(key, values);
    }
    function advanceTo(frame: number): void {
        const due = pending.filter((move) => move.frame <= frame).sort((a, b) => a.frame - b.frame);
        pending = pending.filter((move) => move.frame > frame);
        for (const move of due) {
            apply(move.key, move.value);
        }
    }
    return {
        post(key: string, value: number, frame: number | undefined, stored: boolean): void {
            if (frame === undefined && (key === 'sustain' || key === 'sostenuto')) {
                // A Grand Boule queues a frameless pedal at the block start
                // (`receiveGrandBouleMessage`), where a later `discardStoredPedals` drops it
                // if it is a stored move: so the lift has to follow the discard, never precede it.
                if (!stored) {
                    pending = pending.filter((move) => move.key !== key);
                }
                pending.push({ key, value, frame: currentFrame(), stored });
                return;
            }
            if (frame === undefined) {
                // A Levain applies a frameless controller at once.
                if (!stored) {
                    pending = pending.filter((move) => move.key !== key);
                }
                apply(key, value);
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
        history: (key: string) => history.get(key) ?? [],
        reset(): void {
            applied.clear();
            history.clear();
            pending = [];
        },
    };
}

const engine = createEngineModel(() => Math.round(ctxTime.now * SAMPLE_RATE));
const callLog: string[] = [];

const transportStoreState: { value: typeof defaultTransportState | null } = { value: null };
const tempoMapStoreState: { value: { changes: unknown[] } } = { value: { changes: [] } };
/** Every framed Levain controller move, with the frame it was posted at. */
const levainFramed: { cc: number; value: number; frame: number }[] = [];
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
    setSostenuto: (engaged: boolean, frame?: number, stored?: boolean) => {
        callLog.push(
            `sostenuto ${engaged} ${frame === undefined ? 'now' : 'framed'}${stored === true ? ' stored' : ''}`
        );
        engine.post('sostenuto', engaged ? 1 : 0, frame, stored === true);
    },
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
        if (frame !== undefined) {
            levainFramed.push({ cc, value, frame });
        }
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
vi.mock('../../../stores/tempoMapStore', () => ({
    tempoMapStore: {
        get value() {
            return tempoMapStoreState.value;
        },
    },
}));
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
function loadClip(device: DeviceKind, lane: ReturnType<typeof row>[], clipEndBeat = 8): void {
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
                        endBeat: clipEndBeat,
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
        levainFramed.length = 0;
        tempoMapStoreState.value = { changes: [] };
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

    describe('relocation with no row in force', () => {
        /** The lane's lift is queued, so the post record says "up" while the engine still holds the pedal down. */
        async function playUntilLiftQueued(controls: 'sustain' | 'sostenuto', clipEndBeat?: number): Promise<void> {
            const controller = controls === 'sustain' ? 64 : 66;
            loadClip('grand-boule', [row('down', controller, 127, 1), row('up', controller, 0, 3.35)], clipEndBeat);
            transportStoreState.value = playingState({ playheadPosition: 0.8 });
            startPlayheadScheduler();
            await playUntilQueued(`${controls} ${controls === 'sustain' ? 0 : false}`);
            engine.advanceTo(frameNow());
            expect(engine.value(controls)).toBe(1);
            callLog.length = 0;
        }

        async function jumpTo(beat: number): Promise<void> {
            evaluateFollowActionsMock.mockImplementationOnce(() => ({ jumpToPosition: beat, shouldStop: false }));
            await runTick();
            engine.drainAll();
        }

        it('lifts a sustain down before the clip has any row, though its last posted move was a lift', async () => {
            await playUntilLiftQueued('sustain');

            await jumpTo(0.5);

            expect(callLog).toEqual(['discard', 'sustain 0 framed stored']);
            expect(engine.value('sustain')).toBe(0);
        });

        it('lifts a sustain down on a track whose clip ends before the destination, though its last posted move was a lift', async () => {
            await playUntilLiftQueued('sustain', 4);

            await jumpTo(6);

            expect(callLog).toEqual(['discard', 'sustain 0 framed stored']);
            expect(engine.value('sustain')).toBe(0);
        });

        it('releases a sostenuto latch down before the clip has any row, though its last posted move was a release', async () => {
            await playUntilLiftQueued('sostenuto');

            await jumpTo(0.5);

            expect(callLog).toEqual(['discard', 'sostenuto false framed stored']);
            expect(engine.value('sostenuto')).toBe(0);
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

    describe('loop-region and tempo-map edits during playback', () => {
        const LANE_END = 3.6;

        it('leaves a Levain CC11 at the value in force in the new pass when a loop edit cuts the look-ahead', async () => {
            loadClip('levain', [row('high', 11, 100, 0), row('low', 11, 20, LANE_END)]);
            transportStoreState.value = playingState({ playheadPosition: 3.0 });
            startPlayheadScheduler();
            await playUntilQueued('cc11 20');
            engine.advanceTo(frameNow());

            transportStoreState.value = playingState({
                playheadPosition: 3.0,
                isLooping: true,
                loopStart: 0,
                loopEnd: 3.58,
            });
            for (let tick = 0; tick < 4; tick++) {
                await runTick();
            }
            engine.drainAll();

            expect(engine.value('cc11')).toBe(100);
        });

        it('leaves a Grand Boule sustain down in the new pass when a loop edit cuts the look-ahead', async () => {
            loadClip('grand-boule', [row('down', 64, 127, 0), row('up', 64, 0, LANE_END)]);
            transportStoreState.value = playingState({ playheadPosition: 3.0 });
            startPlayheadScheduler();
            await playUntilQueued('sustain 0');
            engine.advanceTo(frameNow());

            transportStoreState.value = playingState({
                playheadPosition: 3.0,
                isLooping: true,
                loopStart: 0,
                loopEnd: 3.58,
            });
            for (let tick = 0; tick < 4; tick++) {
                await runTick();
            }
            engine.drainAll();

            expect(engine.value('sustain')).toBe(1);
        });

        it('leaves a Levain CC11 at the value in force under the new map when a tempo edit cuts the look-ahead', async () => {
            loadClip('levain', [row('high', 11, 100, 0), row('low', 11, 20, LANE_END)]);
            transportStoreState.value = playingState({ playheadPosition: 3.0 });
            startPlayheadScheduler();
            await playUntilQueued('cc11 20');
            engine.advanceTo(frameNow());

            // Half the tempo: the re-emitted window now reaches 3.59, short of the move.
            tempoMapStoreState.value = { changes: [{ id: 'slow', beat: 0, tempo: 60, curve: 'instant' }] };
            await runTick();
            engine.drainAll();

            expect(engine.value('cc11')).toBe(100);
        });

        it('keeps a pedal the lane holds down at the playhead down across an edit that does not move the playhead', async () => {
            loadClip('grand-boule', [row('down', 64, 127, 1)]);
            transportStoreState.value = playingState({ playheadPosition: 0.5 });
            startPlayheadScheduler();
            for (let tick = 0; tick < 6; tick++) {
                await runTick();
            }
            engine.advanceTo(frameNow());
            expect(engine.value('sustain')).toBe(1);
            callLog.length = 0;

            tempoMapStoreState.value = { changes: [{ id: 'slow', beat: 0, tempo: 60, curve: 'instant' }] };
            await runTick();

            // The queued moves are dropped and the value in force is restored: no lift
            // first. A Grand Boule releases the voices a lifted sustain was holding and a
            // press does not bring them back, so the pedal must never reach the engine up.
            expect(callLog).toEqual(['discard', 'sustain 1 framed stored']);
            engine.drainAll();
            expect(engine.history('sustain')).toEqual([1, 1]);
        });

        it('lifts a pedal stored playback moved when no row of the lane is in force where the edit re-emits', async () => {
            loadClip('grand-boule', [row('down', 64, 127, 3.5)]);
            transportStoreState.value = playingState({ playheadPosition: 3.0 });
            startPlayheadScheduler();
            await playUntilQueued('sustain 1');
            callLog.length = 0;

            tempoMapStoreState.value = { changes: [{ id: 'slow', beat: 0, tempo: 60, curve: 'instant' }] };
            await runTick();

            // Nothing is in force before 3.5: the queued press is dropped, the moved pedal is
            // lifted at the re-emit frame, and the re-emitted window presses it at 3.5.
            expect(callLog).toEqual(['discard', 'sustain 0 framed stored', 'sustain 1 framed stored']);
            engine.drainAll();
            expect(engine.value('sustain')).toBe(1);
        });
    });

    describe('scheduled loop seam on a Levain', () => {
        function pendingSeamFrame(): number {
            const seam = schedulerSession.pendingSeam;
            if (seam === null) {
                throw new Error('no seam is pending');
            }
            return Math.round(seam.seamAudioTime * SAMPLE_RATE);
        }

        it('lifts a CC64 the dying pass left down when no row of the lane is in force at the loop start', async () => {
            loadClip('levain', [row('down', 64, 127, 3.5)]);
            transportStoreState.value = playingState({ isLooping: true, loopStart: 2, loopEnd: 4 });
            startPlayheadScheduler();

            await runTicksUntil(() => schedulerSession.pendingSeam !== null);

            expect(levainFramed.map((move) => [move.cc, move.value])).toEqual([
                [64, 127],
                [64, 0],
            ]);
            expect(Math.abs(levainFramed[1]!.frame - pendingSeamFrame())).toBeLessThanOrEqual(1);
            expect(callLog.filter((entry) => entry.includes(' now'))).toEqual([]);
        });

        it('lifts a CC64 left down on a track that has no clip at the loop start', async () => {
            loadClip('levain', [row('down', 64, 127, 3.5)], 4);
            transportStoreState.value = playingState({ isLooping: true, loopStart: 6, loopEnd: 8 });
            startPlayheadScheduler();

            await runTicksUntil(() => schedulerSession.pendingSeam !== null);

            expect(levainFramed.map((move) => [move.cc, move.value])).toEqual([
                [64, 127],
                [64, 0],
            ]);
            expect(Math.abs(levainFramed[1]!.frame - pendingSeamFrame())).toBeLessThanOrEqual(1);
        });
    });
});
