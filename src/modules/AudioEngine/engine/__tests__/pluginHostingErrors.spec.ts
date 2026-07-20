import { describe, it, expect, vi, afterEach } from 'vitest';

import {
    PluginRequiresIsolationError,
    isPluginRequiresIsolationError,
    requireSharedArrayBuffer,
} from '../pluginHostingErrors';

describe('PluginRequiresIsolationError', () => {
    it('should build the generic COOP/COEP message when no detail is given', () => {
        const error = new PluginRequiresIsolationError('Bacteria');

        expect(error.name).toBe('PluginRequiresIsolationError');
        expect(error.pluginName).toBe('Bacteria');
        expect(error.message).toBe(
            'Bacteria requires cross-origin isolation (SharedArrayBuffer is not available). ' +
                'The server must send Cross-Origin-Opener-Policy: same-origin and ' +
                'Cross-Origin-Embedder-Policy: require-corp headers.'
        );
        expect(error).toBeInstanceOf(Error);
    });

    it('should fold a supplied detail into the message instead of the generic copy', () => {
        const error = new PluginRequiresIsolationError('Grinder', 'crossOriginIsolated is false');

        expect(error.message).toBe(
            'Grinder requires cross-origin isolation (SharedArrayBuffer): crossOriginIsolated is false'
        );
        expect(error.pluginName).toBe('Grinder');
    });
});

describe('isPluginRequiresIsolationError', () => {
    it('should recognize a PluginRequiresIsolationError instance', () => {
        expect(isPluginRequiresIsolationError(new PluginRequiresIsolationError('Scoring'))).toBe(true);
    });

    it('should reject a plain Error, a non-error value, and undefined', () => {
        expect(isPluginRequiresIsolationError(new Error('boom'))).toBe(false);
        expect(isPluginRequiresIsolationError('boom')).toBe(false);
        expect(isPluginRequiresIsolationError(undefined)).toBe(false);
    });
});

describe('requireSharedArrayBuffer', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should throw a PluginRequiresIsolationError carrying the plugin name when SharedArrayBuffer is undefined', () => {
        vi.stubGlobal('SharedArrayBuffer', undefined);

        try {
            requireSharedArrayBuffer('Toaster');
            expect.unreachable('expected requireSharedArrayBuffer to throw');
        } catch (error) {
            expect(isPluginRequiresIsolationError(error)).toBe(true);
            expect((error as PluginRequiresIsolationError).pluginName).toBe('Toaster');
        }
    });

    it('should not throw when SharedArrayBuffer is available', () => {
        vi.stubGlobal(
            'SharedArrayBuffer',
            class extends ArrayBuffer {
                constructor(length: number) {
                    super(length);
                }
            }
        );

        expect(() => requireSharedArrayBuffer('Toaster')).not.toThrow();
    });
});
