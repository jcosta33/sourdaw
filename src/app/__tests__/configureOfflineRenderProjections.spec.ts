import { beforeAll, describe, expect, it, vi } from 'vitest';

import { configureOfflineRenderProjections } from '../configureOfflineRenderProjections';

import type {
    configureOfflineDeviceParameterLaw,
    configureOfflineYeastMidiProcessing,
} from '#/modules/AudioEngine/useCases';

type DeviceParameterLaw = Parameters<typeof configureOfflineDeviceParameterLaw>[0];
type YeastProcessing = Parameters<typeof configureOfflineYeastMidiProcessing>[0];
type CreateProcessorInput = Parameters<YeastProcessing['createProcessor']>[0];
type CaptureExternalLawSource = Parameters<NonNullable<DeviceParameterLaw['captureExternalPluginLaw']>>[0];
type ExternalLawInput = Parameters<DeviceParameterLaw['clampExternalPluginValue']>[0];

// The composition root's offline wiring hands every capture to the AudioEngine
// configure* entries. Each owner is replaced by a double so the spec captures the
// argument the entry received and drives the callbacks the root builds itself.
const mocks = vi.hoisted(() => ({
    configureOfflineDeviceParameterLaw: vi.fn<(input: DeviceParameterLaw) => void>(),
    configureOfflineMidiEventProjection: vi.fn(),
    configureOfflinePpqEndpointProjection: vi.fn(),
    configureOfflineYeastMidiProcessing: vi.fn<(input: YeastProcessing) => void>(),
    acceptsExternalPluginAutomationParameter: vi.fn(),
    clampExternalPluginAutomationValue: vi.fn(),
    createMusicalPositionProjector: vi.fn(),
    createSamplePositionProjector: vi.fn(),
    createOfflineYeastMidiProcessor: vi.fn(),
    readYeastRack: vi.fn(),
    yeastDeviceIdsInProjectOrder: vi.fn<() => string[]>(),
    externalPluginParameterStore: ((): { value: Record<string, unknown> } => ({ value: {} }))(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    acceptsExternalPluginAutomationParameter: mocks.acceptsExternalPluginAutomationParameter,
    clampDeviceParameterValue: vi.fn(),
    clampExternalPluginAutomationValue: mocks.clampExternalPluginAutomationValue,
    isDeviceParameterAutomatable: vi.fn(),
    quantiseDeviceParameterValue: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    configureOfflineDeviceParameterLaw: mocks.configureOfflineDeviceParameterLaw,
    configureOfflineMidiEventProjection: mocks.configureOfflineMidiEventProjection,
    configureOfflinePpqEndpointProjection: mocks.configureOfflinePpqEndpointProjection,
    configureOfflineYeastMidiProcessing: mocks.configureOfflineYeastMidiProcessing,
}));

vi.mock('#/modules/Automation/useCases', () => ({
    createOfflineAutomationEvaluator: vi.fn(),
    getAutomationValueAtBeat: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    createChordPitchProjector: vi.fn(),
    createGrooveMidiEventProjector: vi.fn(),
    projectChannelBend: vi.fn(),
    projectClipControllerEvents: vi.fn(),
    resolveMidiNoteArticulationId: vi.fn(),
    shouldPlayMidiEvent: vi.fn(),
}));

vi.mock('#/modules/PluginHost/stores', () => ({
    externalPluginParameterStore: mocks.externalPluginParameterStore,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    beatAtSecondsFromAnchor: vi.fn(),
    createMusicalPositionProjector: mocks.createMusicalPositionProjector,
    createSamplePositionProjector: mocks.createSamplePositionProjector,
    projectPpqEndpoints: vi.fn(),
    resolveTempoAtBeat: vi.fn(),
}));

vi.mock('#/modules/Yeast/stores', () => ({
    holdsKeyedYeastRack: vi.fn(),
    holdsLegacyYeastRack: vi.fn(),
    readStoredYeastRack: vi.fn(),
    readYeastRack: mocks.readYeastRack,
    yeastDeviceIdsInProjectOrder: mocks.yeastDeviceIdsInProjectOrder,
}));

vi.mock('#/modules/Yeast/useCases', () => ({
    createOfflineYeastMidiProcessor: mocks.createOfflineYeastMidiProcessor,
}));

function getDeviceParameterLaw(): DeviceParameterLaw {
    const call = mocks.configureOfflineDeviceParameterLaw.mock.calls[0];
    if (!call) {
        throw new Error('the offline device parameter law was never configured');
    }
    return call[0];
}

function getYeastProcessing(): YeastProcessing {
    const call = mocks.configureOfflineYeastMidiProcessing.mock.calls[0];
    if (!call) {
        throw new Error('the offline Yeast processing was never configured');
    }
    return call[0];
}

describe('configureOfflineRenderProjections', () => {
    beforeAll(() => {
        configureOfflineRenderProjections();
    });

    describe('offline Yeast processor creation', () => {
        it('builds the processor from the render source’s racks, groove state and position projectors', () => {
            const tracks = [{ id: 'track-1' }];
            const source = {
                yeastProcessorsByDevice: { 'yeast-1': ['processor'] },
                grooveTemplates: { 'groove-1': 'template' },
            };
            const musical = vi.fn();
            const ppq = vi.fn();
            const processor = { name: 'offline-processor' };
            mocks.createMusicalPositionProjector.mockReturnValueOnce(musical);
            mocks.createSamplePositionProjector.mockReturnValueOnce(ppq);
            mocks.createOfflineYeastMidiProcessor.mockReturnValueOnce(processor);

            const created = getYeastProcessing().createProcessor({ tracks, source } as unknown as CreateProcessorInput);

            expect(created).toBe(processor);
            expect(mocks.createMusicalPositionProjector).toHaveBeenLastCalledWith(source);
            expect(mocks.createSamplePositionProjector).toHaveBeenLastCalledWith(source);
            expect(mocks.createOfflineYeastMidiProcessor).toHaveBeenLastCalledWith({
                tracks,
                processorsByDevice: source.yeastProcessorsByDevice,
                grooveState: source.grooveTemplates,
                resolveMusicalPosition: musical,
                resolvePpqPosition: ppq,
            });
        });

        it('creates a processor with no racks or groove state when the render has no source', () => {
            mocks.createOfflineYeastMidiProcessor.mockClear();

            getYeastProcessing().createProcessor(undefined);

            expect(mocks.createOfflineYeastMidiProcessor).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({
                    tracks: undefined,
                    processorsByDevice: undefined,
                    grooveState: undefined,
                })
            );
        });
    });

    describe('offline Yeast rack reads', () => {
        it('reads a device’s processors from its Yeast rack', () => {
            const processors = [{ id: 'p1' }];
            mocks.readYeastRack.mockReturnValueOnce({ processors, extra: 'ignored' });

            expect(getYeastProcessing().racks?.readRack('yeast-7')).toBe(processors);
            expect(mocks.readYeastRack).toHaveBeenLastCalledWith('yeast-7');
        });

        it('names the first Yeast device in project order, or null when the project has none', () => {
            mocks.yeastDeviceIdsInProjectOrder.mockReturnValueOnce(['yeast-b', 'yeast-a']);
            expect(getYeastProcessing().racks?.firstDeviceInProjectOrder()).toBe('yeast-b');

            mocks.yeastDeviceIdsInProjectOrder.mockReturnValueOnce([]);
            expect(getYeastProcessing().racks?.firstDeviceInProjectOrder()).toBeNull();
        });
    });

    describe('hosted-plugin parameter law capture', () => {
        const input = { instanceId: 'plugin-1', parameterId: 'p-1', value: 0.5 } as unknown as ExternalLawInput;

        it('judges parameters against a snapshot of the source taken at capture time', () => {
            const source = { instances: { 'plugin-1': { parameters: ['p-1'] } } };
            const law = getDeviceParameterLaw().captureExternalPluginLaw?.(
                source as unknown as CaptureExternalLawSource
            );
            source.instances['plugin-1'].parameters.push('added-after-capture');
            mocks.acceptsExternalPluginAutomationParameter.mockReturnValueOnce(true);

            expect(law?.acceptsExternalPluginParameter('plugin-1', 'p-1')).toBe(true);

            const [instanceId, parameterId, state] = mocks.acceptsExternalPluginAutomationParameter.mock.lastCall ?? [];
            expect([instanceId, parameterId]).toEqual(['plugin-1', 'p-1']);
            expect(state).toEqual({ instances: { 'plugin-1': { parameters: ['p-1'] } } });
            expect(state).not.toBe(source);
        });

        it('clamps a value against the same captured snapshot', () => {
            const source = { instances: {} };
            const law = getDeviceParameterLaw().captureExternalPluginLaw?.(
                source as unknown as CaptureExternalLawSource
            );
            mocks.clampExternalPluginAutomationValue.mockReturnValueOnce(0.25);

            expect(law?.clampExternalPluginValue(input)).toBe(0.25);

            expect(mocks.clampExternalPluginAutomationValue).toHaveBeenLastCalledWith(input, source);
            expect(mocks.clampExternalPluginAutomationValue.mock.lastCall?.[1]).not.toBe(source);
        });

        it('snapshots the live external plugin parameter store when no source is given', () => {
            mocks.externalPluginParameterStore.value = { live: true };
            const law = getDeviceParameterLaw().captureExternalPluginLaw?.();
            mocks.clampExternalPluginAutomationValue.mockReturnValueOnce(1);

            law?.clampExternalPluginValue(input);

            expect(mocks.clampExternalPluginAutomationValue.mock.lastCall?.[1]).toEqual({ live: true });
        });
    });
});
