import { describe, it, expect } from 'vitest';

import { camelToSnake } from '../helpers';

describe('camelToSnake', () => {
    it('should insert underscores before capitals', () => {
        expect(camelToSnake('attackTime')).toBe('attack_time');
    });

    it('should leave lowercase-only strings unchanged', () => {
        expect(camelToSnake('release')).toBe('release');
    });
});
