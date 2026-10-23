import { resetCrdtProject } from '#/modules/CrdtDocument/useCases';
import { isTransportIdle, stopPlayback } from '#/modules/Transport/useCases';

type SettledProjectReset =
    | Exclude<Awaited<ReturnType<typeof resetCrdtProject>>, { status: 'transport-active' }>
    | { status: 'refused'; reason: 'superseded' };

/** The replacement branch of the reset contract, derived from its callable shape. */
export type ReplacedProject = Extract<SettledProjectReset, { status: 'replaced' }>;

/**
 * Replace the project, stopping the transport whenever the reset finds it
 * rolling.
 *
 * The reset is handed `isTransportIdle` and checks it in the same synchronous
 * turn as the authority switch, after the durable steps it awaits, so only it
 * can say that nothing is rolling at the switch. A Play or Record pressed during those steps makes it
 * refuse before replacing anything; the stop here lands the take's commit, and
 * the next attempt checks again. Each lap needs a new gesture inside the
 * window, so the loop ends as soon as the user stops pressing Play.
 *
 * `shouldContinue` is asked after every stop, because a newer project load can
 * take over while the take commits and must not then be replaced by this one:
 * the answer is a refusal, which every caller already treats as an abort before
 * the switch. A stop that rejects ends the loop with the rejection, which the
 * caller's abort path treats like any failure before the switch.
 */
export async function resetCrdtProjectWithTransportStopped(
    name: string,
    onAuthorityReplaced: () => void,
    shouldContinue: () => boolean
): Promise<SettledProjectReset> {
    let reset = await resetCrdtProject(name, onAuthorityReplaced, isTransportIdle);
    while (reset.status === 'transport-active') {
        await stopPlayback();
        if (!shouldContinue()) {
            return { status: 'refused', reason: 'superseded' };
        }
        reset = await resetCrdtProject(name, onAuthorityReplaced, isTransportIdle);
    }
    return reset;
}
