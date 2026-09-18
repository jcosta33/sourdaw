import { describe, expect, it } from 'vitest';

import { CHAT_SYSTEM_PROMPT } from '../ChatSystemPrompt';

describe('CHAT_SYSTEM_PROMPT navigation guidance', () => {
    it('locates the prompt bar in the top transport bar, never at the bottom', () => {
        expect(CHAT_SYSTEM_PROMPT).toMatch(/prompt bar/i);
        expect(CHAT_SYSTEM_PROMPT).toContain('top transport bar');
        expect(CHAT_SYSTEM_PROMPT).not.toMatch(/prompt bar at the bottom/i);
        expect(CHAT_SYSTEM_PROMPT).not.toContain('At the bottom — type natural language');
    });

    it('lists the current left-sidebar tabs', () => {
        for (const tab of ['Instruments', 'Effects', 'Library', 'Macros', 'Project']) {
            expect(CHAT_SYSTEM_PROMPT).toContain(tab);
        }
        expect(CHAT_SYSTEM_PROMPT).not.toMatch(/Color \(effects\)/);
        expect(CHAT_SYSTEM_PROMPT).not.toMatch(/Stage \(effects\)/);
    });

    it('lists the current bottom dock panels', () => {
        for (const panel of ['Mixer', 'Editor', 'Automation', 'Session', 'Routing', 'Analysis']) {
            expect(CHAT_SYSTEM_PROMPT).toContain(panel);
        }
        expect(CHAT_SYSTEM_PROMPT).toContain('Bottom dock');
    });
});
