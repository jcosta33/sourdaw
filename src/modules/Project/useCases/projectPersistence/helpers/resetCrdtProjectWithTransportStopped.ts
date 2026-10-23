import { resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { resetCrdtProject } from '#/modules/CrdtDocument/useCases';
import { unloadPlugin as unloadLoadedExternalPlugins } from '#/modules/PluginHost/useCases';
import { isTransportIdle, stopPlayback, type watchClosedTakes } from '#/modules/Transport/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { saveProject } from '../saveProject/saveProject';

type SettledProjectReset =
    | Exclude<Awaited<ReturnType<typeof resetCrdtProject>>, { status: 'transport-active' }>
    | { status: 'refused'; reason: 'superseded' };

/** The replacement branch of the reset contract, derived from its callable shape. */
export type ReplacedProject = Extract<SettledProjectReset, { status: 'replaced' }>;

type ClosedTakes = ReturnType<typeof watchClosedTakes>;

/**
 * Save the outgoing project when a take has closed into it since the last time
 * it was saved or declared lost.
 *
 * Autosave is already stopped by the time a replacement stops the transport, so
 * a take that stop commits exists only in memory, and the authority switch is
 * about to replace the document holding it. Opening another project saves the
 * current take or says it is discarded; it never loses it silently. The save is
 * the one the Save command runs, so the take's audio is made durable with it.
 */
async function keepClosedTakes(closedTakes: ClosedTakes): Promise<void> {
    if (!closedTakes.hasClosedTake()) {
        return;
    }
    // Acknowledged before the save: a take that closes while it runs counts again.
    closedTakes.acknowledge();
    if (await saveProject()) {
        return;
    }
    notifyUser('Recording discarded — the take could not be saved to the project you are leaving.', 'warning');
}

/**
 * Replace the project, stopping the transport whenever the reset finds it
 * rolling, and saving the outgoing project whenever a take closed into it.
 *
 * The reset is handed a check that it runs in the same synchronous turn as the
 * authority switch, after the durable steps it awaits, so only it can say that
 * nothing is rolling at the switch. The check holds the project's authority
 * while a Play or Record has started, while a take is still closing (a user's
 * Pause or Stop turns the transport idle before its commit lands), and while a
 * take has closed that has not been saved. Each makes the reset refuse before
 * replacing anything. The stop here waits for every closing take, the save
 * keeps the ones that closed, and the next attempt checks again. Each lap needs
 * a new gesture inside the window, so the loop ends as soon as the user stops
 * pressing Play.
 *
 * A Play or Record in that window also rebuilds the outgoing project's track
 * strips and wakes its dormant external plugins, which the caller's teardown had
 * already released, so each lap tears the audio graph and the plugins down again
 * before it asks.
 *
 * `shouldContinue` is asked after every stop, because a newer project load can
 * take over while the take commits and must not then be replaced by this one:
 * the answer is a refusal, which every caller already treats as an abort before
 * the switch. A stop that rejects ends the loop with the rejection, which the
 * caller's abort path treats like any failure before the switch.
 *
 * `closedTakes` is created by the caller before its first stop, so a take that
 * stop commits is kept too.
 */
export async function resetCrdtProjectWithTransportStopped(
    name: string,
    onAuthorityReplaced: () => void,
    shouldContinue: () => boolean,
    closedTakes: ClosedTakes
): Promise<SettledProjectReset> {
    const isQuietAtSwitch = (): boolean => isTransportIdle() && !closedTakes.hasClosedTake();
    await keepClosedTakes(closedTakes);
    let reset = await resetCrdtProject(name, onAuthorityReplaced, isQuietAtSwitch);
    while (reset.status === 'transport-active') {
        await stopPlayback();
        if (!shouldContinue()) {
            return { status: 'refused', reason: 'superseded' };
        }
        await keepClosedTakes(closedTakes);
        resetAudioGraph();
        await unloadLoadedExternalPlugins();
        if (!shouldContinue()) {
            return { status: 'refused', reason: 'superseded' };
        }
        reset = await resetCrdtProject(name, onAuthorityReplaced, isQuietAtSwitch);
    }
    return reset;
}
