import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ensureWorkletRegistered, fetchWasmModule } from '#/infra/audioWorklet/workletInitShared';

import { createCrumbsNode, isCrumbsDevice } from '../CrumbsNode';

// Mock the worklet-init helpers so createCrumbsNode resolves without a real
// AudioContext / worklet module / WASM fetch.
vi.mock('#/infra/audioWorklet/workletInitShared', () => ({
    ensureWorkletRegistered: vi.fn().mockResolvedValue(undefined),
    fetchWasmModule: vi.fn().mockResolvedValue({
        module: new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
        commit: vi.fn(),
        release: vi.fn(),
    }),
    createReadyHandshake: vi.fn(() => ({
        promise: Promise.resolve({}),
        onMessage: () => 'other' as const,
        isSettled: () => true,
    })),
}));

vi.mock('../../services/crumbsProcessor.ts?worker&url', () => ({ default: 'crumbs-processor-url' }));

describe('isCrumbsDevice', () => {
    // Matched exactly, not by prefix: the offline registry's `builtin-` WebAudio
    // arm keeps every other `builtin-*` id, and a prefix match here would steal
    // them all into the native arm.
    it('claims only the Crumbs catalog id', () => {
        expect(isCrumbsDevice('builtin-crumbs')).toBe(true);
        expect(isCrumbsDevice('builtin-filter')).toBe(false);
        expect(isCrumbsDevice('crumbs')).toBe(false);
    });
});

describe('createCrumbsNode', () => {
    let postMessage: ReturnType<typeof vi.fn>;
    let workletOptions: AudioWorkletNodeOptions | undefined;

    beforeEach(() => {
        postMessage = vi.fn();
        workletOptions = undefined;

        class FakeWorkletNode {
            constructor(_context: unknown, _processorName: string, options?: AudioWorkletNodeOptions) {
                workletOptions = options;
            }
            port = { postMessage, onmessage: null, close: vi.fn() };
            connect = vi.fn();
            disconnect = vi.fn();
        }
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    function makeCtx() {
        class FakeAudioContext {
            state = 'running';
            resume = vi.fn().mockResolvedValue(undefined);
        }
        vi.stubGlobal('AudioContext', FakeAudioContext);
        return new FakeAudioContext() as unknown as BaseAudioContext;
    }

    function messagesOfType(type: string): Record<string, unknown>[] {
        return postMessage.mock.calls
            .map(([message]) => message as Record<string, unknown>)
            .filter((message) => message.type === type);
    }

    /**
     * The slot order this node reads its arguments in.
     *
     * This is the assertion that holds the live path. `scheduleMidiNotes` calls
     * `crumbsControls.noteOn(pitch, velocity, sampleFrame, channel)` straight
     * through to this function — no adapter in between, unlike the offline
     * chain, which goes through `bindMelodicNotes` and is covered by
     * `nativeDspNoteBinding.spec.ts`.
     *
     * Crumbs was first written against Toaster's pad order
     * (`pad, velocity, midiNote?, sampleFrame?`), which reads slot 4 as the
     * frame. Nothing else catches that: all four parameters are `number`, so
     * the two signatures are mutually assignable and `tsc` is silent, and the
     * offline binding spec substitutes a stub for this whole function. The
     * effect was that every scheduled note arrived carrying the MPE channel as
     * its frame — 0 for a non-MPE note — and voiced at the top of the block.
     */
    it('reads the sample frame from slot 3, not the pad-ordered slot 4', async () => {
        const node = await createCrumbsNode(makeCtx());

        node.noteOn(62, 96, 480, 3);

        expect(messagesOfType('noteOn')).toEqual([{ type: 'noteOn', note: 62, velocity: 96, sampleFrame: 480 }]);
    });

    it('releases at the frame it is given', async () => {
        const node = await createCrumbsNode(makeCtx());

        node.noteOff(62, 960);

        expect(messagesOfType('noteOff')).toEqual([{ type: 'noteOff', note: 62, sampleFrame: 960 }]);
    });

    // Bypass gates new notes but not releases, so a voice held when bypass
    // engaged still gets its note-off and does not hang.
    it('drops note-ons while bypassed but still forwards note-offs', async () => {
        const node = await createCrumbsNode(makeCtx());

        node.setBypass(true);
        node.noteOn(60, 100, 0);
        node.noteOff(60, 480);

        expect(messagesOfType('noteOn')).toEqual([]);
        expect(messagesOfType('noteOff')).toEqual([{ type: 'noteOff', note: 60, sampleFrame: 480 }]);
    });

    // A non-finite parameter would reach `set_param` and poison the engine's
    // smoother for the rest of the render.
    it('refuses a non-finite parameter value rather than forwarding it', async () => {
        const node = await createCrumbsNode(makeCtx());

        node.setParam('masterGain', Number.NaN);
        node.setParam('masterGain', 0.5);

        expect(messagesOfType('param')).toEqual([{ type: 'param', name: 'masterGain', value: 0.5 }]);
    });

    // Which sample a device plays is project state. Loading one here would make
    // the node disagree with the project the moment it was constructed.
    it('loads no sample of its own on construction', async () => {
        await createCrumbsNode(makeCtx());

        expect(messagesOfType('loadSample')).toEqual([]);
    });

    it('passes the compiled module in processor options and posts an empty init message', async () => {
        await createCrumbsNode(makeCtx());

        expect(workletOptions?.processorOptions?.wasmModule).toBeInstanceOf(WebAssembly.Module);
        expect(messagesOfType('init')).toEqual([{ type: 'init' }]);
    });

    it('terminates the processor generation before closing its port', async () => {
        const node = await createCrumbsNode(makeCtx());

        node.destroy();

        expect(messagesOfType('dispose')).toEqual([{ type: 'dispose' }]);
        expect(node.workletNode.port.close).toHaveBeenCalledOnce();
    });

    it('abandons registration without fetching or constructing after cancellation', async () => {
        let resolveRegistration: () => void = () => {};
        const registration = new Promise<void>((resolve) => {
            resolveRegistration = resolve;
        });
        vi.mocked(ensureWorkletRegistered).mockReturnValueOnce(registration);
        const controller = new AbortController();

        const creating = createCrumbsNode(makeCtx(), undefined, undefined, controller.signal);
        controller.abort();
        resolveRegistration();

        await expect(creating).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchWasmModule).not.toHaveBeenCalled();
        expect(workletOptions).toBeUndefined();
    });
});
