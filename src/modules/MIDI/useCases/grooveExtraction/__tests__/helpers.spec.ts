import { describe, it, expect } from 'vitest';
import * as subject from '../helpers';

describe('helpers', () => {
    it('should load the module', () => {
        expect(subject).toBeDefined();
    });
});
