import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isOfflineInstrumentDevice } from '../isOfflineInstrumentDevice';

const mocks = vi.hoisted(() => ({
    isFaustInstrumentModule: vi.fn<(moduleId: string) => boolean>(() => false),
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    isFaustInstrumentModule: mocks.isFaustInstrumentModule,
}));

describe('isOfflineInstrumentDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isFaustInstrumentModule.mockReturnValue(false);
    });

    // The catalog id is `builtin-crumbs` (CrumbsDescriptor), never bare
    // `crumbs`. The set held the bare string, so the match never fired and a
    // dry bounce stripped the sampler out of the track entirely.
    it.each(['fermenter', 'grand-boule', 'levain', 'toaster', 'builtin-crumbs', 'builtin-drum-machine-808'])(
        'keeps %s, which is what makes the sound on a dry bounce',
        (deviceType) => {
            expect(isOfflineInstrumentDevice(deviceType)).toBe(true);
        }
    );

    it.each(['dutch-oven', 'gluten', 'grinder', 'proof', 'builtin-filter'])(
        'drops %s, which is an insert a dry bounce excludes',
        (deviceType) => {
            expect(isOfflineInstrumentDevice(deviceType)).toBe(false);
        }
    );

    // MD-4 review — matching the `faust-` prefix kept every Faust *effect* on a
    // dry bounce, so the take came back wet. registerFaustDSP records a real
    // isInstrument flag; that is the authority.
    it('asks whether a Faust module is an instrument rather than reading its id prefix', () => {
        mocks.isFaustInstrumentModule.mockImplementation((moduleId) => moduleId === 'faust-additive-synth');

        expect(isOfflineInstrumentDevice('faust-additive-synth')).toBe(true);
        expect(isOfflineInstrumentDevice('faust-zita-rev1-reverb')).toBe(false);
        expect(mocks.isFaustInstrumentModule).toHaveBeenCalledWith('faust-zita-rev1-reverb');
    });
});
