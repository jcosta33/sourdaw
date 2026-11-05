import { type AppAction } from '#/utils/handlerContract';

type SetSendAction = Extract<AppAction, { type: 'setSend' }>;

/** The action a PRE/POST click commits: the same send, at its level, on the other tap point. */
export function compileSendPreFaderAction(
    trackId: string,
    busId: string,
    send: { level: number; preFader: boolean }
): SetSendAction {
    return {
        type: 'setSend',
        payload: {
            trackId,
            busId,
            level: send.level,
            preFader: !send.preFader,
            expectedLevel: send.level,
            expectedPreFader: send.preFader,
        },
    };
}
