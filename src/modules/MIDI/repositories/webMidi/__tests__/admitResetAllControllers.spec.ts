import { beforeEach, describe, expect, it } from 'vitest';

import { admitResetAllControllers } from '../admitResetAllControllers';
import { channelPitchBendState } from '../channelPitchBendState';

describe('admitResetAllControllers', () => {
    beforeEach(() => {
        channelPitchBendState.clear();
    });

    it('recentres only the channel whose Reset All Controllers it admits', () => {
        channelPitchBendState.set(1, 4096);
        channelPitchBendState.set(5, -4096);

        admitResetAllControllers(1);

        expect(channelPitchBendState.has(1)).toBe(false);
        expect(channelPitchBendState.get(5)).toBe(-4096);
    });
});
