import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getChannelBendRangeSemitones: vi.fn(),
    getDefaultBendRangeSemitones: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getDefaultBendRangeSemitones: mocks.getDefaultBendRangeSemitones,
}));

vi.mock('../../../repositories/webMidi/getChannelBendRangeSemitones', () => ({
    getChannelBendRangeSemitones: mocks.getChannelBendRangeSemitones,
}));

import { resolveBendRangeSemitones } from '../resolveBendRangeSemitones';

describe('resolveBendRangeSemitones — 4-branch resolution cascade', () => {
    it('returns the channel-declared range when RPN 0 has set it', () => {
        mocks.getChannelBendRangeSemitones.mockReturnValue(7);
        mocks.getDefaultBendRangeSemitones.mockReturnValue(48);
        expect(resolveBendRangeSemitones({ channel: 3, mpeEnabled: false })).toBe(7);
    });

    it('returns the zone master range for an undeclared MPE member', () => {
        // channel 5 is undeclared; master (0) declared 24.
        mocks.getChannelBendRangeSemitones.mockImplementation((ch: number) => (ch === 0 ? 24 : undefined));
        mocks.getDefaultBendRangeSemitones.mockReturnValue(48);
        expect(resolveBendRangeSemitones({ channel: 5, mpeEnabled: true })).toBe(24);
    });

    it('returns the MPE default (48) for an undeclared member with no zone master', () => {
        mocks.getChannelBendRangeSemitones.mockReturnValue(undefined);
        mocks.getDefaultBendRangeSemitones.mockReturnValue(48);
        expect(resolveBendRangeSemitones({ channel: 2, mpeEnabled: true })).toBe(48);
    });

    it('returns ±2 (STANDARD_BEND_RANGE_SEMITONES) for a non-MPE undeclared channel', () => {
        mocks.getChannelBendRangeSemitones.mockReturnValue(undefined);
        expect(resolveBendRangeSemitones({ channel: 3, mpeEnabled: false })).toBe(2);
    });

    it('returns ±2 for the master channel (0) even with MPE enabled', () => {
        mocks.getChannelBendRangeSemitones.mockReturnValue(undefined);
        // channel 0 is MPE_MASTER_CHANNEL, not a member, so falls to ±2.
        expect(resolveBendRangeSemitones({ channel: 0, mpeEnabled: true })).toBe(2);
    });

    it('does not consult the zone master when MPE is disabled', () => {
        mocks.getChannelBendRangeSemitones.mockReturnValue(undefined);
        // MPE disabled → no zone-master fallback, straight to ±2.
        expect(resolveBendRangeSemitones({ channel: 5, mpeEnabled: false })).toBe(2);
    });
});
