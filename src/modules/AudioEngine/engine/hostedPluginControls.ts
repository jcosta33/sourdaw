/**
 * Control half of a hosted native plugin: the parameter and bypass IPC a Web
 * Audio device node still owes its instance once the audio itself no longer
 * crosses back into Web Audio.
 *
 * Bypass is the one control here the Web Audio chain cannot cover for. Engaging
 * it is safe to lose — the chain rebuild unroutes the device anyway. Releasing
 * it is not: the rebuild puts the device back in the path unconditionally, so a
 * refused `set_plugin_bypass` would leave the native effect bypassed underneath
 * a device the rack shows as enabled.
 *
 * Sends are therefore totally ordered — one outstanding at a time, later ones
 * queued behind it — because `set_plugin_bypass` waits on the engine mutex and
 * two concurrent sends can reach the graph in either order, leaving the native
 * side holding the older value. The newest requested value is the one that
 * lands last.
 *
 * There is no re-assertion loop, unlike the audio relay this was lifted from.
 * That loop rode on the per-block audio round trip, and a hosted plugin has no
 * per-block round trip left to piggyback on; a standalone retry timer would be
 * a new mechanism rather than a preserved one. A refused bypass is warned about
 * once and the next toggle re-sends.
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
