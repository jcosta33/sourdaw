import { resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { resetCrdtProject } from '#/modules/CrdtDocument/useCases';
import { unloadPlugin as unloadLoadedExternalPlugins } from '#/modules/PluginHost/useCases';
import { countSettledTakes, isTransportIdle, stopPlayback } from '#/modules/Transport/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { saveProject } from '../saveProject/saveProject';

import { unsavedClosedTakes } from './unsavedClosedTakes';

type SettledProjectReset =
    | Exclude<Awaited<ReturnType<typeof resetCrdtProject>>, { status: 'transport-active' }>
    | { status: 'refused'; reason: 'superseded' };

/** The replacement branch of the reset contract, derived from its callable shape. */
export type ReplacedProject = Extract<SettledProjectReset, { status: 'replaced' }>;

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

const takeDiscardedNotice = 'Recording discarded — the take could not be saved to the project you are leaving.';

/**
 * Replace the project, stopping the transport whenever the reset finds it
 * rolling, and saving the outgoing project whenever a take closed into it that
 * it has not saved.
 *
 * Autosave is already stopped by the time a replacement stops the transport, so
 * a take committed into the outgoing project after its last save exists only in
 * memory, and the authority switch is about to replace the document holding it.
 * "Not saved" is measured against the settled-take count at that last save
 * (`unsavedClosedTakes`), not against when this replacement began, so a take
 * that landed after a route's pre-save, while it read the project it opens,
 * is kept too. The save is the one the Save command runs, so the take's audio is
 * made durable with it.
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
 * A failed save does not hold the switch, because the user asked to leave. The
 * user is told a take was discarded only once the reset answers `replaced` and
 * the last save of the outgoing project failed: until then the user is still in
 * that project with the take intact, and a refused reset or a superseded
 * replacement must not report a loss that did not happen. A later successful
 * save writes the whole document, so it also keeps a take an earlier save failed
 * to. A `discard` replacement never saves and never warns. At the switch every
 * settled take is acknowledged, because the incoming project owes nothing for
 * the outgoing one's.
 */
export async function resetCrdtProjectWithTransportStopped(
    name: string,
    onAuthorityReplaced: () => void,
    shouldContinue: () => boolean,
    outgoingProject: OutgoingProjectDisposition = 'save-closed-takes'
): Promise<SettledProjectReset> {
    // The settled-take count before this replacement's latest save: the takes up
    // to it are saved, or reported if that save failed, so they never hold the
    // switch again.
    let attemptedThrough = 0;
    // Whether the latest save of the outgoing project failed to keep a closed take.
    let takeUnsaved = false;
    const owesClosedTake = (): boolean => unsavedClosedTakes.hasUnsaved() && countSettledTakes() > attemptedThrough;
    const isQuietAtSwitch = (): boolean => isTransportIdle() && !owesClosedTake();
    const replaceAuthority = (): void => {
        unsavedClosedTakes.acknowledgeAll();
        onAuthorityReplaced();
    };
    async function settleClosedTakes(): Promise<void> {
        if (!owesClosedTake()) {
            return;
        }
        if (outgoingProject === 'discard') {
            unsavedClosedTakes.acknowledgeAll();
            return;
        }
        attemptedThrough = countSettledTakes();
        takeUnsaved = !(await saveProject());
    }

    await settleClosedTakes();
    if (!shouldContinue()) {
        return { status: 'refused', reason: 'superseded' };
    }
    let reset = await resetCrdtProject(name, replaceAuthority, isQuietAtSwitch);
    while (reset.status === 'transport-active') {
        await stopPlayback();
        if (!shouldContinue()) {
            return { status: 'refused', reason: 'superseded' };
        }
        await settleClosedTakes();
        resetAudioGraph();
        await unloadLoadedExternalPlugins();
        if (!shouldContinue()) {
            return { status: 'refused', reason: 'superseded' };
        }
        reset = await resetCrdtProject(name, replaceAuthority, isQuietAtSwitch);
    }
    if (reset.status === 'replaced' && takeUnsaved) {
        notifyUser(takeDiscardedNotice, 'warning');
    }
    return reset;
}
