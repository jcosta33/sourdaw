import { type AppAction } from '#/utils/handlerContract';

type SendLevelAction = Extract<AppAction, { type: 'setSend' | 'addSend' }>;

type SendState = { level: number; preFader: boolean };

/**
 * The action one send-level gesture commits. A send that exists is moved with
 * the level and tap point it holds before this commit as its guards, so undo
 * restores exactly what the gesture replaced; a track with no send there yet
 * gets one, post-fader.
 */
export function compileSendLevelAction(
    trackId: string,
    busId: string,
    level: number,
    currentSend: SendState | undefined
): SendLevelAction {
    if (!currentSend) {
        return { type: 'addSend', payload: { trackId, busId, level } };
    }
    return {
        type: 'setSend',
        payload: {
            trackId,
            busId,
            level,
            expectedLevel: currentSend.level,
            expectedPreFader: currentSend.preFader,
        },
    };
}
