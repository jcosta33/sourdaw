import { describe, it, expect, vi } from 'vitest';

// We must mock the dependencies before importing the module that registers them
vi.mock('../AudioDeviceStrategy', () => ({
    deviceRegistry: {
        register: vi.fn(),
    },
}));

vi.mock('../../faustDeviceFactory', () => ({ isFaustModule: vi.fn() }));
vi.mock('../../../engine/FermenterNode', () => ({ isFermenterDevice: vi.fn() }));
vi.mock('../../../engine/ToasterNode', () => ({ isToasterDevice: vi.fn() }));
vi.mock('../../../engine/LevainNode', () => ({ isLevainDevice: vi.fn() }));
vi.mock('../../../engine/GlutenNode', () => ({ isGlutenDevice: vi.fn() }));
vi.mock('../../../engine/BacteriaNode', () => ({ isBacteriaDevice: vi.fn() }));
vi.mock('../../../engine/GrinderNode', () => ({ isGrinderDevice: vi.fn() }));
vi.mock('../../../engine/ProofNode', () => ({ isProofDevice: vi.fn() }));
vi.mock('../../../engine/ProofChamberNode', () => ({ isProofChamberDevice: vi.fn() }));
vi.mock('../../../engine/ScoringNode', () => ({ isScoringDevice: vi.fn() }));

import { isFermenterDevice } from '../../../engine/FermenterNode';
import { isProofChamberDevice } from '../../../engine/ProofChamberNode';
import { isFaustModule } from '../../faustDeviceFactory';
import { deviceRegistry } from '../AudioDeviceStrategy';
import { createFaustStrategy } from '../FaustDeviceStrategy';
import { createNativeDspStrategy } from '../NativeDspDeviceStrategy';

// Now import the module under test
import '../setupDeviceStrategies';

describe('setupDeviceStrategies', () => {
    it('should register built-in web audio devices', () => {
        expect(deviceRegistry.register).toHaveBeenCalledWith('builtin-', expect.any(Function));
    });

    it('should register Faust devices', () => {
        expect(deviceRegistry.register).toHaveBeenCalledWith(isFaustModule, createFaustStrategy);
    });

    it('should register native DSP devices with a custom matcher', () => {
        const calls = vi.mocked(deviceRegistry.register).mock.calls;
        const nativeCall = calls.find((context) => context[1] === createNativeDspStrategy);

        expect(nativeCall).toBeDefined();

        const matcher = nativeCall![0] as (type: string) => boolean;

        vi.mocked(isFermenterDevice).mockReturnValue(true);
        expect(matcher('any')).toBe(true);

        vi.mocked(isFermenterDevice).mockReturnValue(false);
        vi.mocked(isProofChamberDevice).mockReturnValue(true);
        expect(matcher('any')).toBe(true);
    });
});
