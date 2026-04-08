import { inject } from '#/infra/di/inject';
import { type ActionHandler } from '#/modules/Command/useCases/commandQueries';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import {
    generateDrumFill,
    generateAllTransitionFills,
} from '#/modules/Arrangement/useCases/fillTransitionGeneration/generation';
import { compareToReference } from '#/modules/AudioAnalysis/useCases/referenceMixComparison/compareMixes';
import { toggleMono } from '#/modules/AudioEngine/useCases/controlRoom/toggleMono';
import { toggleDim } from '#/modules/AudioEngine/useCases/controlRoom/toggleDim';
import { switchMonitor } from '#/modules/AudioEngine/useCases/controlRoom/switchMonitor';
import { generateMentorLessons } from '#/modules/AiRuntime/useCases/musicMentor/generateLessons';

export const executeGenerateFill = inject({ generateDrumFill, notifyUser })(
    ({ generateDrumFill, notifyUser }) =>
        async function executeGenerateFill(a: {
            payload: { atBeat: number; durationBeats?: number; style?: string };
        }): Promise<void> {
            const fill = generateDrumFill(
                a.payload.atBeat,
                a.payload.durationBeats ?? 2,
                (a.payload.style ?? 'descending') as 'simple' | 'descending' | 'sixteenth' | 'syncopated'
            );
            notifyUser(`Generated ${fill.notes.length}-note drum fill`, 'success');
        }
);

export const executeGenerateAllTransitions = inject({ generateAllTransitionFills, notifyUser })(
    ({ generateAllTransitionFills, notifyUser }) =>
        async function executeGenerateAllTransitions(): Promise<void> {
            const fills = generateAllTransitionFills();
            notifyUser(
                fills.length > 0
                    ? `Generated ${fills.length} transition fills across arrangement`
                    : 'No section boundaries found — add sections first',
                fills.length > 0 ? 'success' : 'warning'
            );
        }
);

export const executeCompareToReference = inject({ compareToReference, notifyUser })(
    ({ compareToReference, notifyUser }) =>
        async function executeCompareToReference(): Promise<void> {
            const result = compareToReference();
            notifyUser(
                `Mix comparison: ${result.overallScore}% match — ${result.suggestions.length} suggestions`,
                result.overallScore >= 70 ? 'success' : 'warning'
            );
        }
);

export const executeToggleControlRoomMono = inject({ toggleMono })(
    ({ toggleMono }) =>
        async function executeToggleControlRoomMono(): Promise<void> {
            toggleMono();
        }
);

export const executeToggleControlRoomDim = inject({ toggleDim })(
    ({ toggleDim }) =>
        async function executeToggleControlRoomDim(): Promise<void> {
            toggleDim();
        }
);

export const executeSwitchMonitorNewFeature = inject({ switchMonitor })(
    ({ switchMonitor }) =>
        async function executeSwitchMonitorNewFeature(a: { payload: { monitorId: string } }): Promise<void> {
            switchMonitor(a.payload.monitorId);
        }
);

export const executeGetMentorTips = inject({ generateMentorLessons, notifyUser })(
    ({ generateMentorLessons, notifyUser }) =>
        async function executeGetMentorTips(): Promise<void> {
            const lessons = generateMentorLessons();
            if (lessons.length > 0) {
                const tip = lessons[0]!;
                notifyUser(`🎓 ${tip.title}: ${tip.observation} — ${tip.advice}`);
            } else {
                notifyUser('No mentor tips at this time — looking good!', 'success');
            }
        }
);

export const newFeatureHandlers: Record<string, ActionHandler<any>> = {
    generateFill: {
        execute: executeGenerateFill,
        undoable: true,
        describe: () => ({ label: 'Generate Fill' }),
    },
    generateAllTransitions: {
        execute: executeGenerateAllTransitions,
        undoable: true,
        describe: () => ({ label: 'Generate All Transitions' }),
    },
    compareToReference: {
        execute: executeCompareToReference,
        undoable: false,
        describe: () => ({ label: 'Compare to Reference Mix' }),
    },
    toggleControlRoomMono: {
        execute: executeToggleControlRoomMono,
        undoable: false,
        describe: () => ({ label: 'Toggle Mono Monitoring' }),
    },
    toggleControlRoomDim: {
        execute: executeToggleControlRoomDim,
        undoable: false,
        describe: () => ({ label: 'Toggle Dim Monitoring' }),
    },
    switchMonitor: {
        execute: executeSwitchMonitorNewFeature,
        undoable: false,
        describe: () => ({ label: 'Switch Monitor Output' }),
    },
    getMentorTips: {
        execute: executeGetMentorTips,
        undoable: false,
        describe: () => ({ label: 'Get Mentor Tips' }),
    },
};
