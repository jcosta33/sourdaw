import { describe, it, expect, vi, beforeEach } from 'vitest';

import { generateNativeToolCalls } from '../nativeToolCalling';

const mocks = vi.hoisted(() => ({
    isTauri: vi.fn(),
    tauriInvoke: vi.fn(),
}));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: mocks.isTauri,
    tauriInvoke: mocks.tauriInvoke,
}));

describe('generateNativeToolCalls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return null without invoking native tool calling outside Tauri', async () => {
        mocks.isTauri.mockReturnValue(false);

        const result = await generateNativeToolCalls({
            systemPrompt: 'system',
            userMessage: 'mute drums',
            tools: [{ name: 'mute_track', description: 'Mute a track', parameters: { type: 'object' } }],
            temperature: 0.1,
        });

        expect(result).toBeNull();
        expect(mocks.tauriInvoke).not.toHaveBeenCalled();
    });

    it('should invoke native_tool_calling and narrow valid tool-call payloads', async () => {
        mocks.isTauri.mockReturnValue(true);
        mocks.tauriInvoke.mockResolvedValue([{ name: 'mute_track', arguments: { track_id: 'track-1', muted: true } }]);

        const result = await generateNativeToolCalls({
            systemPrompt: 'system',
            userMessage: 'mute drums',
            tools: [{ name: 'mute_track', description: 'Mute a track', parameters: { type: 'object' } }],
            temperature: 0.1,
        });

        expect(mocks.tauriInvoke).toHaveBeenCalledWith('native_tool_calling', {
            systemPrompt: 'system',
            userMessage: 'mute drums',
            tools: [{ name: 'mute_track', description: 'Mute a track', parameters: { type: 'object' } }],
            temperature: 0.1,
        });
        expect(result).toEqual([{ name: 'mute_track', arguments: { track_id: 'track-1', muted: true } }]);
    });

    it('should reject malformed native_tool_calling payloads before use cases consume them', async () => {
        mocks.isTauri.mockReturnValue(true);
        mocks.tauriInvoke.mockResolvedValue([{ name: 'mute_track', arguments: null }]);

        await expect(
            generateNativeToolCalls({
                systemPrompt: 'system',
                userMessage: 'mute drums',
                tools: [{ name: 'mute_track', description: 'Mute a track', parameters: { type: 'object' } }],
                temperature: 0.1,
            })
        ).rejects.toThrow(/Invalid native_tool_calling response/);
    });
});
