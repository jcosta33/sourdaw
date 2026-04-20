import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getSelectedInputId } from '../../../useCases/audioDeviceSelection/getSelectedInputId';
import { audioEngine } from '../../createWebAudioEngine';
import { startInputMonitoring, stopInputMonitoring } from '../inputMonitoring';

vi.mock('../../createWebAudioEngine', () => ({
    audioEngine: {
        context: {
            createMediaStreamSource: vi.fn(),
        },
        ensureTrackStrip: vi.fn(),
    },
}));

vi.mock('../../../useCases/audioDeviceSelection/getSelectedInputId', () => ({
    getSelectedInputId: vi.fn(),
}));

describe('inputMonitoring', () => {
    let originalGetUserMedia: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Mock navigator.mediaDevices.getUserMedia
        originalGetUserMedia = navigator.mediaDevices?.getUserMedia;

        if (!global.navigator) {
            (global as any).navigator = {};
        }
        if (!global.navigator.mediaDevices) {
            (global as any).navigator.mediaDevices = {};
        }

        global.navigator.mediaDevices.getUserMedia = vi.fn();

        // Make sure state is clear (module variables)
        stopInputMonitoring();
        vi.clearAllMocks();
    });

    afterEach(() => {
        if (originalGetUserMedia) {
            global.navigator.mediaDevices.getUserMedia = originalGetUserMedia;
        }
    });

    it('should start input monitoring', async () => {
        const mockStream = { getTracks: vi.fn(() => []) };
        const mockSourceNode = { connect: vi.fn(), disconnect: vi.fn() };
        const mockStrip = { gainNode: {} };

        vi.mocked(global.navigator.mediaDevices.getUserMedia).mockResolvedValue(mockStream as any);
        vi.mocked(audioEngine.context.createMediaStreamSource).mockReturnValue(mockSourceNode as any);
        vi.mocked(audioEngine.ensureTrackStrip).mockReturnValue(mockStrip as any);
        vi.mocked(getSelectedInputId).mockReturnValue(null);

        const result = await startInputMonitoring('t1');

        expect(result).toBe(true);
        expect(global.navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        expect(audioEngine.context.createMediaStreamSource).toHaveBeenCalledWith(mockStream);
        expect(audioEngine.ensureTrackStrip).toHaveBeenCalledWith('t1');
        expect(mockSourceNode.connect).toHaveBeenCalledWith(mockStrip.gainNode);
    });

    it('should use selected device id if available', async () => {
        const mockStream = { getTracks: vi.fn(() => []) };
        const mockSourceNode = { connect: vi.fn(), disconnect: vi.fn() };
        const mockStrip = { gainNode: {} };

        vi.mocked(global.navigator.mediaDevices.getUserMedia).mockResolvedValue(mockStream as any);
        vi.mocked(audioEngine.context.createMediaStreamSource).mockReturnValue(mockSourceNode as any);
        vi.mocked(audioEngine.ensureTrackStrip).mockReturnValue(mockStrip as any);
        vi.mocked(getSelectedInputId).mockReturnValue('dev-123');

        await startInputMonitoring('t1');

        expect(global.navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                deviceId: { exact: 'dev-123' },
            },
        });
    });

    it('should return false on getUserMedia failure', async () => {
        vi.mocked(global.navigator.mediaDevices.getUserMedia).mockRejectedValue(new Error('denied'));
        const result = await startInputMonitoring('t1');
        expect(result).toBe(false);
    });

    it('should stop monitoring and disconnect nodes', async () => {
        const mockTrack = { stop: vi.fn() };
        const mockStream = { getTracks: vi.fn(() => [mockTrack]) };
        const mockSourceNode = { connect: vi.fn(), disconnect: vi.fn() };
        const mockStrip = { gainNode: {} };

        vi.mocked(global.navigator.mediaDevices.getUserMedia).mockResolvedValue(mockStream as any);
        vi.mocked(audioEngine.context.createMediaStreamSource).mockReturnValue(mockSourceNode as any);
        vi.mocked(audioEngine.ensureTrackStrip).mockReturnValue(mockStrip as any);

        // Start first to set up the module state
        await startInputMonitoring('t1');

        // Now stop
        stopInputMonitoring();

        expect(mockSourceNode.disconnect).toHaveBeenCalled();
        expect(mockTrack.stop).toHaveBeenCalled();
    });
});
