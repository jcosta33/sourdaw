import { type TempoSourceClock } from '#/utils/tempoAudioSourcePromotion';
import { type TempoMapEdit, type TempoMapRow } from '#/utils/tempoMapRowPlan';

/** The part of an automation lane a replayed lane creation resolves its folded target by. */
type MacroAutomationLane = {
    id: string;
    trackId: string;
    clipId?: string;
    parameterId: string;
};

/**
 * The live core state macro replay reads to keep a replayed step pointing at
 * what the recorded step meant: the tempo a captured audio slip was measured
 * against, the tempo rows a no-op tempo edit targets, and the automation lane
 * a folded lane creation landed on.
 */
type MacroCoreReads = {
    readTempoAtBeat: (input: { beat: number; clock?: TempoSourceClock }) => number;
    readTempoMapEditTargets: (edit: TempoMapEdit) => readonly TempoMapRow[] | null;
    readAutomationLanes: () => readonly MacroAutomationLane[] | undefined;
};

let registeredReads: MacroCoreReads | null = null;

/**
 * Command is the shared execution kernel and may not import Transport or
 * Automation, so the composition root (`#/app/registerKernelPorts`) fills this
 * once at boot, before any macro can replay.
 */
export const macroCoreReads = {
    /**
     * Registering the identical reads again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. Different
     * ones refuse.
     */
    configure(reads: MacroCoreReads): void {
        if (registeredReads === null) {
            registeredReads = reads;
            return;
        }
        if (
            registeredReads.readTempoAtBeat !== reads.readTempoAtBeat ||
            registeredReads.readTempoMapEditTargets !== reads.readTempoMapEditTargets ||
            registeredReads.readAutomationLanes !== reads.readAutomationLanes
        ) {
            throw new Error('macroCoreReads.configure: the reads differ from the registered ones');
        }
    },
    /**
     * The registered reads. Reading before registration throws rather than
     * answering no tempo or no lanes: a replayed slip would then land at the
     * wrong offset, and a replayed lane edit would target a lane id no lane
     * carries.
     */
    read(caller: string): MacroCoreReads {
        if (registeredReads === null) {
            throw new Error(
                `${caller}: the macro core reads are not registered; call registerKernelPorts() from #/app/registerKernelPorts (bootstrap does this)`
            );
        }
        return registeredReads;
    },
};
