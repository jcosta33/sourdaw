import { describe, it, expect, vi } from 'vitest';
import { mcpToCompactPromptText } from '../mcpToCompactPromptText';

vi.mock('../helpers', () => ({
    getMcpTools: vi.fn(() => [
        {
            name: 'addTrack',
            description: 'Creates a new track',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    kind: { type: 'string', enum: ['audio', 'midi'] }
                },
                required: ['name']
            }
        },
        {
            name: 'play',
            description: 'Starts playback',
            inputSchema: {
                type: 'object',
                properties: {}
            }
        }
    ])
}));

describe('mcpToCompactPromptText', () => {
    it('formats tools into a compact text string', () => {
        const text = mcpToCompactPromptText();
        
        expect(text).toContain('addTrack(name:string, kind:audio|midi) - Creates a new track');
        expect(text).toContain('play() - Starts playback');
        
        // Assert exactly matching
        expect(text).toBe(
            'addTrack(name:string, kind:audio|midi) - Creates a new track\nplay() - Starts playback'
        );
    });
});
