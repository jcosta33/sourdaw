import { describe, it, expect } from 'vitest';
import { PAYLOAD_VALIDATORS } from '../validateActionPayload';

describe('validateActionPayload / PAYLOAD_VALIDATORS', () => {
    describe('removeTrack', () => {
        it('should accept a payload with trackId string', () => {
            const guard = PAYLOAD_VALIDATORS.removeTrack;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            expect(guard({ trackId: 'track-1' })).toBe(true);
        });

        it('should reject invalid payloads', () => {
            const guard = PAYLOAD_VALIDATORS.removeTrack;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            expect(guard({})).toBe(false);
            expect(guard({ trackId: 1 })).toBe(false);
            expect(guard(null)).toBe(false);
        });
    });

    describe('setTempo', () => {
        it('should accept bpm in 20–300', () => {
            const guard = PAYLOAD_VALIDATORS.setTempo;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            expect(guard({ bpm: 20 })).toBe(true);
            expect(guard({ bpm: 300 })).toBe(true);
            expect(guard({ bpm: 120 })).toBe(true);
        });

        it('should reject bpm outside range', () => {
            const guard = PAYLOAD_VALIDATORS.setTempo;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            expect(guard({ bpm: 19 })).toBe(false);
            expect(guard({ bpm: 301 })).toBe(false);
            expect(guard({ bpm: Number.NaN })).toBe(false);
        });
    });

    describe('joinCollabSession', () => {
        it('should require inviteCode string', () => {
            const guard = PAYLOAD_VALIDATORS.joinCollabSession;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            expect(guard({ inviteCode: 'abc' })).toBe(true);
            expect(guard({})).toBe(false);
        });
    });

    describe('unchecked sentinels', () => {
        it('should mark openMixer as unchecked', () => {
            expect(PAYLOAD_VALIDATORS.openMixer).toBe('unchecked');
        });

        it('should mark saveProject as unchecked', () => {
            expect(PAYLOAD_VALIDATORS.saveProject).toBe('unchecked');
        });
    });

    describe('addTrack', () => {
        it('should require name and kind strings', () => {
            const guard = PAYLOAD_VALIDATORS.addTrack;
            expect(guard).not.toBe('unchecked');
            if (guard === 'unchecked') {
                return;
            }
            expect(guard({ name: 'A', kind: 'audio' })).toBe(true);
            expect(guard({ name: 'A' })).toBe(false);
            expect(guard({ kind: 'audio' })).toBe(false);
        });
    });
});
