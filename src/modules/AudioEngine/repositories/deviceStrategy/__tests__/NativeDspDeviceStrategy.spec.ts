import { describe, it, expect, vi } from 'vitest';

import { NativeDspDeviceStrategy } from '../NativeDspDeviceStrategy';

type NativeDspNode = ConstructorParameters<typeof NativeDspDeviceStrategy>[0];

function make_dsp_node(overrides: Partial<NativeDspNode> = {}): NativeDspNode {
    return {
        workletNode: {} as AudioWorkletNode,
        ready: Promise.resolve({}),
        ...overrides,
    };
}
describe('NativeDspDeviceStrategy', () => {
    it('should expose input and output as the worklet node', () => {
        const worklet = {} as AudioWorkletNode;
        const dspNode = make_dsp_node({ workletNode: worklet });
        const strategy = new NativeDspDeviceStrategy(dspNode);

        expect(strategy.node.inputNode).toBe(worklet);
        expect(strategy.node.outputNode).toBe(worklet);
        expect(strategy.node.nodes).toEqual([worklet]);
    });

    it('should forward setParam when the underlying node implements it', () => {
        const setParam = vi.fn();
        const strategy = new NativeDspDeviceStrategy(make_dsp_node({ setParam }));

        strategy.setParam('gain', 0.5);
        expect(setParam).toHaveBeenCalledWith('gain', 0.5);
    });

    it('exposes scheduled parameters only when the node provides the complete capability pair', () => {
        const acceptsScheduledParam = vi.fn((name: string) => name === 'mix');
        const scheduleParam = vi.fn();
        const segments = [{ startFrame: 0, endFrame: 128, startValue: 0.2, endValue: 0.8 }];
        const strategy = new NativeDspDeviceStrategy(make_dsp_node({ acceptsScheduledParam, scheduleParam }));

        expect(strategy.acceptsScheduledParam?.('mix')).toBe(true);
        strategy.scheduleParam?.('mix', segments);

        expect(acceptsScheduledParam).toHaveBeenCalledWith('mix');
        expect(scheduleParam).toHaveBeenCalledWith('mix', segments);

        const partial = new NativeDspDeviceStrategy(make_dsp_node({ scheduleParam }));
        expect(partial.acceptsScheduledParam).toBeUndefined();
        expect(partial.scheduleParam).toBeUndefined();
    });

    it('forwards Toaster pad output and dry-ownership controls', () => {
        const connectPadOutput = vi.fn();
        const disconnectPadOutput = vi.fn();
        const setPadDryRouted = vi.fn();
        const strategy = new NativeDspDeviceStrategy(
            make_dsp_node({ connectPadOutput, disconnectPadOutput, setPadDryRouted })
        );
        const destination = {} as AudioNode;

        strategy.connectPadOutput(3, destination);
        strategy.disconnectPadOutput(3, destination);
        strategy.setPadDryRouted(3, true);

        expect(connectPadOutput).toHaveBeenCalledWith(3, destination);
        expect(disconnectPadOutput).toHaveBeenCalledWith(3, destination);
        expect(setPadDryRouted).toHaveBeenCalledWith(3, true);
    });

    it('should not throw when setParam is missing', () => {
        const strategy = new NativeDspDeviceStrategy(make_dsp_node());
        expect(() => strategy.setParam('x', 1)).not.toThrow();
    });

    it('should forward setBypass, noteOn, noteOff, and destroy when present', () => {
        const setBypass = vi.fn();
        const noteOn = vi.fn();
        const noteOff = vi.fn();
        const destroy = vi.fn();
        const strategy = new NativeDspDeviceStrategy(
            make_dsp_node({
                setBypass,
                noteOn,
                noteOff,
                destroy,
            })
        );

        strategy.setBypass(true);
        strategy.noteOn(60, 100);
        strategy.noteOn(60, 100, 72);
        strategy.noteOff(60);
        strategy.destroy();

        expect(setBypass).toHaveBeenCalledWith(true);
        expect(noteOn).toHaveBeenNthCalledWith(1, 60, 100, undefined, undefined);
        expect(noteOn).toHaveBeenNthCalledWith(2, 60, 100, 72, undefined);
        expect(noteOff).toHaveBeenCalledWith(60, undefined);
        expect(destroy).toHaveBeenCalled();
    });

    it('should not throw when optional methods are missing', () => {
        const strategy = new NativeDspDeviceStrategy(make_dsp_node());
        const destination = {} as AudioNode;
        expect(() => strategy.setBypass(false)).not.toThrow();
        expect(() => strategy.noteOn(0, 0)).not.toThrow();
        expect(() => strategy.noteOff(0)).not.toThrow();
        expect(() => strategy.connectPadOutput(0, destination)).not.toThrow();
        expect(() => strategy.disconnectPadOutput(0, destination)).not.toThrow();
        expect(() => strategy.setPadDryRouted(0, false)).not.toThrow();
        expect(() => strategy.destroy()).not.toThrow();
    });
});
