// Each installer is serialized by Playwright as its own init script; keep every runtime
// dependency local or global. They share state through `window.productionFaustProbeState`,
// which the first installer creates, so they must be added in `faustProbeInitScripts` order.
type LoadMode = 'pass' | 'hold-live' | 'hold-offline' | 'reject-offline';
type LoadObservation = {
    context: 'live' | 'offline';
    processorName: string;
    heldAt: number | null;
    releasedAt: number | null;
    nativeInvoked: boolean;
    nativeCompleted: boolean;
    nativeRejected: string | null;
    constructions: number;
};
type ProbeSnapshot = {
    loads: LoadObservation[];
    tapCount: number;
    finite: boolean;
    samplePeak: number;
    successNotifications: number;
};
type FaustProbe = {
    setMode: (mode: LoadMode) => void;
    release: () => void;
    snapshot: () => ProbeSnapshot;
    observeSuccess: () => void;
    stopObservingSuccess: () => void;
};
type FaustProbeState = {
    blobs: Map<string, Blob>;
    contexts: WeakMap<AudioWorklet, { kind: 'live' | 'offline'; context: BaseAudioContext }>;
    contextLoads: WeakMap<BaseAudioContext, LoadObservation[]>;
    loads: LoadObservation[];
    taps: Array<{ analyser: AnalyserNode; connected: boolean }>;
    diagnosticErrors: unknown[];
    releases: Array<() => void>;
    mode: LoadMode;
    successNotifications: number;
    successObserver: MutationObserver | undefined;
};

declare global {
    interface Window {
        productionFaustProbe: FaustProbe;
        productionFaustProbeState: FaustProbeState;
    }
}

function installFaustProbeApi(): void {
    const state: FaustProbeState = {
        blobs: new Map(),
        contexts: new WeakMap(),
        contextLoads: new WeakMap(),
        loads: [],
        taps: [],
        diagnosticErrors: [],
        releases: [],
        mode: 'hold-live',
        successNotifications: 0,
        successObserver: undefined,
    };
    window.productionFaustProbeState = state;
    window.productionFaustProbe = {
        setMode(next) {
            state.mode = next;
        },
        release() {
            state.mode = 'pass';
            for (const resolve of state.releases.splice(0)) {
                resolve();
            }
        },
        observeSuccess() {
            state.successNotifications = 0;
            state.successObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.textContent?.includes('Audio exported')) {
                            state.successNotifications++;
                        }
                    }
                }
            });
            state.successObserver.observe(document.body, { childList: true, subtree: true });
        },
        stopObservingSuccess() {
            state.successObserver?.disconnect();
        },
        snapshot() {
            if (state.diagnosticErrors.length > 0) {
                throw state.diagnosticErrors[0];
            }
            let samplePeak = 0;
            let finite = true;
            const connectedTaps = state.taps.filter((tap) => tap.connected);
            for (const { analyser } of connectedTaps) {
                const samples = new Float32Array(analyser.fftSize);
                analyser.getFloatTimeDomainData(samples);
                for (const sample of samples) {
                    finite &&= Number.isFinite(sample);
                    samplePeak = Math.max(samplePeak, Math.abs(sample));
                }
            }
            return {
                // Snapshots are point-in-time: later load progress must not rewrite them.
                loads: state.loads.map((load) => ({
                    context: load.context,
                    processorName: load.processorName,
                    heldAt: load.heldAt,
                    releasedAt: load.releasedAt,
                    nativeInvoked: load.nativeInvoked,
                    nativeCompleted: load.nativeCompleted,
                    nativeRejected: load.nativeRejected,
                    constructions: load.constructions,
                })),
                tapCount: connectedTaps.length,
                finite,
                samplePeak,
                successNotifications: state.successNotifications,
            };
        },
    };
}

function captureFaustContexts(): void {
    const state = window.productionFaustProbeState;
    const createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
        const url = createObjectURL(blob);
        if (blob instanceof Blob && (blob.type === 'text/javascript' || blob.type === 'application/javascript')) {
            state.blobs.set(url, blob);
        }
        return url;
    };
    const NativeAudioContext = window.AudioContext;
    const NativeOfflineAudioContext = window.OfflineAudioContext;
    window.AudioContext = new Proxy(NativeAudioContext, {
        construct(target, args, newTarget) {
            const context: unknown = Reflect.construct(target, args, newTarget);
            if (!(context instanceof NativeAudioContext)) {
                throw new TypeError('Native AudioContext construction returned the wrong type');
            }
            state.contexts.set(context.audioWorklet, { kind: 'live', context });
            return context;
        },
    });
    window.OfflineAudioContext = new Proxy(NativeOfflineAudioContext, {
        construct(target, args, newTarget) {
            const context: unknown = Reflect.construct(target, args, newTarget);
            if (!(context instanceof NativeOfflineAudioContext)) {
                throw new TypeError('Native OfflineAudioContext construction returned the wrong type');
            }
            state.contexts.set(context.audioWorklet, { kind: 'offline', context });
            return context;
        },
    });
}

function holdFaustModuleLoads(): void {
    const state = window.productionFaustProbeState;
    const nativeAddModule = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = async function (url, options) {
        const blob = state.blobs.get(String(url));
        const source = blob === undefined ? '' : await blob.text();
        const serialized = /const faustData = (\{[^\n]+\});/.exec(source)?.[1];
        const data: unknown = serialized === undefined ? null : JSON.parse(serialized);
        if (data === null || typeof data !== 'object' || !('dspName' in data) || data.dspName !== 'Tape_Delay') {
            await nativeAddModule.call(this, url, options);
            return;
        }
        if (!('processorName' in data) || typeof data.processorName !== 'string') {
            throw new Error('Target Faust module has no processorName');
        }
        const context = state.contexts.get(this);
        if (context === undefined) {
            throw new Error('Target Faust worklet has no captured native context');
        }
        const load: LoadObservation = {
            context: context.kind,
            processorName: data.processorName,
            heldAt: null,
            releasedAt: null,
            nativeInvoked: false,
            nativeCompleted: false,
            nativeRejected: null,
            constructions: 0,
        };
        state.loads.push(load);
        const previousLoads = state.contextLoads.get(context.context) ?? [];
        previousLoads.push(load);
        state.contextLoads.set(context.context, previousLoads);
        const hold = state.mode === (context.kind === 'live' ? 'hold-live' : 'hold-offline');
        const reject = context.kind === 'offline' && state.mode === 'reject-offline';
        if (hold) {
            load.heldAt = performance.now();
            await new Promise<void>((resolve) => state.releases.push(resolve));
            load.releasedAt = performance.now();
        }
        // Revocation makes the saved browser loader fail on the actual Blob URL.
        // No substituted rejection may stand in for that native promise.
        if (reject) {
            URL.revokeObjectURL(String(url));
        }
        load.nativeInvoked = true;
        try {
            await nativeAddModule.call(this, url, options);
            load.nativeCompleted = true;
        } catch (error) {
            load.nativeRejected = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
            throw error;
        }
    };
}

function tapFaustWorkletNodes(): void {
    const state = window.productionFaustProbeState;
    const NativeAudioWorkletNode = window.AudioWorkletNode;
    window.AudioWorkletNode = new Proxy(NativeAudioWorkletNode, {
        construct(target, args, newTarget) {
            const name: unknown = args[1];
            const context: unknown = args[0];
            const contextLoads = context instanceof BaseAudioContext ? state.contextLoads.get(context) : undefined;
            const load = contextLoads?.findLast((entry) => entry.processorName === name);
            if (load !== undefined) {
                load.constructions++;
            }
            const node: unknown = Reflect.construct(target, args, newTarget);
            if (!(node instanceof NativeAudioWorkletNode)) {
                throw new TypeError('Native AudioWorkletNode construction returned the wrong type');
            }
            if (load?.context === 'live') {
                const analyser = node.context.createAnalyser();
                analyser.fftSize = 2048;
                const tap = { analyser, connected: false };
                let tapOutput = 0;
                const nativeConnect = node.connect;
                const nativeDisconnect = node.disconnect;
                // Report observer failures at observation time, without replacing
                // a successful application's native connection result.
                function observeConnection(action: () => void): void {
                    try {
                        action();
                    } catch (error) {
                        state.diagnosticErrors.push(error);
                    }
                }
                Object.defineProperties(node, {
                    connect: {
                        configurable: true,
                        writable: true,
                        value: new Proxy(nativeConnect, {
                            apply(target, receiver, args) {
                                const result: unknown = Reflect.apply(target, receiver, args);
                                if (receiver === node) {
                                    const requestedOutput: unknown = args[1];
                                    const output = typeof requestedOutput === 'number' ? requestedOutput : 0;
                                    observeConnection(() => {
                                        if (tap.connected && tapOutput !== output) {
                                            tap.connected = false;
                                            Reflect.apply(nativeDisconnect, node, [analyser, tapOutput, 0]);
                                        }
                                        if (!tap.connected) {
                                            Reflect.apply(nativeConnect, node, [analyser, output, 0]);
                                            tapOutput = output;
                                            tap.connected = true;
                                        }
                                    });
                                }
                                return result;
                            },
                        }),
                    },
                    disconnect: {
                        configurable: true,
                        writable: true,
                        value: new Proxy(nativeDisconnect, {
                            apply(target, receiver, args) {
                                const result: unknown = Reflect.apply(target, receiver, args);
                                if (receiver === node && tap.connected) {
                                    const destination: unknown = args[0];
                                    const output: unknown = args[1];
                                    const input: unknown = args[2];
                                    const removedAll = args.length === 0;
                                    const removedOutput = typeof destination === 'number' && destination === tapOutput;
                                    const removedTap =
                                        destination === analyser &&
                                        (output === undefined || output === tapOutput) &&
                                        (input === undefined || input === 0);
                                    tap.connected = false;
                                    if (!removedAll && !removedOutput && !removedTap) {
                                        observeConnection(() => {
                                            Reflect.apply(nativeDisconnect, node, [analyser, tapOutput, 0]);
                                        });
                                    }
                                }
                                return result;
                            },
                        }),
                    },
                });
                state.taps.push(tap);
            }
            return node;
        },
    });
}

export const faustProbeInitScripts = [
    installFaustProbeApi,
    captureFaustContexts,
    holdFaustModuleLoads,
    tapFaustWorkletNodes,
] as const;
