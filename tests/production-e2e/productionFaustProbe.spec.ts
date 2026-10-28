import { Blob as NativeBlob } from 'node:buffer';
import { runInNewContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFaustProbe } from './productionFaustProbe';

// These fake native primitives calibrate instrumentation, not DSP or product audio.
// Analysers deliberately retain cached nonzero frames after disconnection.
function createCalibrationPlatform() {
    const revoked = new Set<string>();
    const moduleCalls: Array<{ url: string; options: WorkletOptions | undefined }> = [];
    const nodes: CalibrationWorkletNode[] = [];
    const analysers: CalibrationAnalyser[] = [];
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const nativeFailure = new Error('calibrated native failure');
    let urlSequence = 0;

    class CalibrationWorklet {
        addModule(url: string | URL, options?: WorkletOptions): Promise<void> {
            moduleCalls.push({ url: String(url), options });
            if (revoked.has(String(url))) {
                return Promise.reject(nativeFailure);
            }
            return Promise.resolve();
        }
    }
    class CalibrationParam {}
    class CalibrationNode {
        edges: Array<{ destination: CalibrationNode | CalibrationParam; output: number; input: number }> = [];
        connectFailure: Error | undefined;
        disconnectFailure: Error | undefined;
        diagnosticFailure: Error | undefined;

        constructor(readonly context: CalibrationContext) {}

        connect(destination: CalibrationNode, output?: number, input?: number): CalibrationNode;
        connect(destination: CalibrationParam, output?: number): void;
        connect(destination: CalibrationNode | CalibrationParam, ...ports: number[]): CalibrationNode | undefined {
            calls.push({ method: 'connect', args: [destination, ...ports] });
            if (this.connectFailure) {
                throw this.connectFailure;
            }
            if (destination instanceof CalibrationAnalyser && this.diagnosticFailure) {
                throw this.diagnosticFailure;
            }
            const output = ports[0] ?? 0;
            const input = ports[1] ?? 0;
            if (
                !this.edges.some(
                    (edge) => edge.destination === destination && edge.output === output && edge.input === input
                )
            ) {
                this.edges.push({ destination, output, input });
            }
            if (destination instanceof CalibrationNode) {
                return destination;
            }
        }

        disconnect(
            ...args:
                | []
                | [number]
                | [CalibrationNode | CalibrationParam]
                | [CalibrationNode | CalibrationParam, number]
                | [CalibrationNode, number, number]
        ): void {
            calls.push({ method: 'disconnect', args });
            if (this.disconnectFailure) {
                throw this.disconnectFailure;
            }
            if (args.length === 0) {
                this.edges = [];
                return;
            }
            const [destination, output, input] = args;
            const matches = (edge: (typeof this.edges)[number]): boolean => {
                if (typeof destination === 'number') {
                    return edge.output === destination;
                }
                return (
                    edge.destination === destination &&
                    (output === undefined || edge.output === output) &&
                    (input === undefined || edge.input === input)
                );
            };
            if (!this.edges.some(matches)) {
                throw new Error('Calibration disconnect has no matching native edge');
            }
            this.edges = this.edges.filter((edge) => !matches(edge));
        }
    }
    class CalibrationGain extends CalibrationNode {
        gain = new CalibrationParam();
    }
    class CalibrationAnalyser extends CalibrationNode {
        fftSize = 8;
        reads = 0;
        cachedSample = 0.25;

        getFloatTimeDomainData(samples: Float32Array): void {
            this.reads++;
            samples.fill(this.cachedSample);
        }
    }
    class CalibrationContext {
        audioWorklet = new CalibrationWorklet();

        createAnalyser(): CalibrationAnalyser {
            const analyser = new CalibrationAnalyser(this);
            analysers.push(analyser);
            return analyser;
        }

        createGain(): CalibrationGain {
            return new CalibrationGain(this);
        }
    }
    class CalibrationAudioContext extends CalibrationContext {}
    class CalibrationOfflineContext extends CalibrationContext {}
    class CalibrationWorkletNode extends CalibrationNode {
        constructor(
            context: CalibrationContext,
            readonly processorName: string
        ) {
            super(context);
            nodes.push(this);
        }
    }
    class CalibrationURL extends URL {
        static createObjectURL(): string {
            return `blob:calibration-${urlSequence++}`;
        }

        static revokeObjectURL(url: string): void {
            revoked.add(url);
        }
    }
    const globals = {
        AudioContext: CalibrationAudioContext,
        OfflineAudioContext: CalibrationOfflineContext,
        BaseAudioContext: CalibrationContext,
        AudioNode: CalibrationNode,
        AudioParam: CalibrationParam,
        AudioWorklet: CalibrationWorklet,
        AudioWorkletNode: CalibrationWorkletNode,
        Blob: NativeBlob,
        URL: CalibrationURL,
        MutationObserver,
        document,
    };
    return { globals, calls, nodes, analysers, moduleCalls, nativeFailure };
}

let platform: ReturnType<typeof createCalibrationPlatform>;

async function targetNode(): Promise<{ node: AudioWorkletNode; destination: GainNode }> {
    window.productionFaustProbe.setMode('pass');
    const context = new AudioContext();
    const source = 'const faustData = {"dspName":"Tape_Delay","processorName":"calibration-tape"};';
    await context.audioWorklet.addModule(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
    const node = new AudioWorkletNode(context, 'calibration-tape');
    expect(platform.nodes.at(-1)).toBe(node);
    return { node, destination: context.createGain() };
}

beforeEach(() => {
    platform = createCalibrationPlatform();
    for (const [name, value] of Object.entries(platform.globals)) {
        vi.stubGlobal(name, value);
    }
    installFaustProbe();
});

afterEach(() => {
    Reflect.deleteProperty(window, 'productionFaustProbe');
    vi.unstubAllGlobals();
});

describe('passive Faust diagnostic connection calibration', () => {
    it('admits only current app-connected output through promotion, rebuild, reconnect and teardown', async () => {
        const { node, destination } = await targetNode();
        expect(window.productionFaustProbe.snapshot()).toMatchObject({ tapCount: 0, samplePeak: 0 });
        expect(platform.nodes[0]?.edges).toEqual([]);
        expect(node.connect(destination)).toBe(destination);
        expect(window.productionFaustProbe.snapshot()).toMatchObject({ tapCount: 1, samplePeak: 0.25, finite: true });
        expect(platform.nodes[0]?.edges.map((edge) => edge.destination)).toEqual([destination, platform.analysers[0]]);
        expect(node.disconnect()).toBeUndefined();
        const readsBefore = platform.analysers[0]?.reads;
        expect(window.productionFaustProbe.snapshot()).toMatchObject({ tapCount: 0, samplePeak: 0 });
        expect(platform.analysers[0]?.reads).toBe(readsBefore);
        expect(platform.nodes[0]?.edges).toEqual([]);
        node.connect(destination);
        expect(window.productionFaustProbe.snapshot()).toMatchObject({ tapCount: 1, samplePeak: 0.25 });
        node.disconnect(destination);
        expect(window.productionFaustProbe.snapshot()).toMatchObject({ tapCount: 0, samplePeak: 0 });
        expect(platform.nodes[0]?.edges).toEqual([]);
    });

    it.each(['all', 'output', 'node', 'node-output', 'node-output-input', 'parameter', 'parameter-output'] as const)(
        'forwards the %s disconnect overload and invalidates the diagnostic branch',
        async (overload) => {
            const { node, destination } = await targetNode();
            let args: unknown[];
            if (overload === 'parameter' || overload === 'parameter-output') {
                expect(node.connect(destination.gain, 0)).toBeUndefined();
                platform.calls.length = 0;
                args = overload === 'parameter' ? [destination.gain] : [destination.gain, 0];
                if (overload === 'parameter') {
                    node.disconnect(destination.gain);
                } else {
                    node.disconnect(destination.gain, 0);
                }
            } else {
                expect(node.connect(destination, 0, 0)).toBe(destination);
                platform.calls.length = 0;
                if (overload === 'all') {
                    args = [];
                    node.disconnect();
                } else if (overload === 'output') {
                    args = [0];
                    node.disconnect(0);
                } else if (overload === 'node') {
                    args = [destination];
                    node.disconnect(destination);
                } else if (overload === 'node-output') {
                    args = [destination, 0];
                    node.disconnect(destination, 0);
                } else {
                    args = [destination, 0, 0];
                    node.disconnect(destination, 0, 0);
                }
            }
            expect(platform.calls[0]).toEqual({ method: 'disconnect', args });
            expect(platform.nodes[0]?.edges).toEqual([]);
            expect(window.productionFaustProbe.snapshot()).toMatchObject({ tapCount: 0, samplePeak: 0 });
        }
    );

    it('preserves native app connection returns and errors without admitting a failed connection', async () => {
        const { node, destination } = await targetNode();
        const native = platform.nodes[0];
        if (!native) {
            throw new Error('Missing calibrated native node');
        }
        native.connectFailure = platform.nativeFailure;
        expect(() => node.connect(destination)).toThrow(platform.nativeFailure);
        expect(window.productionFaustProbe.snapshot()).toMatchObject({ tapCount: 0, samplePeak: 0 });
        native.connectFailure = undefined;
        expect(node.connect(destination, 0, 0)).toBe(destination);
        expect(platform.calls.at(-2)).toEqual({ method: 'connect', args: [destination, 0, 0] });
        native.disconnectFailure = platform.nativeFailure;
        expect(() => node.disconnect()).toThrow(platform.nativeFailure);
        expect(window.productionFaustProbe.snapshot()).toMatchObject({ tapCount: 1, samplePeak: 0.25 });
        native.disconnectFailure = undefined;
        node.disconnect();
        expect(window.productionFaustProbe.snapshot()).toMatchObject({ tapCount: 0, samplePeak: 0 });
    });

    it('reports a diagnostic connection error separately while preserving the successful app call', async () => {
        const { node, destination } = await targetNode();
        const native = platform.nodes[0];
        if (!native) {
            throw new Error('Missing calibrated native node');
        }
        native.diagnosticFailure = platform.nativeFailure;
        expect(node.connect(destination)).toBe(destination);
        expect(native.edges.some((edge) => edge.destination === destination)).toBe(true);
        expect(() => window.productionFaustProbe.snapshot()).toThrow(platform.nativeFailure);
    });

    it('installs the same function serialized into an independent realm without module closures', () => {
        const fresh = createCalibrationPlatform();
        const sandbox: Record<string, unknown> = { ...fresh.globals };
        sandbox.window = sandbox;
        runInNewContext(`(${installFaustProbe.toString()})()`, sandbox);
        expect(sandbox.productionFaustProbe).toMatchObject({
            snapshot: expect.any(Function),
            release: expect.any(Function),
        });
    });
});
