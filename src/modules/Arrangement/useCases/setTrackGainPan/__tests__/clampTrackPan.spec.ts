import { describe, expect, it } from 'vitest';

import { clampTrackPan } from '../clampTrackPan';

describe('clampTrackPan', () => {
    it.each([
        { request: -80, written: -50 },
        { request: 80, written: 50 },
        { request: 12, written: 12 },
        { request: -50, written: -50 },
    ])('turns a request of $request into $written', ({ request, written }) => {
        expect(clampTrackPan(request)).toBe(written);
    });
});
