import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setTrackGain } from '#/modules/AudioEngine/useCases';

import { applyAutomation } from '../applyAutomation/applyAutomation';
import { applyVcaGains } from '../applyAutomation/applyVcaGains';

import type { AutomationStoreState } from '#/modules/Automation/stores';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...mod,
        trackStore: { value: { tracks: [] }, subscribe: vi.fn(() => () => {}) },
    };
});
const automationStoreMock = vi.hoisted((): { value: AutomationStoreState | null } => ({
    value: { lanes: [] },
}));

vi.mock('#/modules/Automation/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Automation/stores')>();
    return {
        ...mod,
        automationStore: automationStoreMock,
    };
});
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...mod,
        getEffectiveGain: vi.fn((_: string, g: number) => g),
    };
});
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...mod,
        setTrackGain: vi.fn(),
        setTrackPan: vi.fn(),
        updateDeviceParam: vi.fn(),
    };
});

describe('applyVcaGains', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not change gain when there are no tracks', () => {
        applyVcaGains();
        expect(setTrackGain).not.toHaveBeenCalled();
    });
});

describe('applyAutomation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not touch the engine when automation state is missing', () => {
        automationStoreMock.value = null;
        applyAutomation(0);
        expect(setTrackGain).not.toHaveBeenCalled();
    });
});
