/**
 * The door a live write reaches the native session through for a built-in
 * whose controls are not `parameterValues` entries (#3124).
 *
 * `nativeBuiltinWriteTarget` is what decides whether the session is carrying a
 * body for this device; the send itself is exercised beside it because it is
 * the only thing this file adds on top of that decision.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type NativeBuiltinBody } from '../../livePlayback/nativeBuiltinBodies';
import { sendNativeDeviceParameters } from '../../livePlayback/sendNativeDeviceParameters';
import { nativeBuiltinWriteTarget } from '../nativeBuiltinWriteTarget';
import { writeNativeBuiltinParameters } from '../writeNativeBuiltinParameters';

vi.mock('../nativeBuiltinWriteTarget', () => ({
    nativeBuiltinWriteTarget: vi.fn(),
}));

vi.mock('../../livePlayback/sendNativeDeviceParameters', () => ({
    sendNativeDeviceParameters: vi.fn(async () => true),
}));

const STUB_BODY: NativeBuiltinBody = {
    soundsNotes: false,
    parameterName: (paramId) => paramId,
    projectPatch: () => ({}),
    addressesParameter: () => true,
    takesClipNoteReleases: true,
    latencyCompensatedByEngine: false,
};

describe('writeNativeBuiltinParameters', () => {
    beforeEach(() => {
        vi.mocked(nativeBuiltinWriteTarget).mockReset();
        vi.mocked(sendNativeDeviceParameters).mockClear();
    });

    it('sends nothing when no native body is carrying this device', () => {
        vi.mocked(nativeBuiltinWriteTarget).mockReturnValue(null);

        writeNativeBuiltinParameters('t', 'd', { master_gain: 0.4 });

        expect(sendNativeDeviceParameters).not.toHaveBeenCalled();
    });

    it('sends the write once a carried body answers for the device', () => {
        vi.mocked(nativeBuiltinWriteTarget).mockReturnValue(STUB_BODY);

        writeNativeBuiltinParameters('t', 'd', { master_gain: 0.4 });

        expect(sendNativeDeviceParameters).toHaveBeenCalledTimes(1);
        expect(sendNativeDeviceParameters).toHaveBeenCalledWith({
            trackId: 't',
            deviceId: 'd',
            values: { master_gain: 0.4 },
        });
    });
});
