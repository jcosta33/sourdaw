import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const desktopInvokeMock = vi.hoisted(() => vi.fn());
const desktopListenMock = vi.hoisted(() => vi.fn());

vi.mock('#/utils/desktopBridge', () => ({
    desktopInvoke: desktopInvokeMock,
    desktopListen: desktopListenMock,
    isDesktopRuntime: () => typeof window !== 'undefined' && 'sourdaw' in window,
}));

const originalSourdaw = Object.getOwnPropertyDescriptor(window, 'sourdaw');

function setDesktopMarker(present: boolean): void {
    if (present) {
        Object.defineProperty(window, 'sourdaw', { configurable: true, value: {} });
    } else {
        Reflect.deleteProperty(window, 'sourdaw');
    }
}

describe('Web MIDI capability snapshot at repository startup', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal('navigator', {});
        setDesktopMarker(false);
        desktopInvokeMock.mockResolvedValue([]);
        desktopListenMock.mockResolvedValue(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        if (originalSourdaw) {
            Object.defineProperty(window, 'sourdaw', originalSourdaw);
        } else {
            setDesktopMarker(false);
        }
    });

    it('uses the captured native route even when Web MIDI appears after startup', async () => {
        setDesktopMarker(true);
        const { getPlatformCapabilities } = await import('#/utils/platformCapabilities');
        expect(getPlatformCapabilities().webMidiApiPresent).toBe(false);

        const { webMidiState } = await import('../../state');
        expect(webMidiState.current.isSupported).toBe(true);

        const requestMIDIAccess = vi.fn().mockRejectedValue(new Error('late browser route'));
        vi.stubGlobal('navigator', { requestMIDIAccess });
        const { initWebMidi } = await import('../initWebMidi');

        expect(await initWebMidi({ onMidiMessage: vi.fn() })).toBe(true);
        expect(requestMIDIAccess).not.toHaveBeenCalled();
        expect(desktopInvokeMock).toHaveBeenCalledWith('list_midi_inputs');
    });

    it('projects missing browser support to the public MIDI store without opening a device', async () => {
        const { getPlatformCapabilities } = await import('#/utils/platformCapabilities');
        const capabilities = getPlatformCapabilities();
        expect(capabilities.hasMidiInput).toBe(false);
        expect(capabilities.degradations).toEqual([
            expect.objectContaining({ feature: 'midi-input', reason: 'api-absent' }),
        ]);

        const { initWebMidi } = await import('../initWebMidi');
        const { webMidiStore } = await import('../../../../stores/webMidiStore');
        expect(webMidiStore.value?.isSupported).toBe(false);
        expect(await initWebMidi({ onMidiMessage: vi.fn() })).toBe(false);
        expect(desktopInvokeMock).not.toHaveBeenCalled();
    });

    it('keeps browser permission refusal distinct from an absent Web MIDI API', async () => {
        const requestMIDIAccess = vi.fn().mockRejectedValue(new Error('Permission denied'));
        vi.stubGlobal('navigator', { requestMIDIAccess });
        const { getPlatformCapabilities } = await import('#/utils/platformCapabilities');
        expect(getPlatformCapabilities().webMidiApiPresent).toBe(true);
        expect(getPlatformCapabilities().degradations).toEqual([]);

        const { initWebMidi } = await import('../initWebMidi');
        const { webMidiStore } = await import('../../../../stores/webMidiStore');
        expect(webMidiStore.value?.isSupported).toBe(true);
        expect(await initWebMidi({ onMidiMessage: vi.fn() })).toBe(false);
        expect(requestMIDIAccess).toHaveBeenCalledOnce();
        expect(webMidiStore.value).toEqual(
            expect.objectContaining({ isSupported: false, enumerationError: 'Permission denied' })
        );
    });

    it('retains a native enumeration failure without claiming the desktop route is missing', async () => {
        setDesktopMarker(true);
        desktopInvokeMock.mockRejectedValue(new Error('Native list failed'));
        const { getPlatformCapabilities } = await import('#/utils/platformCapabilities');
        expect(getPlatformCapabilities().hasMidiInput).toBe(true);
        expect(getPlatformCapabilities().degradations).toEqual([]);

        const { initWebMidi } = await import('../initWebMidi');
        const { webMidiStore } = await import('../../../../stores/webMidiStore');
        expect(await initWebMidi({ onMidiMessage: vi.fn() })).toBe(false);
        expect(webMidiStore.value).toEqual(
            expect.objectContaining({ isSupported: true, enumerationError: 'Native list failed' })
        );
    });
});
