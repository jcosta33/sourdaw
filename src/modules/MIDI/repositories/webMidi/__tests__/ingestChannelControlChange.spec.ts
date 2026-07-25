import { beforeEach, describe, expect, it } from 'vitest';

import { channelControllerState } from '../channelControllerState';
import { getChannelBendRangeSemitones } from '../getChannelBendRangeSemitones';
import { ingestChannelControlChange } from '../ingestChannelControlChange';
import { resetChannelControllerState } from '../resetChannelControllerState';

const CHANNEL = 3;

/** CC 7 (Channel Volume) / CC 39 — the canonical 14-bit MSB/LSB pair. */
const VOLUME_MSB = 7;
const VOLUME_LSB = 39;

function ingest(cc: number, value: number, channel = CHANNEL) {
    return ingestChannelControlChange({ channel, cc, value });
}

/** Drive the four-message sequence a controller sends to declare its bend range. */
function declareBendRange(semitones: number, cents: number, channel = CHANNEL): void {
    ingest(101, 0, channel);
    ingest(100, 0, channel);
    ingest(6, semitones, channel);
    ingest(38, cents, channel);
}

describe('ingestChannelControlChange', () => {
    beforeEach(() => {
        resetChannelControllerState();
    });

    describe('14-bit high-resolution controllers (MD-7)', () => {
        it('assembles an MSB/LSB pair into a 14-bit value addressed to the MSB controller', () => {
            ingest(VOLUME_MSB, 100);
            const resolved = ingest(VOLUME_LSB, 43);

            expect(resolved.cc).toBe(VOLUME_MSB);
            expect(resolved.value14).toBe((100 << 7) | 43);
            expect(resolved.highResolution).toBe(true);
            expect(resolved.normalized).toBeCloseTo(12843 / 16383, 10);
        });

        it('distinguishes two LSB values under the same MSB, which 7-bit input collapses', () => {
            ingest(VOLUME_MSB, 100);
            const low = ingest(VOLUME_LSB, 0);
            const high = ingest(VOLUME_LSB, 127);

            // Both report MSB 100; only the 14-bit value tells them apart.
            expect(low.value).toBe(100);
            expect(high.value).toBe(100);
            expect(high.value14 - low.value14).toBe(127);
            expect(high.normalized).toBeGreaterThan(low.normalized);
        });

        it('keeps a controller that only ever sends the MSB at 7-bit full scale', () => {
            const resolved = ingest(VOLUME_MSB, 127);

            // 127 << 7 is 16256/16383 = 0.992 — a volume CC that can no longer
            // reach unity. Until an LSB actually arrives, 127 means full scale.
            expect(resolved.highResolution).toBe(false);
            expect(resolved.normalized).toBe(1);
        });

        it('restarts the value on a new MSB rather than combining it with the stale LSB', () => {
            ingest(VOLUME_MSB, 100);
            ingest(VOLUME_LSB, 127);
            const restarted = ingest(VOLUME_MSB, 20);

            expect(restarted.value14).toBe(20 << 7);
            expect(restarted.highResolution).toBe(true);
        });

        it('treats an LSB controller with no MSB ever seen as an ordinary 7-bit control', () => {
            const resolved = ingest(VOLUME_LSB, 64);

            expect(resolved.cc).toBe(VOLUME_LSB);
            expect(resolved.highResolution).toBe(false);
            expect(resolved.normalized).toBeCloseTo(64 / 127, 10);
        });

        it('keeps high-resolution latches per channel', () => {
            ingest(VOLUME_MSB, 100, 0);
            ingest(VOLUME_LSB, 127, 0);
            const otherChannel = ingest(VOLUME_LSB, 5, 1);

            // Channel 1 never sent an MSB, so its LSB is not half of a pair.
            expect(otherChannel.cc).toBe(VOLUME_LSB);
            expect(otherChannel.highResolution).toBe(false);
        });

        it('leaves controllers above the 14-bit range at 7-bit', () => {
            const sustain = ingest(64, 127);

            expect(sustain.cc).toBe(64);
            expect(sustain.highResolution).toBe(false);
            expect(sustain.normalized).toBe(1);
        });
    });

    describe('RPN 0 pitch-bend sensitivity (MD-8)', () => {
        it('records the semitone range a controller declares', () => {
            declareBendRange(12, 0);

            expect(getChannelBendRangeSemitones(CHANNEL)).toBe(12);
        });

        it('adds the cents byte to the semitone byte', () => {
            declareBendRange(2, 50);

            expect(getChannelBendRangeSemitones(CHANNEL)).toBeCloseTo(2.5, 10);
        });

        it('consumes the parameter-select and data-entry messages so they cannot move a mapped control', () => {
            expect(ingest(101, 0).consumed).toBe(true);
            expect(ingest(100, 0).consumed).toBe(true);
            expect(ingest(6, 12).consumed).toBe(true);
            expect(ingest(38, 0).consumed).toBe(true);
        });

        it('reports no declared range for a channel that never sent RPN 0', () => {
            declareBendRange(12, 0, 1);

            expect(getChannelBendRangeSemitones(2)).toBeUndefined();
        });

        it('releases Data Entry back to being an ordinary controller after the Null RPN', () => {
            declareBendRange(12, 0);
            // 101/100 = 127/127 is the Null parameter: controllers send it so a
            // later Data Entry cannot land on the parameter they just wrote.
            ingest(101, 127);
            ingest(100, 127);

            const dataEntry = ingest(6, 96);

            expect(dataEntry.consumed).toBe(false);
            expect(dataEntry.cc).toBe(6);
            expect(getChannelBendRangeSemitones(CHANNEL)).toBe(12);
        });

        it('does not let an NRPN data entry overwrite the bend range', () => {
            declareBendRange(12, 0);
            // Select an NRPN; its data entry belongs to that parameter, not RPN 0.
            ingest(99, 1);
            ingest(98, 40);
            const nrpnData = ingest(6, 96);

            expect(nrpnData.consumed).toBe(true);
            expect(getChannelBendRangeSemitones(CHANNEL)).toBe(12);
        });

        it('does not compose a parameter number out of two different banks', () => {
            // RPN MSB then NRPN LSB: the RPN half must be abandoned, or
            // (rpnMsb=0, nrpnLsb=0) would look like RPN 0 and take the data.
            ingest(101, 0);
            ingest(98, 0);
            ingest(6, 96);

            expect(getChannelBendRangeSemitones(CHANNEL)).toBeUndefined();
        });

        it('steps the range by a semitone on Data Increment and Decrement', () => {
            declareBendRange(12, 0);
            ingest(96, 0);
            expect(getChannelBendRangeSemitones(CHANNEL)).toBe(13);

            ingest(97, 0);
            ingest(97, 0);
            expect(getChannelBendRangeSemitones(CHANNEL)).toBe(11);
        });

        it('does not let a Data Increment drive the range below zero', () => {
            declareBendRange(0, 0);
            ingest(97, 0);

            expect(getChannelBendRangeSemitones(CHANNEL)).toBe(0);
        });
    });

    describe('hostile and out-of-spec input', () => {
        it('clamps a data byte above the legal 7-bit range', () => {
            const resolved = ingest(64, 300);

            expect(resolved.value).toBe(127);
            expect(resolved.normalized).toBe(1);
        });

        it('clamps a negative data byte', () => {
            const resolved = ingest(64, -20);

            expect(resolved.value).toBe(0);
            expect(resolved.normalized).toBe(0);
        });

        it('treats a non-finite data byte as zero rather than producing NaN', () => {
            const resolved = ingest(64, Number.NaN);

            expect(resolved.value).toBe(0);
            expect(resolved.normalized).toBe(0);
        });

        it('clamps an out-of-spec cents byte below the next whole semitone', () => {
            // 100+ cents would push the range past the semitone the MSB owns.
            declareBendRange(2, 127);

            expect(getChannelBendRangeSemitones(CHANNEL)).toBeCloseTo(2.99, 10);
        });

        it('assembles a 14-bit pair from out-of-range halves without exceeding full scale', () => {
            ingest(VOLUME_MSB, 999);
            const resolved = ingest(VOLUME_LSB, 999);

            expect(resolved.value14).toBe(16383);
            expect(resolved.normalized).toBe(1);
        });
    });

    it('drops every channel entry on reset so a new controller starts at spec defaults', () => {
        declareBendRange(12, 0);
        ingest(VOLUME_MSB, 100);
        ingest(VOLUME_LSB, 43);

        resetChannelControllerState();

        expect(channelControllerState.size).toBe(0);
        expect(getChannelBendRangeSemitones(CHANNEL)).toBeUndefined();
        expect(ingest(VOLUME_LSB, 43).highResolution).toBe(false);
    });
});
