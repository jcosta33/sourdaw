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
 * What a replacement owes the project it leaves.
 *
 * `save-closed-takes` is the default: opening something else must not lose a
 * take that closed meanwhile. `discard` is for a replacement that exists to
 * throw the outgoing project's unsaved state away (Don't Save): saving there
 * would persist every edit the user chose to drop, so a closed take is
 * acknowledged unsaved and the user is not told it was lost.
 */
export type OutgoingProjectDisposition = 'save-closed-takes' | 'discard';

type TakeSettlement = 'nothing-closed' | 'saved' | 'unsaved' | 'discarded';

const takeDiscardedNotice = 'Recording discarded — the take could not be saved to the project you are leaving.';

/**
 * Settle every take that has closed into the outgoing project since the last
 * time it was settled.
 *
 * Autosave is already stopped by the time a replacement stops the transport, so
 * a take that stop commits exists only in memory, and the authority switch is
 * about to replace the document holding it. Opening another project saves the
 * current take or says it is discarded; it never loses it silently. The save is
 * the one the Save command runs, so the take's audio is made durable with it.
 * A discarding replacement acknowledges the take without saving, so the switch
 * check that refuses while a take is unaccounted for lets it through.
 */
async function settleClosedTakes(
    closedTakes: ClosedTakes,
    outgoingProject: OutgoingProjectDisposition
): Promise<TakeSettlement> {
    if (!closedTakes.hasClosedTake()) {
        return 'nothing-closed';
    }
    // Acknowledged before the save: a take that closes while it runs counts again.
    closedTakes.acknowledge();
    if (outgoingProject === 'discard') {
        return 'discarded';
    }
    return (await saveProject()) ? 'saved' : 'unsaved';
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
 * `shouldContinue` is asked after every save and stop and again after every
 * teardown, because a newer project load can take over while the take commits
 * or the plugins unload and must not then be replaced by this one: the answer is
 * a refusal, which every caller already treats as an abort before the switch. A
 * stop or teardown that rejects ends the loop with the rejection, which the
 * caller's abort path treats like any failure before the switch.
 *
 * The user is told a take was discarded only once the reset answers `replaced`
 * and the last save of the outgoing project failed: until then the user is
 * still in that project with the take intact, and a refused reset or a
 * superseded replacement must not report a loss that did not happen. A later
 * successful save writes the whole document, so it also keeps a take an earlier
 * save failed to. A `discard` replacement never saves and never warns.
 *
 * `closedTakes` is created by the caller before its first stop, so a take that
 * stop commits is kept too. The guarantee that no take is lost silently starts
 * where the watch does: a caller that awaits first (a project read) creates the
 * watch before that await, and a route with a pre-save waits for the takes
 * closing then (`saveProjectBeforeReplacement`).
 */
export async function resetCrdtProjectWithTransportStopped(
    name: string,
    onAuthorityReplaced: () => void,
    shouldContinue: () => boolean,
    closedTakes: ClosedTakes,
    outgoingProject: OutgoingProjectDisposition = 'save-closed-takes'
): Promise<SettledProjectReset> {
    const isQuietAtSwitch = (): boolean => isTransportIdle() && !closedTakes.hasClosedTake();
    // Whether the latest save of the outgoing project failed to keep a closed take.
    let takeUnsaved = false;
    async function settle(): Promise<void> {
        const settlement = await settleClosedTakes(closedTakes, outgoingProject);
        if (settlement === 'saved') {
            takeUnsaved = false;
        } else if (settlement === 'unsaved') {
            takeUnsaved = true;
        }
    }

    await settle();
    if (!shouldContinue()) {
        return { status: 'refused', reason: 'superseded' };
    }
    let reset = await resetCrdtProject(name, onAuthorityReplaced, isQuietAtSwitch);
    while (reset.status === 'transport-active') {
        await stopPlayback();
        if (!shouldContinue()) {
            return { status: 'refused', reason: 'superseded' };
        }
        await settle();
        resetAudioGraph();
        await unloadLoadedExternalPlugins();
        if (!shouldContinue()) {
            return { status: 'refused', reason: 'superseded' };
        }
        reset = await resetCrdtProject(name, onAuthorityReplaced, isQuietAtSwitch);
    }
    if (reset.status === 'replaced' && takeUnsaved) {
        notifyUser(takeDiscardedNotice, 'warning');
    }
    return reset;
}
