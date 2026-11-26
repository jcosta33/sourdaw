import { describe, expect, it, vi } from 'vitest';

import { createEngineDiagnostics, type EngineDiagnosticsPorts } from '../createEngineDiagnostics';

import type { BusNode } from '../../../engine/BusNode';
import type { TrackNode } from '../../../engine/TrackNode';
import type { BuiltinDeviceNode } from '../../../models/AudioEngineState';

function createPlaybackStats() {
    return {
        underrunDuration: 0,
        underrunEvents: 0,
        totalDuration: 1,
        averageLatency: 0.01,
        minimumLatency: 0.005,
        maximumLatency: 0.02,
        resetLatency: vi.fn(),
        toJSON: () => ({}),
    };
}

function createContextStub() {
    return {
        state: 'running' as AudioContextState,
        sampleRate: 48_000,
        currentTime: 3,
        baseLatency: 0.005,
        outputLatency: 0.01,
        playbackStats: createPlaybackStats(),
    };
}

function trackNodeWith(devices: Array<{ deviceId: string; type: string }>, loadStates: Record<string, string> = {}) {
    const node = {};
    return {
        strip: {
            meterNode: null,
            deviceNodes: devices.map(
                (device) =>
                    ({
                        ...device,
                        inputNode: node,
                        outputNode: node,
                        nodes: [],
                    }) as unknown as BuiltinDeviceNode
            ),
        },
        getDeviceLoadState: (deviceId: string) => loadStates[deviceId] ?? 'ready',
    } as unknown as TrackNode;
}

function createPorts(overrides: Partial<EngineDiagnosticsPorts> = {}) {
    const context = createContextStub();
    const ports: EngineDiagnosticsPorts = {
        lifecycle: {
            context: () => context as unknown as AudioContext,
            master: () =>
                ({ gainNode: { gain: { value: 0.5 } }, meterNode: () => undefined }) as unknown as ReturnType<
                    EngineDiagnosticsPorts['lifecycle']['master']
                >,
            isFallback: () => false,
            isWorkletReady: () => false,
            lastInitError: () => null,
            lastResumeError: () => null,
            latencyProfile: null,
            latencyHint: null,
        },
        trackNodes: new Map(),
        busNodes: new Map(),
        readSendCount: () => 0,
        readSidechainCount: () => 0,
        readAdjustmentDiagnostics: () => ({
            buses: 0,
            busesByEffectType: {},
            audioNodes: 0,
            audioWorkletProcessors: 0,
        }),
        readScheduledSourceCount: () => 0,
        deviceReadinessDiagnostics: {
            snapshot: vi.fn(),
        } as unknown as EngineDiagnosticsPorts['deviceReadinessDiagnostics'],
        ...overrides,
    };
    return { ports, context };
}

describe('createEngineDiagnostics', () => {
    it('keeps track and bus strip counts disjoint, because each bus owns a backing track node', () => {
        const { ports } = createPorts({
            trackNodes: new Map([
                ['t1', trackNodeWith([])],
                ['bus1', trackNodeWith([])],
            ]),
            busNodes: new Map([['bus1', {} as BusNode]]),
        });

        const { graph } = createEngineDiagnostics(ports).getDiagnostics();

        expect({ trackStrips: graph.trackStrips, busStrips: graph.busStrips }).toEqual({
            trackStrips: 1,
            busStrips: 1,
        });
    });

    it('counts ready, pending and failed devices apart, and types only the ready ones', () => {
        const { ports } = createPorts({
            trackNodes: new Map([
                [
                    't1',
                    trackNodeWith(
                        [
                            { deviceId: 'a', type: 'eq' },
                            { deviceId: 'b', type: 'eq' },
                            { deviceId: 'c', type: 'comp' },
                        ],
                        { b: 'pending', c: 'failed' }
                    ),
                ],
            ]),
        });

        const { graph } = createEngineDiagnostics(ports).getDiagnostics();

        expect({
            deviceInstances: graph.deviceInstances,
            pendingDeviceInstances: graph.pendingDeviceInstances,
            failedDeviceInstances: graph.failedDeviceInstances,
            deviceInstancesByType: graph.deviceInstancesByType,
        }).toEqual({
            deviceInstances: 1,
            pendingDeviceInstances: 1,
            failedDeviceInstances: 1,
            deviceInstancesByType: { eq: 1 },
        });
    });

    it('reports the closed silent state and an empty census on the fallback graph', () => {
        const { ports } = createPorts();
        const diagnostics = createEngineDiagnostics({
            ...ports,
            lifecycle: { ...ports.lifecycle, isFallback: () => true },
        });

        expect(diagnostics.getState()).toEqual({
            isReady: false,
            sampleRate: 44100,
            state: 'closed',
            masterGain: 0,
            currentTime: 0,
            baseLatency: 0,
            outputLatency: 0,
        });
        expect(diagnostics.getDiagnostics().playback).toBeNull();
        expect(diagnostics.isAudioAvailable()).toBe(false);
    });

    it('reads the live context state, the master gain and worklet readiness', () => {
        const { ports, context } = createPorts();
        context.state = 'suspended';
        const diagnostics = createEngineDiagnostics({
            ...ports,
            lifecycle: { ...ports.lifecycle, isWorkletReady: () => true },
        });

        expect(diagnostics.getState()).toEqual({
            isReady: true,
            sampleRate: 48_000,
            state: 'suspended',
            masterGain: 0.5,
            currentTime: 3,
            baseLatency: 0.005,
            outputLatency: 0.01,
        });
    });

    it('resets the Chrome latency window only on a live context', () => {
        const { ports, context } = createPorts();
        createEngineDiagnostics(ports).resetPlaybackLatencyStats();
        createEngineDiagnostics({
            ...ports,
            lifecycle: { ...ports.lifecycle, isFallback: () => true },
        }).resetPlaybackLatencyStats();

        expect(context.playbackStats.resetLatency).toHaveBeenCalledOnce();
    });

    it('reports the lifecycle errors in health', () => {
        const initError = new Error('init');
        const { ports } = createPorts();
        const health = createEngineDiagnostics({
            ...ports,
            lifecycle: { ...ports.lifecycle, lastInitError: () => initError },
        }).getHealth();

        expect(health.lastInitError).toBe(initError);
        expect(health.lastResumeError).toBeNull();
    });
});
