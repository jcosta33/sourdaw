import { type DeviceParameterGuidance } from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION } from './GuidanceProfiles';

/**
 * Per-parameter guidance for Grinder, taken from `crates/daw-dsp/src/grinder`.
 *
 * Signal order the interactions below rely on: input trim and pickup loading,
 * gate, pre-amp pedals, triode preamp, tone stack, power amp, output
 * transformer, cabinet IR then parametric speaker, post-amp pedals, fat
 * voicing, output gain, clean blend, wet/dry mix, soft limiter. The gate,
 * pedal, amp-model, tone-stack-type, power-tube, rectifier, cabinet-mode and
 * mic-enable controls have no descriptor parameter, so entries state what the
 * engine does at the values the descriptor can reach, never an invented
 * control.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const GRINDER_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    inputGain: parameterGuidance(
        'Amp input trim',
        'Sets how hard the guitar signal hits the gate, pedals and preamp, so it changes how much the amp breaks up as well as how loud it is.',
        -6,
        6,
        [
            'Multiplies with gain before the triode stages, so the two are one drive budget: raise one and lower the other to hold breakup constant.',
            'The gate measures the signal after this trim, so gateThreshold must be re-judged whenever this moves; outputGain, which comes after the cabinet, is the level trim that leaves the amp tone alone.',
        ],
        [
            'Each +6 dB doubles the amplitude entering the preamp, which is nonlinear, so this changes distortion character rather than only loudness; +24 dB is a 15.8x multiplier that pushes the first triode stage far past its grid-conduction onset even at the default gain.',
        ],
        noExternalModulation
    ),
    inputImpedance: parameterGuidance(
        'Pickup loading corner',
        'Dulls the top end like a heavily loaded pickup at low values and leaves the guitar untouched near the default.',
        100,
        3000,
        [
            'A one-pole low-pass sits ahead of the gate and preamp, so highs it removes cannot be restored by treble, presence or bright, which all act on the already-filtered signal.',
        ],
        [
            'In Instrument input mode the low-pass corner follows log10 of this value from 4 kHz at 10 through 12 kHz at 100 to 20 kHz at 1000 and 28 kHz at 10000, so values below about 100 audibly dull the signal before any distortion stage and the gain control then amplifies that dull signal.',
        ],
        noExternalModulation
    ),
    gateThreshold: parameterGuidance(
        'Noise gate open threshold',
        'Sets the level below which the gate closes the amp between notes to hide hum and hiss.',
        -70,
        -45,
        [
            'Only acts once the gate is switched on in the Grinder panel, which this descriptor cannot do; the gate reads the signal after inputGain, so raising inputGain raises the level the threshold is compared against.',
            'Pairs with gateAttack, which sets the opening fade time, and gateRelease, which sets both how long the gate stays open after a note stops and how fast it then fades shut.',
        ],
        [
            'A threshold above the quiet end of a sustained note closes the gate on the decay: the gate holds open for a fixed 20 ms, uses roughly 1 dB of hysteresis either side of the threshold and then fades to about -72 dB at the gateRelease time, so the tail is cut short rather than left to decay.',
        ],
        noExternalModulation
    ),
    gateAttack: parameterGuidance(
        'Noise gate opening fade time',
        'Sets how fast the gate fades open on a pick, so short values keep the attack and long values soften it.',
        0.5,
        10,
        [
            'Sets the opening gain fade time, while the detector attack follows at half of it; it only matters once the gate is on, and gateThreshold decides when the gate opens.',
            'It does not set the closing fade: gateRelease sets both when the gate starts to close and how fast it fades shut.',
        ],
        [
            'For a step 36 dB above gateThreshold at 48 kHz the gain rises from 10 to 90 percent in 1.1 ms at 0.5, 4.4 ms at 2 and 22 ms at 10, so values toward 10 fade the first part of every pick in and fast palm-muted playing loses its transient.',
        ],
        noExternalModulation
    ),
    gateRelease: parameterGuidance(
        'Noise gate release time',
        'Sets how long the gate stays open after a note stops and how slowly it then fades shut, so short values close early and quickly and long values let the tail ring out.',
        60,
        250,
        [
            'Sets the closing gain fade time and the detector release at 0.6 times this value, so it decides both when closing starts (the fixed 20 ms hold plus the time the detector takes to fall from the note level to the close threshold) and how fast the fade runs; it only matters once the gate is on, and gateAttack sets only the opening fade.',
            'For a 110 Hz note stopped abruptly with gateThreshold at -60 dB and gateAttack at 2, closing starts about 106 ms after the stop at 60 and 383 ms at 250 for a note at -40 dBFS, 164 and 624 ms at -26 dBFS, and 228 and 892 ms at -10.5 dBFS; the gain then falls from 90 to 10 percent in about 132 ms at 60 and 550 ms at 250.',
        ],
        [
            'On a 110 Hz note decaying from 0.1 with a 300 ms time constant and gateThreshold from -30 to -50 dB, at a gateAttack of 0.5 to 2 the gain is down to 10 percent about 186 to 194 ms after the tail passes the threshold at 60 and 693 to 709 ms at 250, so short values do not clip the decay and long ones leave noise audible in the gaps between phrases; a long gateAttack combined with a very short release closes early, because the slow detector attack keeps the envelope under the tail peaks, and at gateAttack 10 with release 5 the gain is down to 10 percent about 60 ms before the tail reaches the threshold.',
        ],
        noExternalModulation
    ),
    gain: parameterGuidance(
        'Preamp drive amount',
        'Sets how much the triode stages break up, from clean sparkle at low values to saturated crunch and lead at high values.',
        3,
        8,
        [
            'Scales the signal by gain/10 before the triode cascade and then 50 V per unit at the grid, so a 0.1-peak DI at gain 5 swings the grid about 2.5 V, past the 2.06 to 2.22 V that gridConduction sets as the grid-conduction onset; channel decides how many stages (1, 2 or 3) compound that drive.',
            'inputGain multiplies with it, and master and transformerDrive add power-stage and transformer saturation after the tone stack.',
        ],
        [
            'High settings on the lead channel amplify noise and hum along with the note, and the tone stack and power stage after the preamp then compress the result, so raising this beyond about 8 adds fizz faster than sustain.',
            'The bright switch matters less as this rises: its lift scales with (1 - gain/10).',
        ],
        noExternalModulation
    ),
    channel: parameterGuidance(
        'Preamp channel stage count',
        'Chooses clean (0), crunch (1) or lead (2), which runs one, two or three triode stages in series.',
        1,
        2,
        [
            'Every added stage compounds the drive that gain sets, with an inter-stage attenuation of 0.10 to 0.18 depending on the amp model; bright lift is scaled by 1.0, 0.72 and 0.42 for the three positions.',
        ],
        [
            'Each stage adds 6.5 samples of oversampler latency, so the preamp reports 6.5, 13 or 19.5 samples depending on channel, and stepping it during playback changes both level and latency at once; the values are positions, and 0.5 truncates to clean.',
        ],
        noExternalModulation
    ),
    bright: parameterGuidance(
        'Bright switch',
        'Adds a gentle lift above about 2 kHz in the preamp, most audible on clean, low-gain settings.',
        0,
        0,
        [
            'The lift is 0.045 plus 0.14 times (1 - gain/10), scaled by the channel stage count, so it is strongest at low gain and nearly vanishes at gain 10; treble and presence act after the preamp and do not replace it.',
        ],
        [
            'Switching it on adds about 1 dB above 2 kHz at gain 5 and 1.3 dB at gain 2 on the clean channel, ahead of the distortion stages, which can make a harsh pickup brittle.',
        ],
        noExternalModulation
    ),
    fat: parameterGuidance(
        'Low-end fat switch',
        'Thickens the final tone by adding a low-passed copy of the amp output, a roughly +1.7 dB shelf below about 180 Hz.',
        0,
        0,
        [
            'Applied after the circuit or neural selection and before outputGain, so it works in every engine mode; it stacks with bass and resonance, which already shape the low end earlier in the chain.',
        ],
        [
            'It adds 22 percent of the 180 Hz low-passed signal, so the extra low energy reaches the limiter and can muddy a bass-heavy mix.',
        ],
        noExternalModulation
    ),
    bass: parameterGuidance(
        'Tone stack low band level',
        'Boosts or cuts the weight of the low end after the preamp.',
        3,
        7,
        [
            'Scales a low-pass branch whose corner, on the default tone stack type, sits at its 50 Hz floor up to about 4.4 and rises to 329 Hz at 10; the width of the mid band-pass follows the bass and treble difference.',
            'treble and mid share the same passive network, so one control changes how the other two respond.',
        ],
        [
            'The tone stack sits after the preamp, so turning bass up adds level but does not feed more low end into the distortion, which can make the amp sound boomy rather than heavy; bass 0 removes the low-pass branch entirely.',
        ],
        noExternalModulation
    ),
    mid: parameterGuidance(
        'Tone stack body band level',
        'Fills in or scoops the low-mid body between the bass and treble corners.',
        3,
        7,
        [
            'Scales a band-pass between the bass corner and the geometric mean of the bass and treble corners, about 55 to 190 Hz on defaults, and widens its Q as mid rises; bass and treble set where that band lies.',
        ],
        [
            'The stack insertion loss also depends on this value, 0.15 at 0 to 0.45 at 10 applied to all three branches, so turning mid down lowers the whole stack by up to about 9.5 dB and changes how hard the power amp is driven.',
        ],
        noExternalModulation
    ),
    treble: parameterGuidance(
        'Tone stack high band level',
        'Adds or removes bite and clarity by scaling everything above the treble corner.',
        3,
        7,
        [
            'Scales a high-pass branch whose corner, on the default tone stack type, sits at its 500 Hz floor up to about 3.6 and rises to 10.3 kHz at 10; presence acts later in the power amp feedback loop and bass and mid share the network.',
        ],
        [
            'Raising it adds high-passed content equal to treble/10 of the signal rather than a gentle shelf, so values above 7 on a high-gain channel emphasize pick noise and fizz that the cabinet then has to tame.',
        ],
        noExternalModulation
    ),
    presence: parameterGuidance(
        'Power amp high-frequency feedback release',
        'Opens up the top end and bite by letting the power amp feedback loop stop damping everything above about 180 Hz.',
        3,
        7,
        [
            'Cuts feedback above a 180 Hz split by up to 75 percent, scaled by negFeedback, and raises the post-clip damping corner by up to 180 Hz; at negFeedback 0 only the damping change remains.',
            'treble acts earlier in the chain, and master changes how hard the loop is driven.',
        ],
        [
            'Releasing the feedback above 180 Hz adds fizz and harshness on a high-gain, high-master setting that the cabinet then has to absorb, and with negFeedback near 0 only the damping-corner change is left.',
        ],
        noExternalModulation
    ),
    resonance: parameterGuidance(
        'Power amp low-frequency feedback release',
        'Adds thump and chest by letting the power amp feedback loop stop damping the low end below about 180 Hz.',
        3,
        7,
        [
            'Cuts feedback below the 180 Hz split by up to 75 percent, scaled by negFeedback, and adds up to 28 percent to the low hold in the post-clip damping; bass sets the earlier tone-stack low end.',
        ],
        [
            'High values with a loose negFeedback make the low end flub on fast palm-muted riffs, because feedback no longer damps the bottom between notes.',
        ],
        noExternalModulation
    ),
    master: parameterGuidance(
        'Power amp drive',
        'Sets how hard the power stage is pushed into its sagging, compressing breakup, which is feel more than loudness.',
        3,
        7,
        [
            'Drive into the power stage is 0.15 times at 0 and 2.0 times at 10, and the stage clips through tanh, so output rises only slowly (an EL34 stage peaks near 0.7 of full scale); sagAmount, negFeedback and powerAmpBias set how that clipping sags and feels.',
            'gain feeds it from the preamp.',
        ],
        [
            'It is not an output volume: raising it past about 7 mostly adds compression and sag, and level is trimmed with outputGain instead.',
        ],
        noExternalModulation
    ),
    sagAmount: parameterGuidance(
        'Power supply sag depth',
        'Makes the amp squash and bloom under loud playing as the supply voltage dips and recovers.',
        0.2,
        0.6,
        [
            'The value is scaled by the rectifier, 2.8 times for the default tube rectifier, and the rail is limited to a 70 percent drop; sagRecovery sets how long the dip lasts and master sets how hard it is driven.',
        ],
        [
            'High values on a high master collapse the headroom on every loud chord and the pumping follows playing dynamics, so a tight palm-muted riff can feel spongy.',
        ],
        noExternalModulation
    ),
    sagRecovery: parameterGuidance(
        'Power supply sag recovery time',
        'Sets how slowly the supply voltage returns after a loud hit, from instant snap to a slow breathing swell.',
        100,
        400,
        [
            'The value is multiplied by 1.75 for the default tube rectifier, so 200 ms recovers over about 350 ms; it only matters when sagAmount is above zero and master drives the stage.',
        ],
        [
            'Values over about 500 ms keep the rail depressed between phrases so level and attack breathe audibly, and below about 50 ms the rail returns almost at once, so sag reads as brief compression rather than breathing.',
        ],
        noExternalModulation
    ),
    negFeedback: parameterGuidance(
        'Power amp negative feedback amount',
        'Tightens and stiffens the power amp when high, and loosens it into a more raw, woolly voice when low.',
        0.3,
        0.7,
        [
            'Scales a feedback signal that presence and resonance shape in the high and low bands, and with it the post-clip damping; master and powerAmpBias set how hard the loop is driven.',
        ],
        [
            'Near 0 the loop no longer damps the power stage, and presence and resonance lose most of their effect, so the tone becomes loose and fizzy rather than simply brighter.',
        ],
        noExternalModulation
    ),
    transformerDrive: parameterGuidance(
        'Output transformer saturation drive',
        'Adds iron-style saturation whose loudness effect depends on how hard the power amp is driving it.',
        0.15,
        0.5,
        [
            'Below 0.01 the transformer is bypassed entirely and transformerHysteresis and transformerLfSaturation do nothing; above it drive scales the input boost (1 + 3 x drive) and the flux ceiling (0.5 + 1.5 x drive), subtracts drive times the low band and cuts the high band by 30 percent of drive, and the sum is divided by 1 + drive; outputGain is the level trim.',
        ],
        [
            'The level change from drive depends only on the level after inputGain, not on how that level is split between the source and inputGain; across the inputGain range, raising drive from 0.15 to 0.5 changes the output by anywhere from about 3 dB quieter to about 9 dB louder (220 Hz tone), and the change is not monotonic in that level, so the same move can add or remove level, so match level with outputGain from a measured preview rather than predicting the change; the soft limiter engages from about drive 0.4 for a 0.1-peak DI at 220 Hz with inputGain at 0 dB, and the onset moves non-monotonically with inputGain and input level, so more trim does not necessarily reach the limiter sooner.',
        ],
        noExternalModulation
    ),
    transformerHysteresis: parameterGuidance(
        'Output transformer magnetic memory',
        'Adds a lazy, smeared response by giving the transformer a dead zone and memory of its previous state.',
        0.1,
        0.5,
        [
            'Sets a coercive threshold of 0.3 times this value below which the flux does not respond and blends up to 50 percent of the previous flux state back in; it only acts while transformerDrive is above 0.01, and transformerLfSaturation sets the knee width.',
        ],
        [
            'Quiet notes whose driven level stays under the dead zone get no flux saturation and are carried by the high-band path alone, with the low band subtracted rather than saturated, so saturation jumps in as playing gets louder.',
        ],
        noExternalModulation
    ),
    transformerLfSaturation: parameterGuidance(
        'Output transformer low-end saturation',
        'Pushes low notes into harder saturation than the rest of the spectrum, thickening the bottom and sharpening the saturation knee.',
        0.1,
        0.5,
        [
            'Raises the gain into a 120 Hz low band by up to 5x and also narrows the saturation knee width from 1.0 to 0.2 for the whole flux path; it only acts while transformerDrive is above 0.01.',
            'transformerHysteresis shifts where the knee starts.',
        ],
        [
            'Values near 1 make the whole transformer clip hard, not only the lows, because the narrower knee applies to both flux paths, which changes pick attack as well as bass weight.',
        ],
        noExternalModulation
    ),
    cabResonanceFreq: parameterGuidance(
        'Speaker resonance frequency',
        'Places the low thump of the speaker model, from tight low-mid bounce to sub-heavy boom.',
        70,
        120,
        [
            'Tunes the resonant low-pass of the parametric speaker, active in the default cabinet mode where it follows the IR cabinet; cabResonanceQ sets how sharp the peak is and cabDamping how much of it is audible.',
        ],
        [
            'Dropping it toward 40 Hz with a high cabResonanceQ piles energy into the sub region that the output limiter and outputGain then have to absorb.',
        ],
        noExternalModulation
    ),
    cabResonanceQ: parameterGuidance(
        'Speaker resonance sharpness',
        'Sets how pronounced and ringing the speaker low-end bump is.',
        1,
        4,
        [
            'In the closed-back voicing the added boost is sqrt(1 + (0.5 x (1 - cabDamping) x Q)^2) at the resonance, about +1 dB at the defaults and +14 dB at Q 10 with cabDamping 0; cabResonanceFreq decides where it lands.',
        ],
        [
            'High Q with low cabDamping makes a narrow +14 dB bass peak that rings on every low note and drives the power amp through backEmf.',
        ],
        noExternalModulation
    ),
    cabDamping: parameterGuidance(
        'Speaker resonance damping',
        'Tames the speaker low-end bump, from full thump at 0 to none at 1.',
        0.3,
        0.7,
        [
            'Scales the closed-back resonance boost by (1 - damping), so at 1 neither cabResonanceFreq nor cabResonanceQ is audible and backEmf has nothing left to feed back.',
        ],
        [
            'It removes the resonance boost entirely at 1, leaving only the coneBreakup term in the closed-back speaker stage.',
        ],
        noExternalModulation
    ),
    coneBreakup: parameterGuidance(
        'Speaker cone breakup',
        'Adds grit and edge in the upper range as the speaker cone saturates.',
        0.1,
        0.5,
        [
            'Saturates everything above cabResonanceFreq by adding (tanh(x(1 + 3b)) - x) times b times 0.3, and is skipped at 0.01 or below; gain and master raise the signal that drives it.',
        ],
        [
            'It acts on the whole region above the resonance, not a narrow band, so high values add grit across the whole upper range instead of a narrow cone-edge band.',
        ],
        noExternalModulation
    ),
    backEmf: parameterGuidance(
        'Speaker back-EMF feedback',
        'Gives the power amp and speaker a loose, interacting feel by feeding some of the speaker bump back into the amp.',
        0.1,
        0.5,
        [
            'Scales the speaker resonance boost fed back into the power amp input at 0.1 times; cabResonanceQ and cabDamping set how large that boost is, and it is silent when cabDamping is 1.',
        ],
        [
            'It re-injects the speaker low-frequency boost into the power amp input, so a high value combined with high cabResonanceQ and low cabDamping feeds a large resonant peak back into the stage drive and changes its saturation, not only the cabinet tone.',
        ],
        noExternalModulation
    ),
    micBlend: parameterGuidance(
        'Microphone one and two blend',
        'Moves the cabinet tone from microphone one toward microphone two.',
        0,
        0,
        [
            'Crossfades the two cabinet microphone paths; microphone two is disabled by default and this descriptor has no switch for it, so only 0 is audible unless it is enabled in the Grinder panel; roomAmount is derived from the blended result.',
        ],
        [
            'With microphone two disabled, raising this fades the whole IR cabinet toward silence, and at 1 the cabinet path outputs nothing.',
        ],
        noExternalModulation
    ),
    roomAmount: parameterGuidance(
        'Cabinet room reflections',
        'Adds a hint of early reflections around the cabinet for space and distance.',
        0,
        0.4,
        [
            'Adds three reflections between 12 and 50 ms after the blended microphone signal and reduces the direct signal by up to 16 percent; micBlend determines which microphone feeds it.',
        ],
        [
            'The reflections are discrete taps, not a diffuse tail, so high values add comb filtering, and the room term stays about 13 dB below the direct signal even at 1 at the default microphone distance.',
        ],
        noExternalModulation
    ),
    tubeBias: parameterGuidance(
        'Preamp tube bias point',
        'Moves how hot or cold the preamp tube runs, from starved and gated to compressed and spitty.',
        0.4,
        0.6,
        [
            'Shifts the grid operating point by (value - 0.5) x 4 V, so 0.5 is neutral; gridConduction and gain decide how soon the signal reaches the conduction region that this shift moves.',
        ],
        [
            'Toward 0 the grid sits 2 V more negative and the stage approaches cutoff, so quiet notes and decays choke; toward 1 it sits at the conduction threshold, which compresses early and makes decays spitty.',
        ],
        noExternalModulation
    ),
    tubeAge: parameterGuidance(
        'Preamp tube wear',
        'Simulates a worn tube that loses gain and drifts in bias.',
        0,
        0.5,
        [
            'Cuts plate current by up to 15 percent and recomputes the quiescent plate voltage, so it moves the same operating point as tubeBias; gain compensates the lost level.',
        ],
        [
            'Changing it while notes sustain shifts the operating point and level, so automating it is audible as a drift and not a smooth tone control.',
        ],
        noExternalModulation
    ),
    millerCapacitance: parameterGuidance(
        'Preamp stage high-frequency roll-off',
        'Darkens the top end as a stage works harder, like a tube with more internal capacitance.',
        0.2,
        0.7,
        [
            'Sets a dynamic low-pass at 20 kHz / (1 + 2 x value x stage gain), with stage gain the plate-voltage drop as a fraction of the supply, so a stage at full conduction and value 1 reaches about 6.7 kHz; channel multiplies it across one, two or three stages.',
        ],
        [
            'On the lead channel at high gain three cascaded stages each darken as they saturate, so the top end loses sparkle in step with drive and compensating with treble or bright raises noise.',
        ],
        noExternalModulation
    ),
    gridConduction: parameterGuidance(
        'Preamp grid current behavior',
        'Sets how readily the tube grid conducts on loud peaks, giving blocking, sag and a spitting, compressed attack.',
        0.3,
        0.7,
        [
            'Lowers the grid-current onset from 0.22 V to 0.06 V above the cathode as it rises and raises the charge pushed into the coupling capacitor; couplingCapCharge sets how long that blocking lasts, and tubeBias moves where the onset sits against the signal.',
        ],
        [
            'High values make even moderate chords trigger blocking, which squashes the note start and can sputter if couplingCapCharge is also high.',
        ],
        noExternalModulation
    ),
    couplingCapCharge: parameterGuidance(
        'Preamp coupling capacitor recovery time',
        'Sets how quickly a blocked, squashed note recovers after a loud peak, from instant to a slow pulse.',
        0.2,
        0.7,
        [
            'Recovery time is 3 ms + 60 ms x value, so 33 ms at the default and 63 ms at 1; it only matters when gridConduction is high enough to charge the capacitor in the first place.',
        ],
        [
            'Near 1 the blocking from a loud chord lasts over 60 ms, and note onsets after it are audibly squashed; near 0 the effect disappears.',
        ],
        noExternalModulation
    ),
    powerAmpBias: parameterGuidance(
        'Power amp bias point',
        'Moves the power stage between cold crossover grit and hot, compressed, even-harmonic warmth.',
        0.4,
        0.7,
        [
            'Shifts the push-pull stage crossover dead zone between about 0.04 and 0.016 and its headroom by up to 10 percent; master sets how hard the stage is driven and negFeedback how much of the grit is damped.',
        ],
        [
            'Low values widen the crossover dead zone where the stage gain falls to 12 percent, so low-level notes and decays turn gritty or gated; high values lose that and compress sooner.',
        ],
        noExternalModulation
    ),
    engineMode: parameterGuidance(
        'Amp engine mode',
        'Chooses the circuit amp model (0), a neural capture (1) or a hybrid of both (2).',
        0,
        0,
        [
            'Capture and hybrid modes only change anything once a neural model is loaded, which this descriptor cannot do; neuralMix and neuralCpuBudget only act in those modes.',
        ],
        [
            'In capture mode the circuit preamp and tone stack are skipped, and with no model loaded the signal passes through unprocessed, so the amp tone disappears; in hybrid mode with no model the capture side is the raw input.',
        ],
        noExternalModulation
    ),
    neuralMix: parameterGuidance(
        'Neural capture blend',
        'Sets how much of a loaded neural capture replaces the circuit amp in hybrid mode.',
        0.3,
        1,
        [
            'Only acts in hybrid mode (engineMode 2) with a loaded model, blending circuit and capture or capture and rig output; it has no effect in circuit mode.',
        ],
        [
            'With no model loaded the capture side is the unprocessed input, so raising this fades the amp out toward the raw DI rather than adding a capture.',
        ],
        noExternalModulation
    ),
    neuralCpuBudget: parameterGuidance(
        'Neural capture CPU tier',
        'Chooses a lighter, a standard or a heavier capture, trading CPU for fidelity.',
        1,
        2,
        [
            'Selects the layer depth (Standard 6, 8 or 10; Lite 4, 6 or 6; Nano 3, 3 or 4) and scales the CPU estimate by 0.72, 1.0 or 1.12; it does nothing in circuit mode, so engineMode must be capture or hybrid.',
        ],
        [
            'Changing it re-arms a 40 ms warm-up crossfade whenever a model is active, so automating it produces audible crossfades.',
        ],
        noExternalModulation
    ),
    outputGain: parameterGuidance(
        'Wet output trim',
        'Trims the finished amp level to match the rest of the mix without changing the amp tone.',
        -6,
        6,
        [
            'Applied to the amp signal after the cabinet and fat voicing and before cleanBlend, outputMix and the limiter, so it does not scale the dry or clean copies; master and gain do change tone.',
        ],
        [
            'Raising it pushes the amp signal into the soft limiter, which starts rounding peaks at limiterThreshold, so level matched by ear can still hide limiter distortion.',
        ],
        noExternalModulation
    ),
    outputMix: parameterGuidance(
        'Amp wet and dry mix',
        'Blends the processed amp against the unprocessed input.',
        0.8,
        1,
        [
            'Dry comes from the untouched input and the wet signal is a mono sum; cleanBlend is applied to the wet path first, and limiterThreshold acts on the result.',
        ],
        [
            'The wet path carries 6.5 samples per stage (19.5 samples, about 0.4 ms at 48 kHz, on the default crunch channel and power stage) that the dry copy lacks, so partial mixes comb-filter the highs.',
        ],
        noExternalModulation
    ),
    cleanBlend: parameterGuidance(
        'Clean DI blend',
        'Brings back some of the clean input under the amp tone for definition, especially for bass or palm-muted lows.',
        0,
        0.3,
        ['Mixes the unprocessed input in before outputMix and before the limiter; outputGain does not scale it.'],
        [
            'The clean copy bypasses the cabinet, so higher values add raw, uncabbed input, and it has the same missing latency compensation as outputMix; at 1 the amp contributes nothing.',
        ],
        noExternalModulation
    ),
    limiterThreshold: parameterGuidance(
        'Output soft-limiter knee',
        'Sets the level above which the safety soft limiter starts rounding peaks.',
        -3,
        -0.3,
        [
            'Applied last, after outputGain, cleanBlend and outputMix, so it also bends the dry and clean copies; outputGain raises the level that reaches it.',
        ],
        [
            'It is a soft knee, not a ceiling: peaks asymptotically approach full scale, so lowering the threshold does not stop signals reaching 0 dBFS and a -12 dB knee soft-clips everything above 0.25 amplitude.',
        ],
        noExternalModulation
    ),
};
