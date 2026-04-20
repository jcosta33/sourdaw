import { describe, it, expect } from 'vitest';

import * as subject from '../getDrumKitDefByIndex';

describe('getDrumKitDefByIndex', () => {
    it('should export getDrumKitDefByIndex', () => {
        expect(subject.getDrumKitDefByIndex).toBeDefined();
        const t = typeof subject.getDrumKitDefByIndex;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
