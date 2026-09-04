/**
 * Control half of a hosted native plugin: the parameter and bypass IPC a Web
 * Audio device node still owes its instance once the audio itself no longer
 * crosses back into Web Audio.
 *
 * Bypass sends are totally ordered — one outstanding at a time, later ones
 * queued behind it — because `set_plugin_bypass` waits on the engine mutex and
 * two concurrent sends can reach the graph in either order, leaving the native
 * side holding the older value. The newest requested value is the one that
 * lands last.
 *
 * A refused send is uncompensated in both directions. The Web Audio device is a
 * pass-through, so nothing is unrouted when bypass engages and nothing is put
 * back when it releases: whichever way the toggle went, a refusal leaves the
 * native instance on the value it already held while the rack shows the one the
 * engineer asked for. It is warned about once, and the next toggle re-sends.
 *
 * There is no re-assertion loop, unlike the audio relay this was lifted from.
 * That loop rode on the per-block audio round trip, and a hosted plugin has no
 * per-block round trip left to piggyback on; a standalone retry timer would be
 * a new mechanism rather than a preserved one.
 */

import { logger } from '#/infra/logger/appLogger';
import { setPluginBypass, setPluginParameter } from '#/modules/PluginHost/useCases';

export type HostedPluginControls = {
    setParam: (paramId: number, value: number) => void;
    setBypass: (bypassed: boolean) => void;
    destroy: () => void;
};

export function createHostedPluginControls(instanceId: string): HostedPluginControls {
    let bypassSeq = 0;
    let bypassInFlight = false;
    let lastBypassSend: Promise<void> = Promise.resolve();

    function dispatchBypass(bypassed: boolean, seq: number): Promise<void> {
        return setPluginBypass({ instanceId, bypassed })
            .catch((error: unknown) => {
                logger.warn(
                    `[WebAudioEngine] Native plugin bypass (${String(bypassed)}) was refused: ${String(error)}`
                );
            })
            .then(() => {
                // Only the last link of the chain reopens the gate; a settled
                // send with a successor behind it hands the flight straight on.
                if (seq === bypassSeq) {
                    bypassInFlight = false;
                }
            });
    }

    function sendBypass(bypassed: boolean): void {
        const seq = ++bypassSeq;
        if (bypassInFlight) {
            lastBypassSend = lastBypassSend.then(() => dispatchBypass(bypassed, seq));
            return;
        }
        bypassInFlight = true;
        lastBypassSend = dispatchBypass(bypassed, seq);
    }

    return {
        setParam(paramId: number, value: number) {
            void setPluginParameter({ instanceId, paramId, value }).catch((error: unknown) => {
                logger.warn(`[WebAudioEngine] Native plugin parameter ${paramId} was refused: ${String(error)}`);
            });
        },
        setBypass(bypassed: boolean) {
            sendBypass(bypassed);
        },
        destroy() {},
    };
}
