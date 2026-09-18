import { type DecodedBank, type DecodedSample } from '../repositories/sampleLoader/createDecodedBankResource';

/**
 * One decoded Levain bank as the native bank store takes it (#3124).
 *
 * Pure, and deliberately a translation rather than a second reading of the
 * manifest: every field below is the one the worklet's own upload protocol
 * posts for the same bank (`loadInstrumentFromManifest.ts`), including the
 * choice of sample id — the index of the file in `bank.files`, which is what
 * the worklet numbers its samples by — and the three string encodings
 * (`loopMode`, `transitionType`, `dynamic`) whose names rather than
 * discriminants cross. `commands::levain`
 * (`crates/sourdaw-native/src/commands/levain.rs`) deserializes that same
 * vocabulary with `deny_unknown_fields` and translates it with ports of the
 * worklet's own tables, so the browser runtime and the native one sound one
 * bank instead of two readings of it.
 *
 * The return shape is inferred rather than annotated against
 * AudioEngine's `NativeSampleBank`: a contract barrel cannot carry a type
 * (`no-usecase-type-exports-on-index`), so the weld is made where the two sides
 * actually meet — `src/app/nativeSampleBanks.ts` hands this through
 * `configureAudioDeviceRuntimeSink`, and any drift from the engine's own wire
 * model fails to compile there.
 */

function bankLabel(bank: DecodedBank): string {
    return `${bank.instrumentId}@${String(bank.version)}`;
}

function decodedFile(bank: DecodedBank, file: string): DecodedSample {
    const decoded = bank.samples.get(file);
    if (!decoded) {
        throw new Error(`Decoded Levain bank ${bankLabel(bank)} is missing ${file}`);
    }
    return decoded;
}

function sampleIdForFile(bank: DecodedBank, sampleIdByFile: ReadonlyMap<string, string>, file: string): string {
    const sampleId = sampleIdByFile.get(file);
    if (sampleId === undefined) {
        throw new Error(`Decoded Levain bank ${bankLabel(bank)} has no id for ${file}`);
    }
    return sampleId;
}

/**
 * Mono or stereo, or a throw naming the file.
 *
 * `add_sample` refuses anything wider, and a refusal that crossed the bridge
 * would arrive as a message that no longer knows which file it was — the same
 * reason `interleaveAudioBufferPcm` checks the clip side here too.
 */
function bankSampleChannels(bank: DecodedBank, file: string, channels: number): 1 | 2 {
    if (channels === 1 || channels === 2) {
        return channels;
    }
    throw new Error(
        `Decoded Levain bank ${bankLabel(bank)} file ${file} carries ${String(channels)} channels; ` +
            'the native bank store takes mono or stereo'
    );
}

/**
 * The decoded PCM as a fresh, unshared byte copy.
 *
 * The copy is the point. The decoded-bank cache keeps its material in a
 * `SharedArrayBuffer` so the worklet can read it with no transfer, and a
 * `SharedArrayBuffer`-backed view cannot cross the desktop bridge's binary
 * channel at all — so handing one to the transport would fail the registration
 * rather than share it. Copying bytes rather than re-encoding floats is sound
 * because the wire is interleaved f32 *little-endian* and the material is
 * already interleaved f32 in memory, on the only byte order Chromium ships.
 */
function copyInterleavedPcm(data: DecodedSample['data']): Uint8Array {
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return bytes;
}

export function decodedBankToNativeSampleBank(bank: DecodedBank) {
    const sampleIdByFile = new Map(bank.files.map((file, index): [string, string] => [file, String(index)]));

    const samples = bank.files.map((file, index) => {
        const decoded = decodedFile(bank, file);
        return {
            sampleId: String(index),
            sampleRate: decoded.sampleRate,
            channels: bankSampleChannels(bank, file, decoded.channels),
            // Frames per channel as the decoder read them. The store recomputes
            // the figure from the byte length it receives, so this travels for
            // the caller's sake rather than the wire's.
            frameCount: decoded.frameCount,
            pcm: copyInterleavedPcm(decoded.data),
        };
    });

    const zones = bank.zones.map(({ zone, articulationId }) => {
        const decoded = decodedFile(bank, zone.file);
        let loopMode: 'none' | 'forward' | 'pingpong' = 'none';
        let loopStart = 0;
        let loopEnd = 0;
        let loopCrossfade = 0;
        if (zone.loop.mode !== 'none') {
            loopMode = zone.loop.mode;
            loopStart = zone.loop.startFrame;
            // `sample-end` is resolved here, exactly as the worklet resolves it:
            // the engine takes frames, and only the decoder knows how many the
            // file turned out to hold.
            loopEnd = zone.loop.endFrame === 'sample-end' ? decoded.frameCount : zone.loop.endFrame;
            loopCrossfade = zone.loop.crossfadeFrames;
        }
        return {
            sampleId: sampleIdForFile(bank, sampleIdByFile, zone.file),
            articulationId,
            rootNote: zone.rootNote,
            loKey: zone.loKey,
            hiKey: zone.hiKey,
            loVel: zone.loVel,
            hiVel: zone.hiVel,
            rrPos: zone.rrPos,
            rrLen: zone.rrLen,
            micId: zone.micId,
            isRelease: zone.isRelease,
            loopMode,
            loopStart,
            loopEnd,
            loopCrossfade,
            gainDb: zone.gainDb,
            attack: zone.attack,
            decay: zone.decay,
            sustain: zone.sustain,
            release: zone.release,
        };
    });

    const legatoTransitions = bank.legatoTransitions.map((transition) => ({
        sampleId: sampleIdForFile(bank, sampleIdByFile, transition.file),
        interval: transition.interval,
        transitionType: transition.transitionType,
        dynamic: transition.dynamic,
        crossfadeOutMs: transition.crossfadeOutMs,
    }));

    return {
        instrumentId: bank.instrumentId,
        numArticulations: bank.numArticulations,
        numMics: bank.numMics,
        zones,
        legatoTransitions,
        samples,
    };
}
