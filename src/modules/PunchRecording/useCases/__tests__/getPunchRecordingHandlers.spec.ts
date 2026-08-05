import { describe, it, expect } from 'vitest';

import { getWebMidiInputHandlers } from '#/modules/MIDI/useCases/getWebMidiInputHandlers';
import { getProjectHandlers } from '#/modules/Project/useCases/getProjectHandlers';

import { getPunchRecordingHandlers } from '../getPunchRecordingHandlers';

describe('getPunchRecordingHandlers', () => {
    it('returns a map with togglePunchRecording handler', () => {
        const handlers = getPunchRecordingHandlers();
        expect(handlers.togglePunchRecording).toBeDefined();
        expect(typeof handlers.togglePunchRecording.execute).toBe('function');
        expect(typeof handlers.togglePunchRecording.describe).toBe('function');
    });
});

describe('getProjectHandlers', () => {
    it('returns a map with createProjectFromTemplate handler', () => {
        const handlers = getProjectHandlers();
        expect(handlers.createProjectFromTemplate).toBeDefined();
        expect(typeof handlers.createProjectFromTemplate.execute).toBe('function');
    });
});

describe('getWebMidiInputHandlers', () => {
    it('returns a map with enableMpe and disableMpe handlers', () => {
        const handlers = getWebMidiInputHandlers();
        expect(handlers.enableMpe).toBeDefined();
        expect(handlers.disableMpe).toBeDefined();
        expect(typeof handlers.enableMpe.execute).toBe('function');
        expect(typeof handlers.disableMpe.execute).toBe('function');
    });
});
