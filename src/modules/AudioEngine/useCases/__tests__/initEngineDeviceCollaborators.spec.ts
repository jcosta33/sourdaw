import { afterEach, describe, expect, it, vi } from 'vitest';

import { asAudioNode, createMockAudioContext, createMockAudioNode } from '#/helpers/__tests__/audioContext.mock';

import { audioEngine, createAudioEngine } from '../../repositories/createWebAudioEngine';
import { captureDeviceParameterRuntimeWriteReceipt } from '../deviceControls/captureDeviceParameterRuntimeWriteReceipt';
import { applyParams } from '../deviceResolvers/applyParams';
import { createBuiltinDeviceNode } from '../deviceResolvers/createBuiltinDeviceNode';
import { createFaustDeviceNode } from '../deviceResolvers/createFaustDeviceNode';
import { engineDeviceCollaborators } from '../engineDeviceCollaborators';
import { initEngineDeviceCollaborators } from '../initEngineDeviceCollaborators';
import { clearReportedLatency } from '../latencyCompensation/compensation/clearReportedLatency';
import { reportLatency } from '../latencyCompensation/compensation/reportLatency';

function engineWithOneControlledDevice() {
    const engine = createAudioEngine(createMockAudioContext() as unknown as AudioContext);
    const node = asAudioNode(createMockAudioNode('gain'));
    const setParam = vi.fn();
    engine.ensureTrackStrip('track-1').deviceNodes.push({
        deviceId: 'device-1',
        type: 'test-device',
        nodes: [node],
        inputNode: node,
        outputNode: node,
        controller: { setParam, setBypass: vi.fn(), destroy: vi.fn() },
    });
    return { engine, setParam };
}

describe('engine device collaborators', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('hands the engine the AudioEngine use cases themselves', () => {
        expect(engineDeviceCollaborators).toEqual({
            createBuiltinDeviceNode,
            applyParams,
            captureParameterWriteReceipt: captureDeviceParameterRuntimeWriteReceipt,
            createFaustDeviceNode,
            reportLatency,
            clearReportedLatency,
        });
    });

    it('wires the live engine singleton with that bundle', () => {
        const wire = vi.spyOn(audioEngine, 'setUseCaseDeviceCollaborators');
        initEngineDeviceCollaborators();
        expect(wire).toHaveBeenCalledExactlyOnceWith(engineDeviceCollaborators);
    });

    it('refuses a parameter write on an unwired engine instead of dropping its receipt', () => {
        const { engine, setParam } = engineWithOneControlledDevice();
        expect(() => engine.updateDeviceParam('track-1', 'device-1', 'gain', 0.5)).toThrow(
            'AudioEngine captureParameterWriteReceipt is not wired'
        );
        expect(setParam).not.toHaveBeenCalled();
    });

    it('writes through once the collaborators are wired, and refuses again when unwired', () => {
        const { engine, setParam } = engineWithOneControlledDevice();
        engine.setUseCaseDeviceCollaborators(engineDeviceCollaborators);
        engine.updateDeviceParam('track-1', 'device-1', 'gain', 0.5);
        expect(setParam).toHaveBeenCalledExactlyOnceWith('gain', 0.5);

        engine.setUseCaseDeviceCollaborators(null);
        expect(() => engine.updateDeviceParam('track-1', 'device-1', 'gain', 0.25)).toThrow('is not wired');
    });
});
