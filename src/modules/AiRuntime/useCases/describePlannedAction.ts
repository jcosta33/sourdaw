import { markerStore } from '#/modules/Arrangement/stores';
import { describeAction } from '#/modules/Command/useCases';
import { createPunchRegionPatch } from '#/modules/Transport/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { resolveMarkerColorName } from '#/utils/markerColorPalette';

import { type ProjectContext } from '../models/ProjectContext';

type DescribePlannedActionInput = {
    action: AppAction;
    context: ProjectContext;
};

export function describePlannedAction({ action, context }: DescribePlannedActionInput): string {
    if (action.type === 'setPunchEnabled') {
        const verb = action.payload.enabled ? 'Enable' : 'Disable';
        const region = `${String(context.punchInBeat)}–${String(context.punchOutBeat)}`;
        if (action.payload.enabled) {
            return `${verb} Transport Punch In/Out until changed; during playback with an armed track, recording starts at punch-in beat ${String(context.punchInBeat)} and stops at punch-out beat ${String(context.punchOutBeat)}; punch region remains beats ${region}; background capture is unchanged`;
        }
        return `${verb} Transport Punch In/Out until changed; armed-track playback will no longer start and stop recording at punch region beats ${region}; punch region remains beats ${region}; background capture is unchanged`;
    }
    if (action.type === 'setPunchIn' || action.type === 'setPunchOut') {
        const current = { punchInBeat: context.punchInBeat, punchOutBeat: context.punchOutBeat };
        const edge = action.type === 'setPunchIn' ? 'in' : 'out';
        const patch = createPunchRegionPatch({ current, beat: action.payload.beat, edge });
        if (patch !== null) {
            const next = { ...current, ...patch };
            const enabledState = context.punchInEnabled ? 'enabled' : 'disabled';
            if (action.type === 'setPunchIn') {
                let oppositeChange = `punch-out remains at beat ${String(current.punchOutBeat)}`;
                if (next.punchOutBeat !== current.punchOutBeat) {
                    oppositeChange = `punch-out moves from beat ${String(current.punchOutBeat)} to ${String(next.punchOutBeat)}`;
                }
                return `Set punch-in to beat ${String(action.payload.beat)}; ${oppositeChange}; resulting region ${String(next.punchInBeat)}–${String(next.punchOutBeat)}; punch recording remains ${enabledState}`;
            }

            let oppositeChange = `punch-in remains at beat ${String(current.punchInBeat)}`;
            if (next.punchInBeat !== current.punchInBeat) {
                oppositeChange = `punch-in moves from beat ${String(current.punchInBeat)} to ${String(next.punchInBeat)}`;
            }
            return `Set punch-out to beat ${String(action.payload.beat)}; ${oppositeChange}; resulting region ${String(next.punchInBeat)}–${String(next.punchOutBeat)}; punch recording remains ${enabledState}`;
        }
    }
    if (action.type === 'setClipLoopLength') {
        for (const track of context.tracks) {
            const clip = track.clips.find((candidate) => candidate.id === action.payload.clipId);
            if (!clip) {
                continue;
            }
            const previous =
                clip.loopLength === undefined
                    ? `the implicit clip duration of ${String(clip.endBeat - clip.startBeat)} beats`
                    : `${String(clip.loopLength)} beats`;
            const loopState = clip.loopEnabled
                ? 'clip looping remains enabled'
                : 'clip looping remains disabled, so this stored length is dormant until looping is enabled';
            return `Set clip "${clip.name}" (${clip.id}) on track "${track.name}" (${track.id}) loop length from ${previous} to ${String(action.payload.loopLength)} beats; ${loopState}; clip range remains beats ${String(clip.startBeat)}–${String(clip.endBeat)}`;
        }
    }
    if (action.type === 'setTrackGain' || action.type === 'setTrackPan' || action.type === 'muteTrack') {
        const track = context.tracks.find((candidate) => candidate.id === action.payload.trackId);
        if (track) {
            const target = `track "${track.name}" (${track.id})`;
            if (action.type === 'setTrackGain') {
                return `Set ${target} gain to ${String(action.payload.gain)}`;
            }
            if (action.type === 'setTrackPan') {
                let pan = String(action.payload.pan);
                if (action.payload.pan > 0) {
                    pan = `+${pan}`;
                }
                return `Set ${target} pan to ${pan}`;
            }
            const verb = action.payload.muted ? 'Mute' : 'Unmute';
            return `${verb} ${target} (muted=${String(action.payload.muted)})`;
        }
    }
    if (action.type === 'automateSendRange') {
        const targetDescriptions = (action.payload.expectedSends ?? []).map((send) => {
            const track = context.tracks.find((candidate) => candidate.id === send.trackId);
            const lowered = send.level * 10 ** (-action.payload.reductionDb / 20);
            const target = track ? `"${track.name}" (${track.id})` : send.trackId;
            return `${target} ${String(send.level)}→${String(lowered)}`;
        });
        const busName = action.payload.busName ?? action.payload.busId;
        const range =
            action.payload.startBeat === undefined || action.payload.endBeat === undefined
                ? action.payload.sectionName
                : `${action.payload.sectionName} beats ${String(action.payload.startBeat)}–${String(action.payload.endBeat)}`;
        return `Lower sends to "${busName}" (${action.payload.busId}) by ${String(action.payload.reductionDb)} dB only in ${range}: ${targetDescriptions.join(', ')}`;
    }
    if (action.type === 'removeTrack') {
        const track = context.tracks.find((candidate) => candidate.id === action.payload.trackId);
        if (track) {
            return `Remove track "${track.name}"`;
        }
    }
    if (action.type === 'removeClip') {
        const clip = context.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        if (clip) {
            return `Remove clip "${clip.name}"`;
        }
    }
    if (action.type === 'glueClips') {
        const sources = action.payload.clipIds.flatMap((clipId) => {
            for (const track of context.tracks) {
                const clip = track.clips.find((candidate) => candidate.id === clipId);
                if (clip) {
                    return [
                        {
                            description: `"${clip.name}" (${clip.id}, beats ${String(clip.startBeat)}–${String(clip.endBeat)})`,
                            track,
                        },
                    ];
                }
            }
            return [];
        });
        const sourceTrack = sources[0]?.track;
        if (
            sources.length === action.payload.clipIds.length &&
            sourceTrack &&
            sources.every((source) => source.track.id === sourceTrack.id)
        ) {
            return `Glue MIDI clips ${sources.map((source) => source.description).join(' and ')} on MIDI track "${sourceTrack.name}" (${sourceTrack.id})`;
        }
        return 'Glue MIDI clips';
    }
    if (action.type === 'moveClip') {
        const clip = context.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        const track = context.tracks.find((candidate) => candidate.id === action.payload.trackId);
        if (clip && track) {
            return `Move clip "${clip.name}" to track "${track.name}" at beat ${String(action.payload.startBeat)}`;
        }
        return `Move clip to beat ${String(action.payload.startBeat)}`;
    }
    if (action.type === 'normalizeClip') {
        const clip = context.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        const target = clip ? ` clip "${clip.name}"` : ' clip';
        const mode = action.payload.mode ?? 'peak';
        if (mode === 'peak') {
            return `Normalize${target} using peak measurement`;
        }
        const targetDb = action.payload.targetDb ?? -14;
        if (mode === 'lufs') {
            return `Normalize${target} to ${String(targetDb)} LUFS`;
        }
        return `Normalize${target} to ${String(targetDb)} dB RMS`;
    }
    if (action.type === 'setClipStretchRatio') {
        const clip = context.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        const target = clip ? ` clip "${clip.name}"` : ' clip';
        return `Set${target} stretch ratio to ${String(action.payload.ratio)}×`;
    }
    if (action.type === 'setClipStretchMode') {
        const clip = context.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        const target = clip ? ` clip "${clip.name}"` : ' clip';
        return `Set${target} stretch mode to ${action.payload.mode}`;
    }
    if (action.type === 'fitClipToBeats') {
        const clip = context.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        const target = clip ? ` clip "${clip.name}"` : ' clip';
        return `Fit${target} to ${String(action.payload.targetBeats)} beats`;
    }
    if (action.type === 'removeMarker') {
        const marker = markerStore.value?.markers.find((candidate) => candidate.id === action.payload.markerId);
        if (marker) {
            return `Remove marker "${marker.name}" at beat ${String(marker.beat)} (${marker.id})`;
        }
    }
    if (action.type === 'setMarkerColor') {
        const marker = markerStore.value?.markers.find((candidate) => candidate.id === action.payload.markerId);
        if (marker) {
            const color = resolveMarkerColorName(action.payload.color) ?? action.payload.color;
            return `Set marker "${marker.name}" at beat ${String(marker.beat)} (${marker.id}) color to ${color}`;
        }
    }
    if (action.type === 'addSection') {
        return `Add section "${action.payload.name}" from beat ${String(action.payload.startBeat)} to beat ${String(action.payload.endBeat)}`;
    }
    if (action.type === 'removeSection' || action.type === 'renameSection') {
        const section = markerStore.value?.sections.find((candidate) => candidate.id === action.payload.sectionId);
        if (section) {
            if (action.type === 'removeSection') {
                return `Remove section "${section.name}" from beat ${String(section.startBeat)} to beat ${String(section.endBeat)} (${section.id})`;
            }
            return `Rename section "${section.name}" to "${action.payload.name}" from beat ${String(section.startBeat)} to beat ${String(section.endBeat)} (${section.id})`;
        }
    }
    if (
        action.type === 'quantizeNotes' ||
        action.type === 'transposeNotes' ||
        action.type === 'invertNotes' ||
        action.type === 'retrogradeNotes' ||
        action.type === 'quantizeNoteLengths' ||
        action.type === 'scaleAllVelocities' ||
        action.type === 'setAllVelocities'
    ) {
        const clip = context.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        if (clip) {
            if (action.type === 'quantizeNotes') {
                return `Quantize notes in "${clip.name}" (${clip.id}) to a ${String(action.payload.gridSize)}-beat grid`;
            }
            if (action.type === 'transposeNotes') {
                let signedSemitones = String(action.payload.semitones);
                if (action.payload.semitones > 0) {
                    signedSemitones = `+${signedSemitones}`;
                }
                return `Transpose notes in "${clip.name}" (${clip.id}) by ${signedSemitones} semitones`;
            }
            if (action.type === 'invertNotes') {
                return `Invert notes in "${clip.name}" (${clip.id})`;
            }
            if (action.type === 'retrogradeNotes') {
                return `Retrograde notes in "${clip.name}" (${clip.id})`;
            }
            if (action.type === 'quantizeNoteLengths') {
                return `Quantize note lengths in "${clip.name}" (${clip.id}) to a ${String(action.payload.gridSize)}-beat grid`;
            }
            if (action.type === 'scaleAllVelocities') {
                return `Scale note velocities in "${clip.name}" (${clip.id}) by ×${String(action.payload.factor)}`;
            }
            return `Set note velocities in "${clip.name}" (${clip.id}) to ${String(action.payload.velocity)}`;
        }
    }

    if (action.type === 'addSidechainRoute' || action.type === 'removeSidechainRoute') {
        const source = context.tracks.find((track) => track.id === action.payload.sourceTrackId);
        const target = context.tracks.find((track) => track.id === action.payload.targetTrackId);
        if (source && target) {
            const operation = action.type === 'addSidechainRoute' ? 'Add' : 'Remove';
            return `${operation} sidechain route: "${source.name}" (${source.id}) → "${target.name}" (${target.id})`;
        }
    }
    return describeAction(action);
}
