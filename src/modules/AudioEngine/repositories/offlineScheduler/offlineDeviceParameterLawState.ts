/**
 * The device-parameter contract the *live* apply path enforces, injected at the
 * composition root.
 *
 * `applyAutomation` gates every device write on Arrangement's
 * `DeviceParameterLaw` — the descriptor's `automatable` flag, and its declared
 * range applied to the value that lands. The offline render has to enforce the
 * identical law or a bounce diverges from the monitor: a lane the monitor
 * refuses to run would still render, and a lane that overshoots its declared
 * range would render past the value the monitor clamps it to.
 *
 * It cannot import that law. Arrangement drives the audio engine, so an
 * AudioEngine → `Arrangement/useCases` import inverts the dependency and closes
 * a module cycle (`no-circular` is an error, and the cycle really does break
 * module-load order — it reds a few dozen Arrangement specs). The composition
 * root hands the same functions down instead, exactly as it already does for
 * `evaluateAutomationValue`.
 */

export type OfflineDeviceParameterAutomatablePredicate = (input: { deviceType: string; paramId: string }) => boolean;

export type OfflineDeviceParameterClamp = (input: { deviceType: string; paramId: string; value: number }) => number;

/**
 * Unset means no law was injected, not "anything goes". The render then has no
 * basis to decide whether a parameter may be automated at all, so the caller
 * refuses device automation rather than substituting a looser rule than live's
 * — the same reasoning that makes a grain which could not have driven a live
 * tick mean "do not slew". Every real app run configures this at bootstrap.
 */
export const offlineDeviceParameterLawState: {
    isAutomatable: OfflineDeviceParameterAutomatablePredicate | null;
    clampValue: OfflineDeviceParameterClamp | null;
} = {
    isAutomatable: null,
    clampValue: null,
};
