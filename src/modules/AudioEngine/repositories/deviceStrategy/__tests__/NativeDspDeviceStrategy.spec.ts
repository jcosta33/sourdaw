import { describe, it, expect, vi } from 'vitest';

import { NativeDspDeviceStrategy } from '../NativeDspDeviceStrategy';

describe('NativeDspDeviceStrategy', () => {
    it('should expose input and output as the worklet node', () => {
        const worklet = {} as AudioNode;
        const dspNode = { workletNode: worklet };
        const strategy = new NativeDspDeviceStrategy(dspNode);

        expect(strategy.node.inputNode).toBe(worklet);
        expect(strategy.node.outputNode).toBe(worklet);
        expect(strategy.node.nodes).toEqual([worklet]);
    });

    it('should forward setParam when the underlying node implements it', () => {
        const setParam = vi.fn();
        const strategy = new NativeDspDeviceStrategy({ workletNode: {}, setParam });

        strategy.setParam('gain', 0.5);
        expect(setParam).toHaveBeenCalledWith('gain', 0.5);
    });

    it('should not throw when setParam is missing', () => {
        const strategy = new NativeDspDeviceStrategy({ workletNode: {} });
        expect(() => strategy.setParam('x', 1)).not.toThrow();
    });

    it('should forward setBypass, noteOn, noteOff, and destroy when present', () => {
        const setBypass = vi.fn();
        const noteOn = vi.fn();
        const noteOff = vi.fn();
        const destroy = vi.fn();
        const strategy = new NativeDspDeviceStrategy({
            workletNode: {},
            setBypass,
            noteOn,
            noteOff,
            destroy,
        });

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
        const strategy = new NativeDspDeviceStrategy({ workletNode: {} });
        expect(() => strategy.setBypass(false)).not.toThrow();
        expect(() => strategy.noteOn(0, 0)).not.toThrow();
        expect(() => strategy.noteOff(0)).not.toThrow();
        expect(() => strategy.destroy()).not.toThrow();
    });
});
