import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

import references from '../../../services/__tests__/fixtures/scalaParity.json';
import { parseScl } from '../parseScl';

vi.mock('#/utils/desktopBridge', () => ({
    desktopInvoke: vi.fn(),
    isDesktopRuntime: vi.fn(),
}));

describe('parseScl', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
    });

    it('should invoke parse_scl with standard A4 root defaults', async () => {
        const nativeResult = {
            name: 'Bright twelve',
            description: 'A test tuning',
            frequencies: [220, 440, 880],
        };
        vi.mocked(desktopInvoke).mockResolvedValue(nativeResult);

        await expect(parseScl('! scl content')).resolves.toEqual({ status: 'parsed', scale: nativeResult });

        expect(desktopInvoke).toHaveBeenCalledWith('parse_scl', {
            content: '! scl content',
            rootNote: 69,
            rootFreq: 440,
        });
    });

    it('decodes a typed domain error', async () => {
        const error = { kind: 'zero-denominator', line: 5, reason: 'Zero denominator in ratio' };
        vi.mocked(desktopInvoke).mockResolvedValue({ error });
        await expect(parseScl('malformed')).resolves.toEqual({ status: 'invalid', error });
    });

    it.each([
        { kind: 'unknown', line: 5, reason: 'Invalid tone' },
        { kind: 'invalid-count', line: 0, reason: 'Invalid tone count' },
        { kind: 'invalid-count', line: -1, reason: 'Invalid tone count' },
        { kind: 'invalid-count', line: 1.5, reason: 'Invalid tone count' },
        { kind: 'invalid-count', line: Number.MAX_SAFE_INTEGER + 1, reason: 'Invalid tone count' },
        { kind: 'invalid-count', line: '2', reason: 'Invalid tone count' },
        { kind: 'invalid-count', line: 2, reason: '' },
        { kind: 'invalid-count', line: 2, reason: ' invalid ' },
        { kind: 'invalid-count', line: 2, reason: 'x'.repeat(201) },
        { kind: 'invalid-count', line: 2, reason: 'Invalid\ncount' },
        { kind: 'invalid-count', line: 2 },
        null,
    ])('rejects a malformed error DTO: %j', async (error) => {
        vi.mocked(desktopInvoke).mockResolvedValue({ error });
        await expect(parseScl('malformed')).rejects.toThrow('invalid error payload');
    });

    it('preserves genuine transport rejection', async () => {
        const error = new Error('native host unavailable');
        vi.mocked(desktopInvoke).mockRejectedValue(error);
        await expect(parseScl('valid')).rejects.toBe(error);
    });

    it('rejects a malformed successful payload', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue({ name: 'bad', description: '', frequencies: [null] });
        await expect(parseScl('valid')).rejects.toThrow('invalid payload');
    });

    it('parses browser content without invoking the desktop bridge', async () => {
        const reference = references.parsed.find((entry) => entry.id === 'mixed')!;
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

        const result = await parseScl(reference.content);

        expect(desktopInvoke).not.toHaveBeenCalled();
        expect(result.status).toBe('parsed');
        if (result.status !== 'parsed') {
            throw new Error(result.error.reason);
        }
        expect(result.scale.name).toBe(reference.name);
        expect(result.scale.frequencies).toHaveLength(128);
        for (const [note, frequency] of result.scale.frequencies.entries()) {
            expect(Math.abs(frequency - reference.frequencies[note]!)).toBeLessThan(1e-9);
        }
    });

    it('does not retry valid browser content after a native host refusal', async () => {
        const failure = new Error('parse_scl rejected: the native host is not available');
        vi.mocked(desktopInvoke).mockRejectedValue(failure);

        await expect(parseScl('Valid\n1\n1/1\n')).rejects.toBe(failure);
        expect(desktopInvoke).toHaveBeenCalledExactlyOnceWith('parse_scl', {
            content: 'Valid\n1\n1/1\n',
            rootNote: 69,
            rootFreq: 440,
        });
    });

    it('does not retry valid browser content after native DTO decoding fails', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue({ name: 'bad', description: '', frequencies: [null] });

        await expect(parseScl('Valid\n1\n1/1\n')).rejects.toThrow('invalid payload');
        expect(desktopInvoke).toHaveBeenCalledOnce();
    });
});
