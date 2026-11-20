import { logger } from '#/infra/logger/appLogger';

import {
    type AudioGraphBackend,
    type AudioGraphDeviceTarget,
    type AudioGraphReleaseGrandBoulePreviewCommand,
    type AudioGraphStartGrandBoulePreviewCommand,
} from '../../models/AudioGraphBackend';

import { isDeviceCarriedByNativeSession } from './isDeviceCarriedByNativeSession';
import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';

type NativeGrandBoulePreviewNote = AudioGraphDeviceTarget & Readonly<{ note: number; velocity: number }>;
type PreviewCommand = AudioGraphStartGrandBoulePreviewCommand | AudioGraphReleaseGrandBoulePreviewCommand;

let nextStrikeId = 1;

function generationFor({ trackId, deviceId }: AudioGraphDeviceTarget): string | undefined {
    return nativeLiveGraphSession.grandBoulePreviewTargetsByStripId
        .get(trackId)
        ?.find((target) => target.deviceId === deviceId)?.generation;
}

async function applyPreviewCommand(backend: AudioGraphBackend, command: PreviewCommand): Promise<void> {
    try {
        const result = await backend.apply({ schemaVersion: 1, commands: [command] });
        if (result.application !== 'applied') {
            logger.warn(`[AudioEngine] ${command.kind} refused: ${result.reason}`);
        }
    } catch (error) {
        logger.warn(`[AudioEngine] ${command.kind} failed:`, error);
    }
}

/** Start one panel strike on its realized native body and capture that body's release. */
export function startNativeGrandBoulePreviewNote(input: NativeGrandBoulePreviewNote): (() => void) | undefined {
    const { trackId, deviceId, note, velocity } = input;
    const target = { trackId, deviceId };
    const backend = nativeLiveGraphSession.backend;
    const generation = generationFor(target);
    if (
        backend === null ||
        generation === undefined ||
        !isDeviceCarriedByNativeSession(trackId, deviceId) ||
        !Number.isInteger(note) ||
        note < 21 ||
        note > 108 ||
        !Number.isFinite(velocity) ||
        velocity <= 0 ||
        velocity > 1 ||
        nextStrikeId > 0xffff_ffff
    ) {
        return undefined;
    }

    const strikeId = nextStrikeId++;
    let released = false;
    let submitted = false;
    void queueOnNativeLiveGraphSession(async () => {
        if (
            released ||
            nativeLiveGraphSession.backend !== backend ||
            generationFor(target) !== generation ||
            !isDeviceCarriedByNativeSession(trackId, deviceId)
        ) {
            return;
        }
        submitted = true;
        await applyPreviewCommand(backend, {
            kind: 'start-grand-boule-preview',
            target,
            generation,
            strikeId,
            note,
            velocity,
        });
    });
    return () => {
        if (released) {
            return;
        }
        released = true;
        if (!submitted) {
            return;
        }
        void queueOnNativeLiveGraphSession(async () => {
            if (nativeLiveGraphSession.backend !== backend && nativeLiveGraphSession.orphanedBackend !== backend) {
                return;
            }
            // The onset may have reached native even if the bridge could not read its reply.
            // Address its own generation after carrier handoff and let native reject stale bodies.
            await applyPreviewCommand(backend, { kind: 'release-grand-boule-preview', target, generation, strikeId });
        });
    };
}
