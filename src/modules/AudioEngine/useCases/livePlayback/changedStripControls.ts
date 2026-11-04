import { type AudioGraphCommand } from '../../models/AudioGraphBackend';

import { type LiveAutomationWriterPass } from './nativeLiveAutomationWriterState';

type Inputs = LiveAutomationWriterPass['inputs'];
type StripControl = NonNullable<Inputs['inheritedStripControls']>[number];

/** Reconcile accepted values and controls an unanswered batch may still apply. */
export function changedStripControls({
    before,
    after,
    inherited,
    positionSeconds,
}: Readonly<{
    before: Inputs['strips'];
    after: Inputs['strips'];
    inherited: readonly StripControl[];
    positionSeconds: number;
}>): Readonly<{
    controls: AudioGraphCommand[];
    faders: Set<string>;
    submitted: readonly StripControl[];
}> {
    const controls: AudioGraphCommand[] = [];
    const faders = new Set<string>();
    const submitted: StripControl[] = [];
    for (const [trackId, next] of after) {
        const old = before.get(trackId);
        if (!old) {
            continue;
        }
        const mayStillApply = (control: StripControl['control']) =>
            inherited.some((pending) => pending.trackId === trackId && pending.control === control);
        if (old.multiplier !== next.multiplier || mayStillApply('multiplier')) {
            controls.push({ kind: 'set-strip-vca-multiplier', trackId, multiplier: next.multiplier });
            submitted.push({ trackId, control: 'multiplier' });
            faders.add(trackId);
        }
        if (old.gain !== next.gain) {
            faders.add(trackId);
        }
        for (const kind of ['track-solo-gate', 'track-mute-gate'] as const) {
            const control = kind === 'track-solo-gate' ? 'soloGated' : 'muted';
            const wasClosed = old[control];
            const closed = next[control];
            if (wasClosed !== closed || mayStillApply(control)) {
                controls.push({
                    kind: 'write-parameter',
                    target: { kind, trackId },
                    write: { shape: 'step', time: positionSeconds, value: closed ? 0 : 1 },
                });
                submitted.push({ trackId, control });
            }
        }
    }
    return { controls, faders, submitted };
}
