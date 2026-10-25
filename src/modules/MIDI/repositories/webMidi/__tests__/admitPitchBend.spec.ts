import { beforeEach, describe, expect, it } from 'vitest';

import { admitPitchBend } from '../admitPitchBend';
import { channelPitchBendState } from '../channelPitchBendState';

describe('admitPitchBend', () => {
    beforeEach(() => {
        channelPitchBendState.clear();
    });

    it('keeps the wheel position of each channel as the signed 14-bit delta from centre', () => {
        admitPitchBend(1, 0, 96);
        admitPitchBend(2, 127, 127);
        admitPitchBend(3, 0, 0);

        expect(channelPitchBendState.get(1)).toBe(4096);
        expect(channelPitchBendState.get(2)).toBe(8191);
        expect(channelPitchBendState.get(3)).toBe(-8192);
    });

    it('moves a channel to its latest bend, a centred one included', () => {
        admitPitchBend(1, 0, 96);
        admitPitchBend(1, 0, 64);

        expect(channelPitchBendState.get(1)).toBe(0);
    });
});
