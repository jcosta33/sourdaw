import { describe, expect, it } from 'vitest';

import { resolveConsoleWriterMode } from '../resolveConsoleWriterMode';

describe('resolveConsoleWriterMode', () => {
    it('should select development mode when DEV is true', () => {
        expect(resolveConsoleWriterMode({ DEV: true, MODE: 'development' })).toBe('development');
    });

    it('should select development mode for an e2e-mode build that is not DEV', () => {
        expect(resolveConsoleWriterMode({ DEV: false, MODE: 'e2e' })).toBe('development');
    });

    it('should select production mode for a production build', () => {
        expect(resolveConsoleWriterMode({ DEV: false, MODE: 'production' })).toBe('production');
    });
});
