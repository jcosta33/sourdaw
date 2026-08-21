/**
 * Grand Boule engine core — everything two hosts run identically.
 *
 * Grand Boule is rendered by two different transports, and the split is
 * deliberate rather than accidental:
 *
 *  - **Live** the WASM engine runs in a Web Worker and publishes into a
 *    SharedArrayBuffer ring that a consumer worklet drains. A Grand Boule
 *    overload starves its own ring and only Grand Boule drops out; the rest of
 *    the session keeps its deadline.
 *  - **Offline** the engine runs directly inside a plain `AudioWorkletProcessor`.
 *    An `OfflineAudioContext` has no system-level audio callback and therefore no
 *    load value and no underrun (Web Audio §2.6), so the ring protects against a
 *    deadline that does not exist — while its back-pressure and its
 *    consumer-offset plane are precisely what collapse an export into silence
 *    (INVENTORY-device-clock-parity G-1).
 *
 * Every serious plugin API formalises the same split: VST3
 * `ProcessSetup::processMode`, CLAP `clap_plugin_render`. What must *not* differ
 * is the engine and its control surface, and this module is where that is
 * enforced. Both hosts import it; neither may re-implement it.
 *
 * ## Isolation, and why this file lives in `worklets/`
 *
 * It may import `../wasm/daw_dsp.js`, plus its inert local construction seam,
 * and nothing else. One of its two hosts is an
 * `AudioWorkletGlobalScope`, which has no DOM, no `fetch` and no app module
 * graph; the other is a Worker under the same rule. An import added here that
 * reaches into `src/app`, `src/helpers` or another module breaks both.
 *
 * `worklets/` is where that constraint is enforced rather than merely described.
 * `deps:validate` bans `workers/` from importing `services/` — where the DSP
 * processors otherwise live — because a Worker must stay clear of business and
 * runtime code, and this file has to be reachable from *both* hosts.
 * `worklets/` and `workers/` are the two isolated private folders, each barred
 * from the same runtime list and each permitted to import the other, so it is
 * the only home that lets one implementation serve both without weakening a
 * boundary. It also activates a folder the dependency config has been
 * provisioning for exactly this.
 *
 * ## What compile-time enforcement buys
 *
 * `dispatch` switches exhaustively over `GrandBouleDispatchMsg` and ends in a
 * `never` arm, so adding a message type without handling it fails `pnpm
 * typecheck` instead of silently doing nothing in one host. Message drift is the
 * failure `tsc` can catch. Render-loop drift — the two ~30-line loops that differ
 * in trigger, output target and clock — is the accepted residual, and it is what
 * `grandBouleDispatchParity.spec.ts` exists for.
 */

import { initSync } from '../wasm/daw_dsp.js';

import { createGrandBouleWasmInstance, type GrandBouleInstance } from './grandBouleWasmInstance';

/** Voice ceiling both hosts construct the engine with. */
export const GRAND_BOULE_VOICE_COUNT = 64;

/** Map camelCase param names from TypeScript to snake_case for Rust. */
export const PARAM_MAP: Record<string, string> = {
    masterGain: 'master_gain',
    soundboardSend: 'soundboard_send',
    sympatheticSend: 'sympathetic_send',
    lidPosition: 'lid_position',
    micPosition: 'mic_position',
    stretchAmount: 'stretch_amount',
    attackBite: 'attack_bite',
    velocityCurve: 'velocity_curve',
    hammerHardnessScale: 'hammer_hardness_scale',
    hammerMassScale: 'hammer_mass_scale',
    soundboardBrightness: 'soundboard_brightness',
    sympatheticLevel: 'sympathetic_level',
    bodyResonance: 'body_resonance',
    toneColor: 'tone_color',
};

export type GrandBouleNoteOnMsg = {
    type: 'noteOn';
    midiNote: number;
    velocity: number;
    sampleFrame?: number;
    channel?: number;
};

export type GrandBouleNoteOffMsg = {
    type: 'noteOff';
    midiNote: number;
    sampleFrame?: number;
    releaseVelocity?: number;
    channel?: number;
};

export type GrandBouleNoteExpressionMsg = {
    type: 'noteExpression';
    midiNote: number;
    channel: number;
    bendSemitones: number;
    pressure: number;
    slide: number;
    sampleFrame?: number;
};

/** The three messages that address a moment in time rather than the device. */
export type GrandBouleFramedMsg = GrandBouleNoteOnMsg | GrandBouleNoteOffMsg | GrandBouleNoteExpressionMsg;

/** A framed message that actually carries a usable frame, so it can be queued. */
export type GrandBouleQueuedMsg = GrandBouleFramedMsg & { sampleFrame: number };

export type GrandBouleDispatchMsg =
    | GrandBouleNoteOnMsg
    | GrandBouleNoteOffMsg
    | GrandBouleNoteExpressionMsg
    | { type: 'param'; name: string; value: number }
    | { type: 'sustain'; position: number }
    | { type: 'unaCorda'; engaged: boolean }
    | { type: 'sostenuto'; engaged: boolean }
    | { type: 'noteOnMidi2'; midiNote: number; velocity16bit: number; pitchOffsetQ24: number }
    | { type: 'temperament'; index: number }
    | { type: 'loadAttackClip'; key: number; samples: Float32Array }
    | { type: 'allNotesOff' };

export type CreateGrandBouleInstanceInput = {
    /** The compiled `daw-dsp` module, shared by the node factory across hosts. */
    wasmModule: WebAssembly.Module;
    /** The host clock's rate: the worker is told it, a worklet reads `sampleRate`. */
    sampleRate: number;
};

export type CreateGrandBouleInstanceOutput = {
    instance: GrandBouleInstance;
    /**
     * The engine's linear memory. Read `memory.buffer` fresh every block — a
     * Rust-side allocation grows it and detaches the previous `ArrayBuffer`
     * (audit RT-7).
     */
    memory: WebAssembly.Memory;
};

/**
 * Instantiate the retained host engine through the source-owned seam. The seam
 * is inert in production and injected only by focused host tests.
 */
export function createGrandBouleInstance({
    wasmModule,
    sampleRate,
}: CreateGrandBouleInstanceInput): CreateGrandBouleInstanceOutput {
    const exports = initSync({ module: wasmModule });
    return {
        instance: createGrandBouleWasmInstance(sampleRate, GRAND_BOULE_VOICE_COUNT),
        memory: exports.memory,
    };
}

export type GrandBouleBlockViews = {
    /** The engine's left output for the block `update` was last called for. */
    readonly left: Float32Array;
    /** The engine's right output for the block `update` was last called for. */
    readonly right: Float32Array;
    /**
     * Point `left` and `right` at the block the engine just rendered, reusing
     * the cached views whenever the backing buffer, the pointers and the length
     * are unchanged. Pass `memory.buffer` read fresh after `process()`.
     *
     * Returns nothing on purpose: handing back a tuple would allocate an array
     * per block on the hit path and give back exactly what the cache saved.
     */
    update: (buffer: ArrayBufferLike, leftPtr: number, rightPtr: number, frames: number) => void;
};

/**
 * A pair of cached WASM linear-memory views over one rendered block.
 *
 * `new Float32Array(memory.buffer, ptr, length)` allocates even though it copies
 * nothing, so minting a pair per quantum feeds the GC on the render thread. The
 * views are rebuilt only when they must be: first block, a changed pointer or
 * block size, or — the correctness case, audit RT-7 — a `memory.grow()` that
 * *detached* the previous `ArrayBuffer` and left the cached view zero-length.
 * Growth shows up as a new buffer identity, which is why the caller must read
 * `memory.buffer` fresh each block and pass it in.
 *
 * This is the same contract as `services/wasmView.ts`, which the other seven
 * processors use, and it is restated rather than imported: `deps:validate`
 * forbids both `worklets/` and `workers/` from importing `services/`, and this
 * module has to be reachable from both. Consolidating one level up would move a
 * file thirty-one others depend on. In exchange both Grand Boule hosts now share
 * one cache — the engine Worker was allocating a fresh pair every block.
 *
 * **Shared blind spot, inherited deliberately.** Buffer *identity* is the growth
 * signal, and that only holds for a non-shared `WebAssembly.Memory`, where
 * `grow()` detaches the old `ArrayBuffer` and installs a new one. A memory
 * declared `shared` grows in place: `memory.buffer` keeps the same identity and
 * the same `byteLength`, so neither this nor `services/wasmView.ts` would notice.
 * It is safe today because `daw-dsp` is built without threads and its memory is
 * not shared; a threaded build would have to compare `byteLength` as well. Stated
 * here so the next reader does not have to re-derive it.
 *
 * Positional arguments and no return value, deliberately: an options object or a
 * returned tuple would allocate once per block and give back what the cache
 * saved. Read `left` / `right` after `update`.
 */
export function createGrandBouleBlockViews(): GrandBouleBlockViews {
    let cachedBuffer: ArrayBufferLike | null = null;
    let cachedLeftPtr = -1;
    let cachedRightPtr = -1;
    let cachedFrames = -1;

    // Annotated rather than inferred: `new Float32Array(0)` infers a view over a
    // plain `ArrayBuffer`, while a view minted over `WebAssembly.Memory`'s buffer
    // is `Float32Array<ArrayBufferLike>` — the wider type has to be the field's.
    const views: { left: Float32Array; right: Float32Array; update: GrandBouleBlockViews['update'] } = {
        left: new Float32Array(0),
        right: new Float32Array(0),
        update(buffer: ArrayBufferLike, leftPtr: number, rightPtr: number, frames: number): void {
            if (
                buffer === cachedBuffer &&
                leftPtr === cachedLeftPtr &&
                rightPtr === cachedRightPtr &&
                frames === cachedFrames
            ) {
                return;
            }
            views.left = new Float32Array(buffer, leftPtr, frames);
            views.right = new Float32Array(buffer, rightPtr, frames);
            cachedBuffer = buffer;
            cachedLeftPtr = leftPtr;
            cachedRightPtr = rightPtr;
            cachedFrames = frames;
        },
    };

    return views;
}

/**
 * Apply one control message to the engine.
 *
 * The `default` arm is the whole point of centralising this: a new member of
 * `GrandBouleDispatchMsg` that nobody handles fails to compile here rather than
 * being ignored in whichever host was not updated. It is *not* unreachable at
 * runtime — the senders are not type-welded — so see the arm itself for why it
 * ignores rather than raises.
 */
export function dispatch(instance: GrandBouleInstance, msg: GrandBouleDispatchMsg): void {
    switch (msg.type) {
        case 'noteOn':
            instance.note_on_with_channel(msg.midiNote, msg.velocity, msg.channel ?? 0);
            break;
        case 'noteExpression':
            // Grand Boule sounds bend only; pressure and slide are dropped
            // inside the engine rather than faked (audit MD-2).
            instance.note_expression(msg.midiNote, msg.channel, msg.bendSemitones, msg.pressure, msg.slide);
            break;
        case 'noteOff':
            // `msg.releaseVelocity` (normalized 0..1) is threaded to this engine
            // boundary from the live-MIDI Note Off. The current WASM ABI
            // (`note_off(midi_note)`) does not yet consume it; it is forwarded as
            // part of the typed message so the release dynamic is no longer
            // dropped at the control boundary.
            // Without a channel every voice at the pitch is released — the
            // historical behaviour channel-unaware callers rely on.
            if (msg.channel === undefined) {
                instance.note_off(msg.midiNote);
            } else {
                instance.note_off_on_channel(msg.midiNote, msg.channel);
            }
            break;
        case 'param':
            instance.set_param(PARAM_MAP[msg.name] ?? msg.name, msg.value);
            break;
        case 'sustain':
            instance.set_sustain(msg.position);
            break;
        case 'unaCorda':
            instance.set_una_corda(msg.engaged);
            break;
        case 'sostenuto':
            instance.set_sostenuto(msg.engaged);
            break;
        case 'noteOnMidi2':
            instance.note_on_midi2(msg.midiNote, msg.velocity16bit, msg.pitchOffsetQ24);
            break;
        case 'temperament':
            instance.set_temperament(msg.index);
            break;
        case 'loadAttackClip':
            instance.load_attack_clip(msg.key, msg.samples);
            break;
        case 'allNotesOff':
            instance.all_notes_off();
            break;
        default: {
            // Compile-time exhaustiveness, runtime tolerance — and the second
            // half is not a hedge.
            //
            // `never` fails the build for any member of `GrandBouleDispatchMsg`
            // nobody handled, which is the property worth having. But the weld
            // stops at the type: `GrandBouleNodeResult`'s `post` takes a
            // `Record<string, unknown>`, and `createWebAudioEngine` already
            // broadcasts `{type:'shutdown'}` to every device worklet, so an
            // unrecognised `type` can arrive here at runtime.
            //
            // Throwing on it was actively dangerous. The offline processor
            // catches whatever escapes its message handler, sets `_faulted`, and
            // then returns early from every remaining `process()`; its
            // `{type:'error'}` reply lands after `ready` has settled and is
            // dropped as 'late'. One stray message would silently produce the
            // exact silent export this transport exists to eliminate. The
            // pre-existing worker switch had no `default` and ignored unknowns;
            // that is the runtime behaviour, restated deliberately.
            const exhaustive: never = msg;
            void exhaustive;
            break;
        }
    }
}

export type GrandBouleNoteQueue = {
    /** Place a framed message at its frame, keeping the queue ordered. */
    enqueue: (msg: GrandBouleQueuedMsg) => void;
    /** Voice everything due strictly before `blockEndFrame`. */
    drain: (instance: GrandBouleInstance, blockEndFrame: number) => void;
    /** Drop everything pending. */
    clear: () => void;
    /** Pending messages, for tests and for host-side assertions. */
    size: () => number;
};

/**
 * A frame-ordered queue of note messages awaiting the block that contains them.
 *
 * Bounded by the transport's scheduling look-ahead live, and by the part length
 * offline — an export posts every note before rendering starts, which is exactly
 * why the queue exists at all. The drain path allocates nothing: only `enqueue`,
 * which runs on message arrival, touches the array's capacity, and the backing
 * array is truncated only once the queue has fully drained.
 */
export function createGrandBouleNoteQueue(): GrandBouleNoteQueue {
    /** `head` is the read index, so draining never shifts the array. */
    const queue: GrandBouleQueuedMsg[] = [];
    let head = 0;

    return {
        enqueue(msg) {
            // Insert keeping the queue sorted by frame, and stable within a
            // frame so a `noteExpression` posted after its `noteOn` at the same
            // frame still lands behind it — the voice must exist before it is
            // bent.
            let lo = head;
            let hi = queue.length;
            while (lo < hi) {
                const mid = (lo + hi) >>> 1;
                const candidate = queue[mid];
                if (candidate && candidate.sampleFrame <= msg.sampleFrame) {
                    lo = mid + 1;
                } else {
                    hi = mid;
                }
            }
            queue.splice(lo, 0, msg);
        },

        drain(instance, blockEndFrame) {
            // `blockEndFrame` is exclusive. Levain, Fermenter, Toaster and
            // Crumbs used to break on `sampleFrame > blockEnd`, which drained a
            // frame sitting exactly on the boundary one block early. All of them
            // now use this same `>=`, each covered by a boundary test.
            while (head < queue.length) {
                const queued = queue[head];
                if (!queued || queued.sampleFrame >= blockEndFrame) {
                    break;
                }
                dispatch(instance, queued);
                head++;
            }
            if (head >= queue.length) {
                queue.length = 0;
                head = 0;
            }
        },

        clear() {
            queue.length = 0;
            head = 0;
        },

        size() {
            return queue.length - head;
        },
    };
}

/** True when a framed message carries a frame a host can actually place. */
export function isPlaceableGrandBouleMsg(msg: GrandBouleFramedMsg): msg is GrandBouleQueuedMsg {
    return msg.sampleFrame !== undefined && Number.isFinite(msg.sampleFrame);
}

export function isFramedGrandBouleMsg(msg: GrandBouleDispatchMsg): msg is GrandBouleFramedMsg {
    return msg.type === 'noteOn' || msg.type === 'noteOff' || msg.type === 'noteExpression';
}

export type ReceiveGrandBouleMessageInput = {
    instance: GrandBouleInstance;
    queue: GrandBouleNoteQueue;
    msg: GrandBouleDispatchMsg;
    /**
     * First frame *after* the block the engine is about to produce, on the host
     * clock the message's `sampleFrame` is expressed in — the ring write head
     * plus the consumer offset in the worker, `currentFrame + 128` in a worklet.
     * `null` when the host cannot place a frame yet, which voices immediately.
     */
    blockEndFrame: number | null;
};

/**
 * Place a message at its frame, or voice it now.
 *
 * This is the one entry point both hosts route control messages through, so the
 * enqueue-or-voice decision cannot differ between them. "Now" covers three cases
 * that are all pre-existing behaviour: no frame was given, the host cannot place
 * frames yet, or the frame is inside (or behind) the block about to be produced.
 * A late note sounds late — never dropped, and never held back a further block.
 */
export function receiveGrandBouleMessage({ instance, queue, msg, blockEndFrame }: ReceiveGrandBouleMessageInput): void {
    if (msg.type === 'allNotesOff') {
        // A panic must also drop what has not sounded yet, or the pending
        // look-ahead window keeps arriving after the user asked for silence.
        queue.clear();
        dispatch(instance, msg);
        return;
    }

    if (!isFramedGrandBouleMsg(msg) || !isPlaceableGrandBouleMsg(msg) || blockEndFrame === null) {
        dispatch(instance, msg);
        return;
    }

    if (msg.sampleFrame < blockEndFrame) {
        dispatch(instance, msg);
        return;
    }

    queue.enqueue(msg);
}
