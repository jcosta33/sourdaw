import type { ActionHandler } from "../models/ActionHandler";
import type { AppAction } from "../models/AppAction";
import { setTempo } from "#/modules/Transport/useCases/setTempo";
import {
    togglePlayback,
    stopPlayback,
    toggleLoop,
    toggleMetronome,
    setMetronomeVolume,
    toggleRecording,
    setLoopRegion,
    seekPlayhead,
    setPunchIn,
    setPunchOut,
    togglePunchEnabled,
    toggleCountIn,
    setCountInBars,
    togglePreRoll,
    setPreRollBars,
} from "#/modules/Transport/useCases/transportControls";
import { addTimeSignatureChange, removeTimeSignatureChange } from "#/modules/Transport/useCases/timeSignatureChanges";
import { setMasterGain } from "#/modules/AudioEngine/useCases/setMasterGain";

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const transportHandlers = {
    setTempo: {
        execute: (a) => { setTempo(a.payload.bpm); },
        describe: (a) => ({ label: `Set tempo to ${a.payload.bpm} BPM` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "setTempo">>,

    togglePlayback: {
        execute: () => { togglePlayback(); },
        describe: () => ({ label: "Toggle playback" }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, "togglePlayback">>,

    stopPlayback: {
        execute: () => { stopPlayback(); },
        describe: () => ({ label: "Stop playback" }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, "stopPlayback">>,

    toggleRecording: {
        execute: () => { toggleRecording(); },
        describe: () => ({ label: "Toggle recording" }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, "toggleRecording">>,

    toggleLoop: {
        execute: () => { toggleLoop(); },
        describe: () => ({ label: "Toggle loop" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "toggleLoop">>,

    toggleMetronome: {
        execute: () => { toggleMetronome(); },
        describe: () => ({ label: "Toggle metronome" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "toggleMetronome">>,

    setMetronomeVolume: {
        execute: (a) => { setMetronomeVolume(a.payload.volume); },
        describe: (a) => ({ label: `Set metronome volume to ${Math.round(a.payload.volume * 100)}%` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "setMetronomeVolume">>,

    setMasterGain: {
        execute: (a) => { setMasterGain(a.payload.gain); },
        describe: () => ({ label: "Set master gain" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "setMasterGain">>,

    setLoopRegion: {
        execute: (a) => { setLoopRegion(a.payload.startBeat, a.payload.endBeat); },
        describe: () => ({ label: "Set loop region" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "setLoopRegion">>,

    seekPlayhead: {
        execute: (a) => { seekPlayhead(a.payload.beat); },
        describe: (a) => ({ label: `Seek to beat ${a.payload.beat}` }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, "seekPlayhead">>,

    setPunchIn: {
        execute: (a) => { setPunchIn(a.payload.beat); },
        describe: (a) => ({ label: `Set punch in at beat ${a.payload.beat}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "setPunchIn">>,

    setPunchOut: {
        execute: (a) => { setPunchOut(a.payload.beat); },
        describe: (a) => ({ label: `Set punch out at beat ${a.payload.beat}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "setPunchOut">>,

    togglePunch: {
        execute: () => { togglePunchEnabled(); },
        describe: () => ({ label: "Toggle punch in/out" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "togglePunch">>,

    toggleCountIn: {
        execute: () => { toggleCountIn(); },
        describe: () => ({ label: "Toggle count-in" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "toggleCountIn">>,

    setCountInBars: {
        execute: (a) => { setCountInBars(a.payload.bars); },
        describe: (a) => ({ label: `Set count-in to ${a.payload.bars} bars` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "setCountInBars">>,

    addTimeSignatureChange: {
        execute: (a) => { addTimeSignatureChange(a.payload.beat, a.payload.numerator, a.payload.denominator); },
        describe: (a) => ({ label: `Set time signature ${a.payload.numerator}/${a.payload.denominator} at beat ${a.payload.beat}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "addTimeSignatureChange">>,

    removeTimeSignatureChange: {
        execute: (a) => { removeTimeSignatureChange(a.payload.beat); },
        describe: (a) => ({ label: `Remove time signature change at beat ${a.payload.beat}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "removeTimeSignatureChange">>,

    togglePreRoll: {
        execute: () => { togglePreRoll(); },
        describe: () => ({ label: "Toggle pre-roll" }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "togglePreRoll">>,

    setPreRollBars: {
        execute: (a) => { setPreRollBars(a.payload.bars); },
        describe: (a) => ({ label: `Set pre-roll to ${a.payload.bars} bars` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, "setPreRollBars">>,
};
