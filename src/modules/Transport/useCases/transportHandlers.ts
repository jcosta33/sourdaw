import { inject } from '#/infra/di/inject';
import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';
import { setTempo } from '#/modules/Transport/useCases/setTempo';
import { togglePlayback } from '#/modules/Transport/useCases/transportControls/togglePlayback';
import { stopPlayback } from '#/modules/Transport/useCases/transportControls/stopPlayback';
import { toggleLoop } from '#/modules/Transport/useCases/transportControls/toggleLoop';
import { toggleMetronome } from '#/modules/Transport/useCases/transportControls/toggleMetronome';
import { setMetronomeVolume } from '#/modules/Transport/useCases/transportControls/setMetronomeVolume';
import { toggleRecording } from '#/modules/Transport/useCases/transportControls/toggleRecording';
import { setLoopRegion } from '#/modules/Transport/useCases/transportControls/setLoopRegion';
import { seekPlayhead } from '#/modules/Transport/useCases/transportControls/seekPlayhead';
import { setPunchIn } from '#/modules/Transport/useCases/transportControls/setPunchIn';
import { setPunchOut } from '#/modules/Transport/useCases/transportControls/setPunchOut';
import { togglePunchEnabled } from '#/modules/Transport/useCases/transportControls/togglePunchEnabled';
import { toggleCountIn } from '#/modules/Transport/useCases/transportControls/toggleCountIn';
import { setCountInBars } from '#/modules/Transport/useCases/transportControls/setCountInBars';
import { togglePreRoll } from '#/modules/Transport/useCases/transportControls/togglePreRoll';
import { setPreRollBars } from '#/modules/Transport/useCases/transportControls/setPreRollBars';
import { addTimeSignatureChange, removeTimeSignatureChange } from '#/modules/Transport/useCases/timeSignatureChanges';
import { setMasterGain } from '#/modules/AudioEngine/useCases/setMasterGain';

type ExtractAction<A extends AppAction, T extends string> = A extends { type: T } ? A : never;
type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const executeSetTempo = inject({ setTempo })(
    ({ setTempo }) =>
        function executeSetTempo(a: ExtractAction<AppAction, 'setTempo'>): void {
            setTempo(a.payload.bpm);
        }
);

export const executeTogglePlayback = inject({ togglePlayback })(
    ({ togglePlayback }) =>
        function executeTogglePlayback(): void {
            togglePlayback();
        }
);

export const executeStopPlayback = inject({ stopPlayback })(
    ({ stopPlayback }) =>
        function executeStopPlayback(): void {
            stopPlayback();
        }
);

export const executeToggleRecording = inject({ toggleRecording })(
    ({ toggleRecording }) =>
        function executeToggleRecording(): void {
            toggleRecording();
        }
);

export const executeToggleLoop = inject({ toggleLoop })(
    ({ toggleLoop }) =>
        function executeToggleLoop(): void {
            toggleLoop();
        }
);

export const executeToggleMetronome = inject({ toggleMetronome })(
    ({ toggleMetronome }) =>
        function executeToggleMetronome(): void {
            toggleMetronome();
        }
);

export const executeSetMetronomeVolume = inject({ setMetronomeVolume })(
    ({ setMetronomeVolume }) =>
        function executeSetMetronomeVolume(a: ExtractAction<AppAction, 'setMetronomeVolume'>): void {
            setMetronomeVolume(a.payload.volume);
        }
);

export const executeSetMasterGain = inject({ setMasterGain })(
    ({ setMasterGain }) =>
        function executeSetMasterGain(a: ExtractAction<AppAction, 'setMasterGain'>): void {
            setMasterGain(a.payload.gain);
        }
);

export const executeSetLoopRegion = inject({ setLoopRegion })(
    ({ setLoopRegion }) =>
        function executeSetLoopRegion(a: ExtractAction<AppAction, 'setLoopRegion'>): void {
            setLoopRegion(a.payload.startBeat, a.payload.endBeat);
        }
);

export const executeSeekPlayhead = inject({ seekPlayhead })(
    ({ seekPlayhead }) =>
        function executeSeekPlayhead(a: ExtractAction<AppAction, 'seekPlayhead'>): void {
            seekPlayhead(a.payload.beat);
        }
);

export const executeSetPunchIn = inject({ setPunchIn })(
    ({ setPunchIn }) =>
        function executeSetPunchIn(a: ExtractAction<AppAction, 'setPunchIn'>): void {
            setPunchIn(a.payload.beat);
        }
);

export const executeSetPunchOut = inject({ setPunchOut })(
    ({ setPunchOut }) =>
        function executeSetPunchOut(a: ExtractAction<AppAction, 'setPunchOut'>): void {
            setPunchOut(a.payload.beat);
        }
);

export const executeTogglePunch = inject({ togglePunchEnabled })(
    ({ togglePunchEnabled }) =>
        function executeTogglePunch(): void {
            togglePunchEnabled();
        }
);

export const executeToggleCountIn = inject({ toggleCountIn })(
    ({ toggleCountIn }) =>
        function executeToggleCountIn(): void {
            toggleCountIn();
        }
);

export const executeSetCountInBars = inject({ setCountInBars })(
    ({ setCountInBars }) =>
        function executeSetCountInBars(a: ExtractAction<AppAction, 'setCountInBars'>): void {
            setCountInBars(a.payload.bars);
        }
);

export const executeAddTimeSignatureChange = inject({ addTimeSignatureChange })(
    ({ addTimeSignatureChange }) =>
        function executeAddTimeSignatureChange(a: ExtractAction<AppAction, 'addTimeSignatureChange'>): void {
            addTimeSignatureChange(a.payload.beat, a.payload.numerator, a.payload.denominator);
        }
);

export const executeRemoveTimeSignatureChange = inject({ removeTimeSignatureChange })(
    ({ removeTimeSignatureChange }) =>
        function executeRemoveTimeSignatureChange(a: ExtractAction<AppAction, 'removeTimeSignatureChange'>): void {
            removeTimeSignatureChange(a.payload.beat);
        }
);

export const executeTogglePreRoll = inject({ togglePreRoll })(
    ({ togglePreRoll }) =>
        function executeTogglePreRoll(): void {
            togglePreRoll();
        }
);

export const executeSetPreRollBars = inject({ setPreRollBars })(
    ({ setPreRollBars }) =>
        function executeSetPreRollBars(a: ExtractAction<AppAction, 'setPreRollBars'>): void {
            setPreRollBars(a.payload.bars);
        }
);

export const transportHandlers = {
    setTempo: {
        execute: executeSetTempo,
        describe: (a) => ({ label: `Set tempo to ${a.payload.bpm} BPM` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setTempo'>>,

    togglePlayback: {
        execute: executeTogglePlayback,
        describe: () => ({ label: 'Toggle playback' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'togglePlayback'>>,

    stopPlayback: {
        execute: executeStopPlayback,
        describe: () => ({ label: 'Stop playback' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'stopPlayback'>>,

    toggleRecording: {
        execute: executeToggleRecording,
        describe: () => ({ label: 'Toggle recording' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'toggleRecording'>>,

    toggleLoop: {
        execute: executeToggleLoop,
        describe: () => ({ label: 'Toggle loop' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'toggleLoop'>>,

    toggleMetronome: {
        execute: executeToggleMetronome,
        describe: () => ({ label: 'Toggle metronome' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'toggleMetronome'>>,

    setMetronomeVolume: {
        execute: executeSetMetronomeVolume,
        describe: (a) => ({ label: `Set metronome volume to ${Math.round(a.payload.volume * 100)}%` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setMetronomeVolume'>>,

    setMasterGain: {
        execute: executeSetMasterGain,
        describe: () => ({ label: 'Set master gain' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setMasterGain'>>,

    setLoopRegion: {
        execute: executeSetLoopRegion,
        describe: () => ({ label: 'Set loop region' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setLoopRegion'>>,

    seekPlayhead: {
        execute: executeSeekPlayhead,
        describe: (a) => ({ label: `Seek to beat ${a.payload.beat}` }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'seekPlayhead'>>,

    setPunchIn: {
        execute: executeSetPunchIn,
        describe: (a) => ({ label: `Set punch in at beat ${a.payload.beat}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setPunchIn'>>,

    setPunchOut: {
        execute: executeSetPunchOut,
        describe: (a) => ({ label: `Set punch out at beat ${a.payload.beat}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setPunchOut'>>,

    togglePunch: {
        execute: executeTogglePunch,
        describe: () => ({ label: 'Toggle punch in/out' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'togglePunch'>>,

    toggleCountIn: {
        execute: executeToggleCountIn,
        describe: () => ({ label: 'Toggle count-in' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'toggleCountIn'>>,

    setCountInBars: {
        execute: executeSetCountInBars,
        describe: (a) => ({ label: `Set count-in to ${a.payload.bars} bars` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setCountInBars'>>,

    addTimeSignatureChange: {
        execute: executeAddTimeSignatureChange,
        describe: (a) => ({
            label: `Set time signature ${a.payload.numerator}/${a.payload.denominator} at beat ${a.payload.beat}`,
        }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addTimeSignatureChange'>>,

    removeTimeSignatureChange: {
        execute: executeRemoveTimeSignatureChange,
        describe: (a) => ({ label: `Remove time signature change at beat ${a.payload.beat}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'removeTimeSignatureChange'>>,

    togglePreRoll: {
        execute: executeTogglePreRoll,
        describe: () => ({ label: 'Toggle pre-roll' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'togglePreRoll'>>,

    setPreRollBars: {
        execute: executeSetPreRollBars,
        describe: (a) => ({ label: `Set pre-roll to ${a.payload.bars} bars` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setPreRollBars'>>,
};
