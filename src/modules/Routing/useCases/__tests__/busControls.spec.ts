import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureBusStrip } from '../busControls/ensureBusStrip';
import { setBusGain } from '../busControls/setBusGain';
import { setSend } from '../busControls/setSend';

const mocks = vi.hoisted(() => ({
    ensureBusStripEngine: vi.fn(),
    setBusGainEngine: vi.fn(),
    setSendEngine: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases/engineAccess/ensureBusStrip', () => ({
    ensureBusStrip: mocks.ensureBusStripEngine,
}));
vi.mock('#/modules/AudioEngine/useCases/engineAccess/setBusGain', () => ({
    setBusGain: mocks.setBusGainEngine,
}));
vi.mock('#/modules/AudioEngine/useCases/engineAccess/setSend', () => ({
    setSend: mocks.setSendEngine,
}));

describe('busControls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('ensureBusStrip forwards bus id to engine', () => {
        ensureBusStrip('bus-1');
        expect(mocks.ensureBusStripEngine).toHaveBeenCalledWith('bus-1');
    });

    it('setBusGain forwards bus id and gain', () => {
        setBusGain('bus-1', 0.7);
        expect(mocks.setBusGainEngine).toHaveBeenCalledWith('bus-1', 0.7);
    });

    it('setSend forwards source/bus/level with default preFader=false', () => {
        setSend('t1', 'bus-1', 0.5);
        expect(mocks.setSendEngine).toHaveBeenCalledWith('t1', 'bus-1', 0.5, false);
    });

    it('setSend supports preFader=true', () => {
        setSend('t1', 'bus-1', 0.5, true);
        expect(mocks.setSendEngine).toHaveBeenCalledWith('t1', 'bus-1', 0.5, true);
    });
});