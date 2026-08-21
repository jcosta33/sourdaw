import {
    VOICE_DICTATION_ARM_CHANNEL,
    VOICE_DICTATION_CANCEL_CHANNEL,
    VOICE_DICTATION_DISARM_CHANNEL,
    VOICE_DICTATION_START_CHANNEL,
    VOICE_DICTATION_STOP_CHANNEL,
} from './channels.js';
import { withTrustedSender, type IpcMainLike } from './router.js';

type VoiceDictationHost = {
    readonly startDictation: (sessionId: string) => Promise<string>;
    readonly stopDictation: (sessionId: string) => void;
    readonly cancelDictation: (sessionId: string) => void;
};

type RegisterVoiceDictationInput = {
    readonly ipcMain: IpcMainLike;
    readonly native: () => VoiceDictationHost | undefined;
    readonly isTrustedFrameUrl: (url: string | undefined) => boolean;
};

const validSessionId = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= 128;

/** Dedicated preload-only microphone controls; raw start/stop are never routed generically. */
export const registerVoiceDictation = ({ ipcMain, native, isTrustedFrameUrl }: RegisterVoiceDictationInput): void => {
    const activations = new Map<string, number>();
    const consumeActivation = (value: unknown): boolean => {
        if (typeof value !== 'string') {
            return false;
        }
        const createdAt = activations.get(value);
        activations.delete(value);
        return createdAt !== undefined && Date.now() - createdAt <= 1_000;
    };
    ipcMain.handle(
        VOICE_DICTATION_ARM_CHANNEL,
        withTrustedSender('voice-dictation.arm', isTrustedFrameUrl, (activation) => {
            if (typeof activation !== 'string' || activation.length < 16) {
                throw new Error('voice-dictation.arm rejected: invalid activation');
            }
            activations.set(activation, Date.now());
        })
    );
    ipcMain.handle(
        VOICE_DICTATION_DISARM_CHANNEL,
        withTrustedSender('voice-dictation.disarm', isTrustedFrameUrl, () => {
            activations.clear();
        })
    );
    ipcMain.handle(
        VOICE_DICTATION_START_CHANNEL,
        withTrustedSender('voice-dictation.start', isTrustedFrameUrl, async (sessionId, activation) => {
            if (!validSessionId(sessionId) || !consumeActivation(activation)) {
                throw new Error('voice-dictation.start rejected: invalid activation request');
            }
            const host = native();
            if (host === undefined) {
                throw new Error('voice-dictation.start rejected: the native host is not available');
            }
            return host.startDictation(sessionId);
        })
    );
    ipcMain.handle(
        VOICE_DICTATION_STOP_CHANNEL,
        withTrustedSender('voice-dictation.stop', isTrustedFrameUrl, (sessionId) => {
            if (!validSessionId(sessionId)) {
                throw new Error('voice-dictation.stop rejected: invalid session');
            }
            activations.clear();
            const host = native();
            if (host === undefined) {
                throw new Error('voice-dictation.stop rejected: the native host is not available');
            }
            host.stopDictation(sessionId);
        })
    );
    ipcMain.handle(
        VOICE_DICTATION_CANCEL_CHANNEL,
        withTrustedSender('voice-dictation.cancel', isTrustedFrameUrl, (sessionId) => {
            if (!validSessionId(sessionId)) {
                throw new Error('voice-dictation.cancel rejected: invalid session');
            }
            activations.clear();
            const host = native();
            if (host === undefined) {
                throw new Error('voice-dictation.cancel rejected: the native host is not available');
            }
            host.cancelDictation(sessionId);
        })
    );
};
