import { describe, expect, it, vi } from 'vitest';

import { EVENT_CHANNEL, VOICE_DICTATION_TERMINAL_CHANNEL } from '../channels.js';
import { forwardNativeEvent } from '../nativeEventRouter.js';

describe('native event routing', () => {
    it('keeps dictation terminals out of the generic renderer event channel', () => {
        const events = { emit: vi.fn() };
        const target = { isDestroyed: () => false, send: vi.fn() };

        forwardNativeEvent('dictation-result', { session_id: 'voice-1', text: 'private' }, events, () => target);

        expect(events.emit).not.toHaveBeenCalledWith('dictation-result', expect.anything());
        expect(target.send).toHaveBeenCalledWith(VOICE_DICTATION_TERMINAL_CHANNEL, 'dictation-result', {
            session_id: 'voice-1',
            text: 'private',
        });
        expect(target.send).not.toHaveBeenCalledWith(EVENT_CHANNEL, expect.anything(), expect.anything());
    });
});
