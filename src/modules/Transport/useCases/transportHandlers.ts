import { setTempo } from './setTempo';
import { togglePlayback } from './transportControls/togglePlayback';
import { stopPlayback } from './transportControls/stopPlayback';
import { toggleLoop } from './transportControls/toggleLoop';
import { toggleMetronome } from './transportControls/toggleMetronome';
import { setMetronomeVolume } from './transportControls/setMetronomeVolume';
import { toggleRecording } from './transportControls/toggleRecording';
import { setLoopRegion } from './transportControls/setLoopRegion';
import { seekPlayhead } from './transportControls/seekPlayhead';
import { setPunchIn } from './transportControls/setPunchIn';
import { setPunchOut } from './transportControls/setPunchOut';
import { togglePunchEnabled } from './transportControls/togglePunchEnabled';
import { toggleCountIn } from './transportControls/toggleCountIn';
import { setCountInBars } from './transportControls/setCountInBars';
import { togglePreRoll } from './transportControls/togglePreRoll';
import { setPreRollBars } from './transportControls/setPreRollBars';
import { addTimeSignatureChange, removeTimeSignatureChange } from './timeSignatureChanges';
import { setMasterGain } from '#/modules/AudioEngine';

type TransportHandlerResult = {
    label: string;
};

type TransportHandler<Action> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => TransportHandlerResult;
    undoable: boolean;
};

type TransportAction =
    | { type: 'setTempo'; payload: { bpm: number } }
    | { type: 'togglePlayback'; payload?: undefined }
    | { type: 'stopPlayback'; payload?: undefined }
    | { type: 'toggleRecording'; payload?: undefined }
    | { type: 'toggleLoop'; payload?: undefined }
    | { type: 'toggleMetronome'; payload?: undefined }
    | { type: 'setMetronomeVolume'; payload: { volume: number } }
    | { type: 'setMasterGain'; payload: { gain: number } }
    | { type: 'setLoopRegion'; payload: { startBeat: number; endBeat: number } }
    | { type: 'seekPlayhead'; payload: { beat: number } }
    | { type: 'setPunchIn'; payload: { beat: number } }
    | { type: 'setPunchOut'; payload: { beat: number } }
    | { type: 'togglePunch'; payload?: undefined }
    | { type: 'toggleCountIn'; payload?: undefined }
    | { type: 'setCountInBars'; payload: { bars: number } }
    | { type: 'addTimeSignatureChange'; payload: { beat: number; numerator: number; denominator: number } }
    | { type: 'removeTimeSignatureChange'; payload: { beat: number } }
    | { type: 'togglePreRoll'; payload?: undefined }
    | { type: 'setPreRollBars'; payload: { bars: number } };

type TransportActionOf<ActionType extends TransportAction['type']> = Extract<TransportAction, { type: ActionType }>;

type TransportHandlers = {
    setTempo: TransportHandler<TransportActionOf<'setTempo'>>;
    togglePlayback: TransportHandler<TransportActionOf<'togglePlayback'>>;
    stopPlayback: TransportHandler<TransportActionOf<'stopPlayback'>>;
    toggleRecording: TransportHandler<TransportActionOf<'toggleRecording'>>;
    toggleLoop: TransportHandler<TransportActionOf<'toggleLoop'>>;
    toggleMetronome: TransportHandler<TransportActionOf<'toggleMetronome'>>;
    setMetronomeVolume: TransportHandler<TransportActionOf<'setMetronomeVolume'>>;
    setMasterGain: TransportHandler<TransportActionOf<'setMasterGain'>>;
    setLoopRegion: TransportHandler<TransportActionOf<'setLoopRegion'>>;
    seekPlayhead: TransportHandler<TransportActionOf<'seekPlayhead'>>;
    setPunchIn: TransportHandler<TransportActionOf<'setPunchIn'>>;
    setPunchOut: TransportHandler<TransportActionOf<'setPunchOut'>>;
    togglePunch: TransportHandler<TransportActionOf<'togglePunch'>>;
    toggleCountIn: TransportHandler<TransportActionOf<'toggleCountIn'>>;
    setCountInBars: TransportHandler<TransportActionOf<'setCountInBars'>>;
    addTimeSignatureChange: TransportHandler<TransportActionOf<'addTimeSignatureChange'>>;
    removeTimeSignatureChange: TransportHandler<TransportActionOf<'removeTimeSignatureChange'>>;
    togglePreRoll: TransportHandler<TransportActionOf<'togglePreRoll'>>;
    setPreRollBars: TransportHandler<TransportActionOf<'setPreRollBars'>>;
};

export const transportHandlers: TransportHandlers = {
    setTempo: {
        execute: (a) => {
            setTempo(a.payload.bpm);
        },
        describe: (a) => ({ label: `Set tempo to ${a.payload.bpm} BPM` }),
        undoable: true,
    },

    togglePlayback: {
        execute: () => {
            togglePlayback();
        },
        describe: () => ({ label: 'Toggle playback' }),
        undoable: false,
    },

    stopPlayback: {
        execute: () => {
            stopPlayback();
        },
        describe: () => ({ label: 'Stop playback' }),
        undoable: false,
    },

    toggleRecording: {
        execute: () => {
            toggleRecording();
        },
        describe: () => ({ label: 'Toggle recording' }),
        undoable: false,
    },

    toggleLoop: {
        execute: () => {
            toggleLoop();
        },
        describe: () => ({ label: 'Toggle loop' }),
        undoable: true,
    },

    toggleMetronome: {
        execute: () => {
            toggleMetronome();
        },
        describe: () => ({ label: 'Toggle metronome' }),
        undoable: true,
    },

    setMetronomeVolume: {
        execute: (a) => {
            setMetronomeVolume(a.payload.volume);
        },
        describe: (a) => ({ label: `Set metronome volume to ${Math.round(a.payload.volume * 100)}%` }),
        undoable: true,
    },

    setMasterGain: {
        execute: (a) => {
            setMasterGain(a.payload.gain);
        },
        describe: () => ({ label: 'Set master gain' }),
        undoable: true,
    },

    setLoopRegion: {
        execute: (a) => {
            setLoopRegion(a.payload.startBeat, a.payload.endBeat);
        },
        describe: () => ({ label: 'Set loop region' }),
        undoable: true,
    },

    seekPlayhead: {
        execute: (a) => {
            seekPlayhead(a.payload.beat);
        },
        describe: (a) => ({ label: `Seek to beat ${a.payload.beat}` }),
        undoable: false,
    },

    setPunchIn: {
        execute: (a) => {
            setPunchIn(a.payload.beat);
        },
        describe: (a) => ({ label: `Set punch in at beat ${a.payload.beat}` }),
        undoable: true,
    },

    setPunchOut: {
        execute: (a) => {
            setPunchOut(a.payload.beat);
        },
        describe: (a) => ({ label: `Set punch out at beat ${a.payload.beat}` }),
        undoable: true,
    },

    togglePunch: {
        execute: () => {
            togglePunchEnabled();
        },
        describe: () => ({ label: 'Toggle punch in/out' }),
        undoable: true,
    },

    toggleCountIn: {
        execute: () => {
            toggleCountIn();
        },
        describe: () => ({ label: 'Toggle count-in' }),
        undoable: true,
    },

    setCountInBars: {
        execute: (a) => {
            setCountInBars(a.payload.bars);
        },
        describe: (a) => ({ label: `Set count-in to ${a.payload.bars} bars` }),
        undoable: true,
    },

    addTimeSignatureChange: {
        execute: (a) => {
            addTimeSignatureChange(a.payload.beat, a.payload.numerator, a.payload.denominator);
        },
        describe: (a) => ({
            label: `Set time signature ${a.payload.numerator}/${a.payload.denominator} at beat ${a.payload.beat}`,
        }),
        undoable: true,
    },

    removeTimeSignatureChange: {
        execute: (a) => {
            removeTimeSignatureChange(a.payload.beat);
        },
        describe: (a) => ({ label: `Remove time signature change at beat ${a.payload.beat}` }),
        undoable: true,
    },

    togglePreRoll: {
        execute: () => {
            togglePreRoll();
        },
        describe: () => ({ label: 'Toggle pre-roll' }),
        undoable: true,
    },

    setPreRollBars: {
        execute: (a) => {
            setPreRollBars(a.payload.bars);
        },
        describe: (a) => ({ label: `Set pre-roll to ${a.payload.bars} bars` }),
        undoable: true,
    },
};
