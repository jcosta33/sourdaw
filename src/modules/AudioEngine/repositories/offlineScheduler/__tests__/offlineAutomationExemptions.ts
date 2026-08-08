/**
 * Reason-bearing exemption table for the offline device-parameter automation
 * census (`offlineAutomationCoverage.spec.ts`), per ADR 0015 rule 2 (iii).
 *
 * This table is what stops the census being a tautology. The census used to
 * source its expectation from `FERMENTER_AUTOMATION_PARAM_IDS` — the same
 * allow-list whose regrowth it claimed to prevent — so every verdict it reached
 * was `Object.hasOwn(map, id) === Object.hasOwn(map, id)`. ADR 0015's own
 * context section cites that spec as the leading example of a guard whose only
 * reachable verdict is the one it already has.
 *
 * The census now walks `NATIVE_DSP_DEVICE_FACTORIES` crossed with
 * `getBuiltinPlugins()` and, for every pair, asserts that the device either
 * resolves an offline binding **or** carries a row here. The two sources are
 * independent: adding an ordinal to a node's param-id map without deleting its
 * row reds, and deleting a row while the pair is still incapable reds.
 *
 * Two classes, kept apart and counted separately, because a single total hides
 * the whole subject:
 *
 *  - **Device-level** — the node declares no `scheduleParam` at all, so one
 *    reason covers every parameter on the device. `DEVICE_LEVEL_OFFLINE_AUTOMATION_EXEMPTIONS`.
 *  - **Parameter-level** — the device *does* schedule, but this parameter is not
 *    in its ordinal map. Every row needs its own reason. This table.
 *
 * The reasons here are honest about their own state: AC-1 of
 * SPEC-parameter-automation-coverage — the per-parameter classification that
 * decides which of these are engine work and which are descriptor defects — has
 * not been run. Recording 105 rows as "unclassified, and here is what would
 * settle it" is the point: before this table existed the census could not see
 * them at all.
 *
 * Generated from the registry walk, then committed. Regenerate by re-running the
 * census; do not hand-edit a row without changing the code it describes.
 */
export const PARAMETER_LEVEL_OFFLINE_AUTOMATION_EXEMPTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> =
    {
        fermenter: {
            oscEngine:
                'unclassified: declared `int` — AC-1 must decide class (b) structural selector vs class (c) stepped-but-automatable before an ordinal is wired',
            oscCoarse:
                'unclassified: declared `int` — AC-1 must decide class (b) structural selector vs class (c) stepped-but-automatable before an ordinal is wired',
            oscFine:
                'unclassified: declared `int` — AC-1 must decide class (b) structural selector vs class (c) stepped-but-automatable before an ordinal is wired',
            pulseWidth:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            unisonVoices:
                'unclassified: declared `int` — AC-1 must decide class (b) structural selector vs class (c) stepped-but-automatable before an ordinal is wired',
            unisonDetune:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            noiseColor:
                'unclassified: declared `int` — AC-1 must decide class (b) structural selector vs class (c) stepped-but-automatable before an ordinal is wired',
            oscDrift:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            warpMode:
                'unclassified: declared `int` — AC-1 must decide class (b) structural selector vs class (c) stepped-but-automatable before an ordinal is wired',
            warpAmount:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            audioModRate:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            audioModDepth:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            audioModTarget:
                'unclassified: declared `int` — AC-1 must decide class (b) structural selector vs class (c) stepped-but-automatable before an ordinal is wired',
            additivePartials:
                'unclassified: declared `int` — AC-1 must decide class (b) structural selector vs class (c) stepped-but-automatable before an ordinal is wired',
            additiveTilt:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            additiveOdd:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            additiveInharm:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            ksDamping:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            ksBrightness:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            grainPosition:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            grainPitchVar:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            grainPanSpread:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            samplerMode:
                'unclassified: declared `int` — AC-1 must decide class (b) structural selector vs class (c) stepped-but-automatable before an ordinal is wired',
            samplerStart:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            samplerEnd:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            voiceDrive:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            filterModel:
                'unclassified: declared `int` — AC-1 must decide class (b) structural selector vs class (c) stepped-but-automatable before an ordinal is wired',
            filterMode:
                'unclassified: declared `int` — AC-1 must decide class (b) structural selector vs class (c) stepped-but-automatable before an ordinal is wired',
            filterDrive:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            filterKeytrack:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            fmAlgorithm:
                'unclassified: declared `int` — AC-1 must decide class (b) structural selector vs class (c) stepped-but-automatable before an ordinal is wired',
            fmRatio1:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            fmRatio2:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            fmRatio3:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            fmRatio4:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            fmLevel1:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            fmLevel3:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            fmLevel4:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            fmModAmount:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            ampAttack:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            ampDecay:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            ampSustain:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            ampRelease:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            filterAttack:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            filterDecay:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            filterSustain:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            filterRelease:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            lfoShape:
                'unclassified: declared `int` — AC-1 must decide class (b) structural selector vs class (c) stepped-but-automatable before an ordinal is wired',
            seqRate:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            seqToPitch:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            portamentoTime:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            portamentoMode:
                'unclassified: declared `int` — AC-1 must decide class (b) structural selector vs class (c) stepped-but-automatable before an ordinal is wired',
            reverbType:
                'unclassified: declared `int` — AC-1 must decide class (b) structural selector vs class (c) stepped-but-automatable before an ordinal is wired',
            reverbMix:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            reverbDecay:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            eqLowFreq:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            eqLowGain:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            eqLowQ: 'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            eqMidFreq:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            eqMidGain:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            eqMidQ: 'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            eqHighFreq:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            eqHighGain:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            eqHighQ:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            delayTime:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            delayFeedback:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            delayMix:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            chorusRate:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            chorusDepth:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            chorusMix:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            phaserRate:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            phaserDepth:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            phaserMix:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            distDrive:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            distTone:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            distMix:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            compThreshold:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            compRatio:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            compAttack:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            compRelease:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            compMix:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            stereoWidth:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            activeLayer:
                'unclassified: declared `int` — AC-1 must decide class (b) structural selector vs class (c) stepped-but-automatable before an ordinal is wired',
            numLayers:
                'unclassified: declared `int` — AC-1 must decide class (b) structural selector vs class (c) stepped-but-automatable before an ordinal is wired',
            layerLevel:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            layerPan:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            chaosAmount:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            chaosSpeed:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            masterGain:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
        },
        toaster: {
            swing: 'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
        },
        'dutch-oven': {
            damping:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            predelay:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            size: 'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            mod_rate:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            mod_depth:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            diffusion:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            high_cut:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            low_cut:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            width: 'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            freeze: 'unclassified: declared `bool` — AC-1 must decide class (b) vs class (c); a reverb switch is automated in shipping hosts',
            shimmer:
                'unclassified: declared `bool` — AC-1 must decide class (b) vs class (c); a reverb switch is automated in shipping hosts',
            shimmer_amount:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            gravity:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            early_late:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
            density:
                'unclassified: declared `float`, continuous in the engine — SPEC-parameter-automation-coverage AC-1 class (a) candidate, no offline ordinal wired',
        },
    };

/**
 * Devices whose node supplies no `scheduleParam` at all. One reason covers every
 * automatable parameter the descriptor declares. These belong to the
 * **device-level** class, which SPEC-offline-live-collapse Phase 2 AC-4 owns;
 * SPEC-parameter-automation-coverage explicitly does not re-open them.
 */
export const DEVICE_LEVEL_OFFLINE_AUTOMATION_EXEMPTIONS: Readonly<Record<string, string>> = {
    levain: 'LevainNode supplies no scheduleParam — device-level class, SPEC-offline-live-collapse Phase 2 AC-4',
    'builtin-crumbs':
        'CrumbsNode supplies no scheduleParam — device-level class, SPEC-parameter-automation-coverage §8 (out of scope, reasoned exemption)',
    'grand-boule':
        'GrandBouleNode supplies no scheduleParam — device-level class, SPEC-parameter-automation-coverage §8 (out of scope, reasoned exemption)',
    gluten: 'GlutenNode supplies no scheduleParam — device-level class, SPEC-offline-live-collapse Phase 2 AC-4',
    crust: 'CrustNode supplies no scheduleParam — device-level class, SPEC-parameter-automation-coverage §8 (out of scope, reasoned exemption)',
    bacteria: 'BacteriaNode supplies no scheduleParam — device-level class, SPEC-offline-live-collapse Phase 2 AC-4',
    grinder: 'GrinderNode supplies no scheduleParam — device-level class, SPEC-offline-live-collapse Phase 2 AC-4',
    proof: 'ProofNode supplies no scheduleParam — device-level class, SPEC-offline-live-collapse Phase 2 AC-4',
};

/**
 * Factories with no descriptor anywhere in `getBuiltinPlugins()`. This is not an
 * exemption — a device with no descriptor is outside the range law and the
 * automatable law at once, and both of those fail **open**
 * (`DeviceParameterLaw.ts`: an unknown device type is returned unclamped and
 * reported automatable). SPEC-parameter-automation-coverage AC-6 owns it.
 */
export const NO_DESCRIPTOR_NATIVE_DEVICE_TYPES: readonly string[] = ['knead'];
