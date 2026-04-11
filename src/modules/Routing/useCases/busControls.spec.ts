import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { ensureBusStrip } from './busControls/ensureBusStrip';
import { setBusGain } from './busControls/setBusGain';
import { setSend } from './busControls/setSend';

describe('busControls', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('ensureBusStrip forwards bus id to engine', () => {
        const ensureBusStripEngine = vi.fn();
        injectDependencies(ensureBusStrip, { ensureBusStripEngine });
        ensureBusStrip('bus-1');
        expect(ensureBusStripEngine).toHaveBeenCalledWith('bus-1');
    });

    it('setBusGain forwards bus id and gain', () => {
        const setBusGainEngine = vi.fn();
        injectDependencies(setBusGain, { setBusGainEngine });
        setBusGain('bus-1', 0.7);
        expect(setBusGainEngine).toHaveBeenCalledWith('bus-1', 0.7);
    });

    it('setSend forwards source/bus/level with default preFader=false', () => {
        const setSendEngine = vi.fn();
        injectDependencies(setSend, { setSendEngine });
        setSend('t1', 'bus-1', 0.5);
        expect(setSendEngine).toHaveBeenCalledWith('t1', 'bus-1', 0.5, false);
    });

    it('setSend supports preFader=true', () => {
        const setSendEngine = vi.fn();
        injectDependencies(setSend, { setSendEngine });
        setSend('t1', 'bus-1', 0.5, true);
        expect(setSendEngine).toHaveBeenCalledWith('t1', 'bus-1', 0.5, true);
    });
});
