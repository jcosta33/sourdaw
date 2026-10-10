/**
 * AudioWorkletProcessor for the Levain suite engine.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Messages from main thread:
 *   { type: 'init' }
 *   { type: 'noteOn', note, velocity, sampleFrame? }
 *   { type: 'noteOff', note, sampleFrame? }
 *   { type: 'allNotesOff' }
 *   { type: 'param', name, value }
 *   { type: 'cc', cc, value, sampleFrame?, stored? }
 *   { type: 'discardStoredCc' }
 *   { type: 'bypass', bypassed }
 *   { type: 'beginSampleBank', bankKey, instrumentId, loadToken }
 *   { type: 'abortSampleBank', loadToken }
 *   { type: 'addSample', loadToken, sampleId, data, frameCount, channels, sampleRate }
 *   { type: 'addZone', loadToken, ... }
 *   { type: 'addLegatoTransition', loadToken, sampleId, interval, ... }
 *   { type: 'buildZoneMap', loadToken, numArticulations, numMics }
 *   { type: 'releaseRetiredBank', loadToken }
 *   { type: 'releaseDisposedBanks' }
 *   { type: 'dispose' }
 *
 * Committing a bank (`buildZoneMap`) builds the zone map in that message, then
 * commits with a call that allocates and frees nothing: the bank it replaces
 * waits in the engine's retired slot. Aborting a staged bank does the same with
 * the staged bank. The host frees it with `releaseRetiredBank` messages of its
 * own, one bounded step each, answered by
 * `retiredBankReleased { loadToken, done }`. Nothing frees a bank inside the
 * commit, the abort or `process()`.
 *
 * A disposed processor frees nothing in `dispose`. The host then sends
 * `releaseDisposedBanks`, one bounded step per message, answered by
 * `disposedBanksReleased { done }`: a step releases the retired bank, else
 * retires the sounding bank, else (both slots empty) frees the engine, which
 * then holds nothing bank-sized. A disposed processor, faulted or not, honours
 * only that message and a repeated `dispose`, which it answers by posting
 * `disposed` again, and posts nothing for every other message.
 *
 * A faulted processor that has not been disposed drops every message except
 * `dispose`, which it answers with `disposed` and starts the drain, and
 * `beginSampleBank` and `releaseRetiredBank`, which it answers by posting its
 * `error` again, so a host that began listening after the fault still learns
 * that no answer will come.
 *
 * ADR 0052's Message contract tables every answer by state.
 */

import { resolveProcessorWasmModule } from '../transformers/resolveProcessorWasmModule';
import { initSync, LevainInstance } from '../wasm/daw_dsp.js';

import { WasmView } from './wasmView';

const PARAM_MAP: Record<string, string> = {
    masterGain: 'master_gain',
    humanize: 'humanize',
    legatoEnabled: 'legato_enabled',
    vibratoDepth: 'vibrato_depth',
    autoDivisi: 'auto_divisi',
    autoDivisiSize: 'auto_divisi_size',
    autoArticulation: 'auto_articulation',
    ensembleTiming: 'ensemble_timing',
    attackSpread: 'attack_spread',
    pitchConvergence: 'pitch_convergence',
};

/**
 * Wire encodings for `LevainInstance::add_legato_transition`, which takes the
 * DSP's `TransitionType` and `Dynamic` discriminants as `u8`. Kept here rather
 * than as numbers on the wire so a mismatch is a name, not a silently wrong
 * lookup key.
 */
const LEGATO_TRANSITION_TYPE_IDS: Record<string, number> = {
    slurred: 0,
    portamento: 1,
};
const LEGATO_DYNAMIC_IDS: Record<string, number> = {
    pp: 0,
    p: 1,
    mp: 2,
    mf: 3,
    f: 4,
    ff: 5,
};

type LevainAddLegatoTransitionMsg = {
    type: 'addLegatoTransition';
    loadToken: number;
    sampleId: number;
    interval: number;
    transitionType: string;
    dynamic: string;
    crossfadeOutMs: number;
};

type LevainAddZoneMsg = {
    type: 'addZone';
    loadToken: number;
    zoneId: number;
    sampleId: number;
    articulationId: number;
    rootNote: number;
    /**
     * Fine tuning against `rootNote`, in cents. Optional because no bank
     * format authors it yet; the DSP zone carries the field either way, so a
     * bank that starts authoring one only has to send it.
     */
    tuneCents?: number;
    loKey: number;
    hiKey: number;
    loVel: number;
    hiVel: number;
    rrPos: number;
    rrLen: number;
    micId: number;
    isRelease?: boolean;
    loopMode?: string;
    loopStart: number;
    loopEnd: number;
    loopCrossfade: number;
    gainDb: number;
    attack: number;
    decay: number;
    sustain: number;
    release: number;
};

/**
 * MPE per-note expression (audit MD-2). Values arrive already normalised to
 * engine units by `applyNoteExpression`, so the worklet only routes them.
 */
type NoteExpressionMsg = {
    type: 'noteExpression';
    note: number;
    channel: number;
    bendSemitones: number;
    pressure: number;
    slide: number;
    sampleFrame?: number;
};
type LevainMsg =
    | { type: 'init' }
    | {
          type: 'noteOn';
          note: number;
          velocity: number;
          sampleFrame?: number;
          channel?: number;
          articulationId?: number;
      }
    | { type: 'noteOff'; note: number; sampleFrame?: number; channel?: number }
    | NoteExpressionMsg
    | { type: 'allNotesOff' }
    | { type: 'param'; name: string; value: number }
    // `stored` marks a move stored clip playback posted, as against one a
    // performer played: `discardStoredCc` drops only those while they are queued.
    | { type: 'cc'; cc: number; value: number; sampleFrame?: number; stored?: boolean }
    | { type: 'discardStoredCc' }
    | { type: 'bypass'; bypassed: boolean }
    | { type: 'beginSampleBank'; bankKey: string; instrumentId: string; loadToken: number }
    | { type: 'abortSampleBank'; loadToken: number }
    | {
          type: 'addSample';
          loadToken: number;
          sampleId: number;
          data: Float32Array;
          frameCount: number;
          channels: number;
          sampleRate: number;
      }
    | LevainAddZoneMsg
    | LevainAddLegatoTransitionMsg
    | { type: 'buildZoneMap'; loadToken: number; numArticulations: number; numMics: number }
    | { type: 'releaseRetiredBank'; loadToken: number }
    | { type: 'releaseDisposedBanks' }
    | { type: 'dispose' };

type LevainQueued =
    | {
          type: 'noteOn';
          note: number;
          velocity: number;
          sampleFrame: number;
          channel?: number;
          articulationId?: number;
      }
    | { type: 'noteOff'; note: number; sampleFrame: number; channel?: number }
    | (NoteExpressionMsg & { sampleFrame: number })
    | { type: 'cc'; cc: number; value: number; sampleFrame: number; stored?: boolean };

type BankRole = 'owner' | 'follower' | 'ready';
type BankBuild = { numArticulations: number; numMics: number };
type InFlightBank = { owner: LevainProcessor; followers: Set<LevainProcessor> };

const inFlightBanks = new Map<string, InFlightBank>();

/**
 * PCM entries one `releaseRetiredBank` message frees. Freeing 2,000 samples
 * took about 0.45 ms and 6,000 about 2.3 ms in one call (measured on the
 * shipped wasm under Node), against a 2.67 ms render quantum, so a bank is
 * freed a few hundred entries per message instead.
 */
const RETIRED_BANK_RELEASE_ENTRIES = 256;

/**
 * Disposed processors whose engine still holds a bank, kept reachable so
 * neither the processor nor its engine is collected (and its finalizer run, in
 * one unbounded free) before the host's paced release reaches done.
 */
const drainingProcessors = new Set<LevainProcessor>();

class LevainProcessor extends AudioWorkletProcessor {
    _instance: LevainInstance | null = null;
    _memory: WebAssembly.Memory | null = null;
    _ready = false;
    _faulted = false;
    // The message of the fault that set `_faulted`, posted again to a host that asks after it.
    _faultMessage: string | null = null;
    _disposed = false;
    // Set when a disposal-release step threw: the engine can no longer be
    // trusted, so it is never freed from here.
    _disposalPoisoned = false;
    _bypassed = false;
    _pendingMessages: LevainMsg[] = [];
    _queue: LevainQueued[] = [];
    _queueHead = 0;
    _bankKey: string | null = null;
    _bankRole: BankRole | null = null;
    _bankLoadToken: number | null = null;
    _pendingBankBuild: BankBuild | null = null;
    // Load token of the commit whose displaced bank still waits in the engine's
    // retired slot; a `releaseRetiredBank` for any other token frees nothing.
    _retiredBankToken: number | null = null;
    // Cached WASM linear-memory views — reused across render quanta so process()
    // performs no per-block Float32Array allocation (audit RT-1); each revalidates
    // on a memory.grow() buffer-identity change (audit RT-7). See wasmView.ts.
    _outLeftView = new WasmView();
    _outRightView = new WasmView();

    constructor(...args: unknown[]) {
        super();
        let wasmModule = resolveProcessorWasmModule(args[0]);
        this.port.onmessage = (event: MessageEvent<LevainMsg>) => {
            const msg = event.data;
            if (msg.type === 'dispose') {
                this._dispose();
                return;
            }
            if (msg.type === 'releaseDisposedBanks') {
                if (this._disposed) {
                    this._releaseDisposedBanks();
                }
                return;
            }
            if (this._disposed) {
                return;
            }
            if (this._faulted && (msg.type === 'beginSampleBank' || msg.type === 'releaseRetiredBank')) {
                this._answerAfterFault();
                return;
            }
            try {
                if (msg.type === 'init') {
                    if (this._ready) {
                        return;
                    }
                    if (!wasmModule) {
                        throw new TypeError('LevainProcessor requires a compiled WASM module');
                    }
                    this._initWasm(wasmModule);
                    wasmModule = null;
                } else if (!this._ready) {
                    this._pendingMessages.push(msg);
                } else if (!this._faulted) {
                    this._handleMessage(msg);
                }
            } catch (error) {
                // Same policy as the process() catch below, deliberately.
                // A throw here is an OOM, a malformed message, or a wasm trap
                // left by an earlier panic — and a trap arrives with no message
                // at all, so the three are not distinguishable from this side.
                // Sample-bank failures are transactional and reject only that
                // load. Throws elsewhere mean the instance can no longer be
                // trusted and fault it permanently.
                console.error('LevainProcessor error:', error);
                if (this._bankRole) {
                    this._rejectBankLoad(error);
                } else {
                    this._faultWithError(error);
                }
            }
        };
    }

    _initWasm(wasmModule: WebAssembly.Module): void {
        const wasmExports = initSync({ module: wasmModule });
        this._memory = wasmExports.memory;
        this._instance = new LevainInstance(sampleRate, 64);
        this._ready = true;

        for (const msg of this._pendingMessages) {
            this._handleMessage(msg);
        }
        this._pendingMessages = [];

        this.port.postMessage({ type: 'ready' });
    }

    _beginSampleBank(bankKey: string, instrumentId: string, loadToken: number): void {
        const inst = this._instance;
        if (
            !inst ||
            bankKey.length === 0 ||
            instrumentId.length === 0 ||
            !Number.isSafeInteger(loadToken) ||
            loadToken <= 0
        ) {
            throw new Error('Levain sample bank identity and load token must be valid');
        }

        this._leaveBankLoad(new Error('Levain sample bank load was superseded'));
        // Begins by freeing any retired bank, the one the leave above just
        // retired included, so none is left to release.
        inst.begin_sample_bank(instrumentId);
        this._retiredBankToken = null;
        this._bankKey = bankKey;
        this._bankLoadToken = loadToken;
        this._pendingBankBuild = null;

        const inFlight = inFlightBanks.get(bankKey);
        if (inFlight) {
            this._bankRole = 'follower';
            inFlight.followers.add(this);
            this._postSampleBankUploadDecision(loadToken, false);
            return;
        }
        if (inst.attach_sample_bank(bankKey)) {
            this._bankRole = 'ready';
            this._postSampleBankUploadDecision(loadToken, false);
            return;
        }

        this._bankRole = 'owner';
        inFlightBanks.set(bankKey, { owner: this, followers: new Set() });
        this._postSampleBankUploadDecision(loadToken, true);
    }

    _postSampleBankUploadDecision(loadToken: number, uploadRequired: boolean): void {
        this.port.postMessage({ type: 'sampleBankUploadDecision', loadToken, uploadRequired });
    }

    _completeSampleBankLoad(loadToken: number): void {
        this._retiredBankToken = loadToken;
        this._bankKey = null;
        this._bankRole = null;
        this._bankLoadToken = null;
        this._pendingBankBuild = null;
        this.port.postMessage({ type: 'sampleBankLoaded', loadToken });
    }

    _buildZoneMap(build: BankBuild): void {
        const inst = this._instance;
        if (!inst) {
            return;
        }
        if (this._bankRole === 'follower') {
            this._pendingBankBuild = build;
            return;
        }
        if (!inst.build_zone_map(build.numArticulations, build.numMics)) {
            throw new Error('Levain DSP rejected zone-map dimensions or capacity');
        }
        if (this._bankRole === 'ready') {
            const loadToken = this._bankLoadToken;
            if (loadToken === null) {
                throw new Error('Levain sample bank lost its load token before commit');
            }
            if (!inst.commit_sample_bank()) {
                throw new Error('Levain DSP could not commit the staged sample bank');
            }
            this._completeSampleBankLoad(loadToken);
            return;
        }
        if (this._bankRole !== 'owner') {
            return;
        }

        const bankKey = this._bankKey;
        if (!bankKey) {
            throw new Error('Levain sample bank ownership changed before publication');
        }
        const inFlight = inFlightBanks.get(bankKey);
        if (!inFlight || inFlight.owner !== this) {
            throw new Error('Levain sample bank ownership changed before publication');
        }
        const loadToken = this._bankLoadToken;
        if (loadToken === null) {
            throw new Error('Levain sample bank lost its load token before publication');
        }
        if (!inst.publish_sample_bank(bankKey)) {
            throw new Error('Levain DSP could not publish the decoded sample bank');
        }
        if (!inst.commit_sample_bank()) {
            throw new Error('Levain DSP could not commit the staged sample bank');
        }
        inFlightBanks.delete(bankKey);
        for (const follower of inFlight.followers) {
            follower._completeSharedBank(bankKey);
        }
        this._completeSampleBankLoad(loadToken);
    }

    _completeSharedBank(bankKey: string): void {
        if (this._faulted || this._bankKey !== bankKey || this._bankRole !== 'follower') {
            return;
        }
        try {
            const inst = this._instance;
            if (!inst || !inst.attach_sample_bank(bankKey)) {
                throw new Error('Levain DSP could not attach the published sample bank');
            }
            this._bankRole = 'ready';
            const pendingBuild = this._pendingBankBuild;
            this._pendingBankBuild = null;
            if (pendingBuild) {
                this._buildZoneMap(pendingBuild);
            }
        } catch (error) {
            this._rejectBankLoad(error);
        }
    }

    _rejectBankLoad(error: unknown): void {
        const loadToken = this._bankLoadToken;
        try {
            this._leaveBankLoad(error);
        } finally {
            this.port.postMessage({
                type: 'sampleBankError',
                loadToken,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    _faultWithError(error: unknown): void {
        this._faulted = true;
        this._faultMessage = error instanceof Error ? error.message : String(error);
        this._leaveBankLoad(error);
        this.port.postMessage({ type: 'error', message: this._faultMessage });
    }

    /**
     * A faulted processor that is not disposed answers `beginSampleBank`,
     * `releaseRetiredBank` and `dispose` and drops every other message, so a
     * host that registered its port listener after the fault posted `error`
     * never saw it. A load that begins, or a release loop that asks, gets the
     * fault posted again: that is the only way either sees that no answer will
     * come. Once disposed it posts no `error`; see ADR 0052's Message contract.
     */
    _answerAfterFault(): void {
        this.port.postMessage({ type: 'error', message: this._faultMessage });
    }

    _dispose(): void {
        if (this._disposed) {
            this.port.postMessage({ type: 'disposed' });
            return;
        }
        this._disposed = true;
        if (this._instance) {
            drainingProcessors.add(this);
        }
        this._pendingMessages = [];
        this._queue = [];
        this._queueHead = 0;
        try {
            this._leaveBankLoad(new Error('Levain processor was disposed during sample loading'));
            try {
                this._instance?.all_notes_off();
            } catch (error) {
                console.error('LevainProcessor disposal note release failed:', error);
            }
        } finally {
            this.port.postMessage({ type: 'disposed' });
        }
    }

    /**
     * One bounded step of emptying a disposed engine, in the order that leaves
     * nothing bank-sized for `free()`: release the retired bank, retire the
     * sounding one, and only then free the engine. The answer is `done` once
     * the engine is gone, or poisoned by a throwing step and left unfreed.
     */
    _releaseDisposedBanks(): void {
        const inst = this._instance;
        if (!inst || this._disposalPoisoned) {
            this._finishDisposalRelease();
            return;
        }
        try {
            if (inst.has_retired_bank()) {
                inst.release_retired_bank(RETIRED_BANK_RELEASE_ENTRIES);
            } else if (!inst.retire_sample_bank()) {
                this._instance = null;
                inst.free();
                this._finishDisposalRelease();
                return;
            }
        } catch (error) {
            console.error('LevainProcessor disposal release failed:', error);
            this._disposalPoisoned = true;
            this._finishDisposalRelease();
            return;
        }
        this.port.postMessage({ type: 'disposedBanksReleased', done: false });
    }

    _finishDisposalRelease(): void {
        drainingProcessors.delete(this);
        this.port.postMessage({ type: 'disposedBanksReleased', done: true });
    }

    _leaveBankLoad(error: unknown): void {
        const bankKey = this._bankKey;
        const loadToken = this._bankLoadToken;
        const inFlight = bankKey ? inFlightBanks.get(bankKey) : undefined;
        this._bankKey = null;
        this._bankRole = null;
        this._bankLoadToken = null;
        this._pendingBankBuild = null;
        if (bankKey && inFlight?.owner === this) {
            inFlightBanks.delete(bankKey);
            for (const follower of inFlight.followers) {
                try {
                    follower._rejectBankLoad(error);
                } catch (followerError) {
                    console.error('LevainProcessor follower cleanup failed:', followerError);
                }
            }
        } else {
            inFlight?.followers.delete(this);
        }
        try {
            // The abort retires the staged bank instead of freeing it, so the
            // host's release loop for this load's token frees it in steps.
            if (this._instance?.abort_sample_bank()) {
                this._retiredBankToken = loadToken;
            }
        } catch (abortError) {
            console.error('LevainProcessor sample-bank abort failed:', abortError);
        }
    }

    _enqueue(msg: LevainQueued): void {
        let lo = this._queueHead;
        let hi = this._queue.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            const midMsg = this._queue[mid];
            if (midMsg && midMsg.sampleFrame <= msg.sampleFrame) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        this._queue.splice(lo, 0, msg);
    }

    _discardQueuedNotes(): void {
        let retained = 0;
        for (let index = this._queueHead; index < this._queue.length; index++) {
            const queued = this._queue[index];
            if (queued?.type === 'cc') {
                this._queue[retained] = queued;
                retained++;
            }
        }
        this._queue.length = retained;
        this._queueHead = 0;
    }

    /** Drop every queued controller move stored playback posted, compacting in place (no allocation). */
    _discardQueuedStoredControllers(): void {
        let retained = 0;
        for (let index = this._queueHead; index < this._queue.length; index++) {
            const queued = this._queue[index];
            if (queued && !(queued.type === 'cc' && queued.stored === true)) {
                this._queue[retained] = queued;
                retained++;
            }
        }
        this._queue.length = retained;
        this._queueHead = 0;
    }

    _discardQueuedController(cc: number): void {
        let retained = 0;
        for (let index = this._queueHead; index < this._queue.length; index++) {
            const queued = this._queue[index];
            if (queued && !(queued.type === 'cc' && queued.cc === cc)) {
                this._queue[retained] = queued;
                retained++;
            }
        }
        this._queue.length = retained;
        this._queueHead = 0;
    }

    _handleMessage(msg: LevainMsg): void {
        if (
            (msg.type === 'noteOn' || msg.type === 'noteOff' || msg.type === 'noteExpression' || msg.type === 'cc') &&
            msg.sampleFrame !== undefined &&
            msg.sampleFrame >= currentFrame
        ) {
            // `>=`, not `>`: a message at exactly this frame still queues, so it
            // cannot dispatch at once and overtake one already queued for it. The
            // next `process()` drains it before rendering, so it sounds no later.
            this._enqueue({ ...msg, sampleFrame: msg.sampleFrame });
            return;
        }
        if (msg.type === 'cc' && msg.stored !== true) {
            // A controller applying now is the newer move of that controller:
            // an older framed one still queued would drain after it and win.
            // A move stored playback posted speaks only for stored playback: it
            // leaves a performer's queued moves alone, and `discardStoredCc`,
            // sent before it, clears the stored ones.
            this._discardQueuedController(msg.cc);
        }
        this._dispatch(msg);
    }

    _dispatch(msg: LevainMsg | LevainQueued): void {
        const inst = this._instance;
        if (!inst) {
            return;
        }
        switch (msg.type) {
            case 'init':
                break;
            case 'noteOn':
                if (msg.articulationId === undefined) {
                    inst.note_on_with_channel(msg.note, msg.velocity, msg.channel ?? 0);
                } else {
                    inst.note_on_with_channel_and_articulation(
                        msg.note,
                        msg.velocity,
                        msg.channel ?? 0,
                        msg.articulationId
                    );
                }
                break;
            case 'noteOff':
                // Without a channel every voice at the pitch is released —
                // the historical behaviour channel-unaware callers rely on.
                if (msg.channel === undefined) {
                    inst.note_off(msg.note);
                } else {
                    inst.note_off_on_channel(msg.note, msg.channel);
                }
                break;
            case 'noteExpression':
                // MPE per-note expression (audit MD-2). Scheduled expression
                // carries the note's own start frame and is enqueued behind the
                // noteOn at that frame, so the voice exists before it is bent.
                inst.note_expression(msg.note, msg.channel, msg.bendSemitones, msg.pressure, msg.slide);
                break;
            case 'allNotesOff':
                // Drop any not-yet-dispatched scheduled notes first so a queued
                // future noteOn cannot retrigger after the release, nor a stale
                // queued noteOff cut the next take short (#4631). Queued
                // controllers stay: a controller change is state, not a note,
                // and a dropped pedal-up would leave the pedal down. Compacting
                // in place allocates nothing on the audio thread.
                this._discardQueuedNotes();
                inst.all_notes_off();
                break;
            case 'param': {
                const rustName = PARAM_MAP[msg.name] ?? msg.name;
                inst.set_param(rustName, msg.value);
                break;
            }
            case 'cc':
                // Reached with a frame when a queued controller falls due, and
                // without one for a controller that has no frame to wait for.
                inst.handle_cc(msg.cc, msg.value);
                break;
            case 'discardStoredCc':
                // Queue-only: a controller already applied keeps its value, so a
                // stop never changes where CC1, CC7 or CC11 currently stand.
                this._discardQueuedStoredControllers();
                break;
            case 'bypass':
                this._bypassed = msg.bypassed;
                break;
            case 'beginSampleBank':
                this._beginSampleBank(msg.bankKey, msg.instrumentId, msg.loadToken);
                break;
            case 'abortSampleBank':
                if (msg.loadToken === this._bankLoadToken) {
                    this._rejectBankLoad(new Error('Levain sample bank load was aborted'));
                }
                break;
            case 'addSample': {
                if (msg.loadToken !== this._bankLoadToken) {
                    break;
                }
                if (this._bankRole === 'follower' || this._bankRole === 'ready') {
                    break;
                }
                const sampleId = inst.add_sample(msg.data, msg.frameCount, msg.channels, msg.sampleRate);
                if (sampleId === undefined || sampleId !== msg.sampleId) {
                    throw new Error('Levain DSP rejected sample-bank mutation or sample ordering');
                }
                break;
            }
            case 'addZone': {
                if (msg.loadToken !== this._bankLoadToken) {
                    break;
                }
                const loopMode = (() => {
                    if (msg.loopMode === 'forward') {
                        return 1;
                    }
                    if (msg.loopMode === 'pingpong') {
                        return 2;
                    }
                    return 0;
                })();
                inst.add_zone(
                    msg.zoneId,
                    msg.sampleId,
                    msg.articulationId,
                    msg.rootNote,
                    msg.tuneCents ?? 0,
                    msg.loKey,
                    msg.hiKey,
                    msg.loVel,
                    msg.hiVel,
                    msg.rrPos,
                    msg.rrLen,
                    msg.micId,
                    !!msg.isRelease,
                    loopMode,
                    msg.loopStart,
                    msg.loopEnd,
                    msg.loopCrossfade,
                    msg.gainDb,
                    msg.attack,
                    msg.decay,
                    msg.sustain,
                    msg.release
                );
                break;
            }
            case 'addLegatoTransition': {
                if (msg.loadToken !== this._bankLoadToken) {
                    break;
                }
                inst.add_legato_transition(
                    msg.interval,
                    LEGATO_TRANSITION_TYPE_IDS[msg.transitionType] ?? 0,
                    LEGATO_DYNAMIC_IDS[msg.dynamic] ?? 0,
                    msg.sampleId,
                    msg.crossfadeOutMs
                );
                break;
            }
            case 'buildZoneMap':
                if (msg.loadToken !== this._bankLoadToken) {
                    break;
                }
                this._buildZoneMap(msg);
                break;
            case 'releaseRetiredBank':
                this._releaseRetiredBank(inst, msg.loadToken);
                break;
            case 'dispose':
                this._dispose();
                break;
        }
    }

    /**
     * One bounded step of freeing the bank a commit displaced. Answers every
     * request, so the host's loop always ends: a request for a load whose
     * retiree is already gone, or was replaced by a newer commit's, is `done`
     * without touching the engine.
     */
    _releaseRetiredBank(inst: LevainInstance, loadToken: number): void {
        let done = true;
        if (loadToken === this._retiredBankToken) {
            done = inst.release_retired_bank(RETIRED_BANK_RELEASE_ENTRIES);
            if (done) {
                this._retiredBankToken = null;
            }
        }
        this.port.postMessage({ type: 'retiredBankReleased', loadToken, done });
    }

    _drainQueue(blockEndFrame: number): void {
        while (this._queueHead < this._queue.length) {
            const queued = this._queue[this._queueHead];
            if (!queued || queued.sampleFrame >= blockEndFrame) {
                break;
            }
            this._dispatch(queued);
            this._queueHead++;
        }
        if (this._queueHead >= this._queue.length) {
            this._queue.length = 0;
            this._queueHead = 0;
        }
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        if (this._disposed) {
            return false;
        }
        if (!this._ready || !this._instance || this._faulted) {
            return true;
        }

        const output = outputs[0];
        if (!output || output.length < 2) {
            return true;
        }

        const out0 = output[0];
        if (!out0) {
            return true;
        }
        const frames = out0.length;
        const processFrames = Math.min(frames, 4096);

        // Due events dispatch while bypassed too: a controller that has no frame
        // applies at once, so a framed one held until un-bypass would land after
        // it and overwrite the newer value.
        const blockEndFrame = currentFrame + frames;
        this._drainQueue(blockEndFrame);

        if (this._bypassed) {
            return true;
        }

        try {
            const inst = this._instance;
            const mem = this._memory?.buffer;
            if (!mem) {
                return true;
            }

            const leftPtr = inst.process(processFrames);
            const rightPtr = inst.get_right_ptr();

            // Re-read the live buffer AFTER process(): a Rust-side allocation can
            // grow the linear memory mid-call and detach the previous buffer, so the
            // output views must map the post-grow buffer (audit RT-7). Steady state
            // leaves the identity unchanged and reuses the cached view.
            const outMem = this._memory?.buffer ?? mem;

            out0.set(this._outLeftView.get(outMem, leftPtr, processFrames));
            const out1 = output[1];
            if (out1) {
                out1.set(this._outRightView.get(outMem, rightPtr, processFrames));
            }
        } catch (error) {
            this._faultWithError(error);
        }

        return true;
    }
}

registerProcessor('levain-processor', LevainProcessor);
