# Concepts

Sourdaw arranges a handful of ideas differently from most audio software, and every other chapter
assumes them. Read this once and the rest of the manual will make sense in the order you need it.

## One window, several surfaces

Sourdaw does not have pages you navigate between. There is a single workspace, and everything else
is a panel you show or hide inside it. Nothing is ever "somewhere else" — it is either visible or
toggled off, and the same project is underneath all of it.

The centre of the workspace is the **arrangement**: tracks run down the left, time runs left to
right, and clips sit on the grid. This is where a song is assembled, and it stays there.

Everything else lives in the dock along the bottom, one tab at a time:

- **Editor** — the inside of one clip. Notes, audio waveform, pitch, and that clip's own automation.
- **Automation** — parameter movements across the arrangement.
- **Mixer** — faders, sends, and device chains for every track at once.
- **Session** — clips that launch on demand rather than at a fixed time. Use it to try arrangements
  before committing them to the timeline. It can also sit beside the arrangement instead of in the
  dock.
- **Routing**, **Analysis**, **Setlist**, **Loop Station**, and **Modulation** — covered in their own
  chapters.
- **Elastic** — appears only while an audio clip is selected.

Switching tabs never changes what is playing or what is recorded. They are views onto one project.

## Tracks

A track is a lane that carries one kind of material and one signal path. Five kinds exist:

| Kind       | Carries                    | Use it for                                                   |
| ---------- | -------------------------- | ------------------------------------------------------------ |
| **Audio**  | Recorded or imported sound | Vocals, guitars, samples, stems                              |
| **MIDI**   | Notes and controller data  | Anything played by an instrument device                      |
| **Bus**    | No material of its own     | Grouping several tracks under one fader and one device chain |
| **Folder** | No material of its own     | Tidying the track list without changing the signal path      |
| **Master** | The final mix              | The last stage before export                                 |

The distinction that matters: a **bus** changes the audio path — everything fed into it is summed
and processed together. A **folder** changes only the view. Collapsing a folder hides tracks; it does
not combine them.

## Clips

A clip is a container for material, positioned in time. Audio clips hold sound; MIDI clips hold
notes. Clips can be trimmed, faded, looped, split, and moved without altering the material they
point at — trimming a clip does not shorten the underlying recording, and you can always drag the
edge back out.

Because clips reference material rather than own it, duplicating a clip is cheap and reversible.

## Time and the grid

Position is expressed in bars and beats, driven by the project tempo and time signature. The **grid**
is the set of divisions that edits snap to. A coarse grid keeps a part locked to the bar; a fine
grid or no grid lets you place material freely.

Two ideas ride on top of it. **Markers** name a position. **Sections** name a span — a verse, a
chorus — and give you something to jump between and reorder.

## Devices and the device chain

A device processes sound or notes. Every track has a **device chain**: an ordered list, running top
to bottom, where each device receives what the one above it produced. Order is not cosmetic — a
compressor before a reverb behaves very differently from the same compressor after it.

Three kinds:

- **Instruments** turn notes into sound. A MIDI track needs one to be audible.
- **Audio effects** change sound that already exists.
- **MIDI effects** change notes before they reach the instrument.

Devices come from two places: the built-in devices documented in this manual, and — in the desktop
app only — VST, AU, and CLAP plugins you already own. In a browser the plugin browser is present but
disabled.

## Parameters and automation

Every knob, slider, and switch on a device is a **parameter** with a range, a unit, and a default.
Most parameters can be **automated** — given a value that changes over time, drawn as a line in an
automation lane. A few discrete switches cannot: algorithm and filter-shape selectors, and metering
mode. Those are absent from the parameter list when you go to assign a lane, which is how you tell.

Automation belongs to the track, not the device, so it survives while you audition alternatives. A
parameter under automation follows the line rather than the knob; the knob shows you where the line
currently is.

## Undo, and what it covers

Undo walks back through a stack of recorded steps. Editing material writes steps to it: move,
resize, split, or delete notes and clips, and each gesture goes on the stack as one entry, however
many notes it touched.

> [!WARNING]
> **Not yet active.** Undo's coverage of the mixer is now split down the middle, and its coverage of
> devices is uneven. The channel strip's level controls record: riding a fader or a pan control goes
> on the stack as one step per gesture rather than one per twitch, and removing a channel puts the
> track back with its clips and its devices. Its buttons do not, on purpose — muting, soloing and
> solo-safing a channel are things you do _while_ listening, dozens of times a pass, and the history
> is shared with everyone in the session, so those toggles are left out of it rather than spending
> your collaborators' history on them. They still apply, save, and sync like anything else; they are
> simply not something ⌘Z walks back. The device chain below the strip is not covered at all: adding
> or removing a device by hand applies immediately and is not recorded, so undo will skip straight
> past it to the last recorded step. Seeing a strip move in the history panel is not a sign that
> everything on the same strip is covered.
>
> Two things about the strip are worth knowing before you rely on them. Because a fader move is now
> recorded as one step taken at the end of the gesture, someone else in the session no longer watches
> your fader travel — for them it jumps to its final position when you let go. And undo restores
> **your** view of the project: if a collaborator changed the same track while your change was in
> flight, undoing yours can take their work with it, and deleting a track can lose a clip they added
> to it in the same moment. Take a branch before anything you would be unhappy to lose in a shared
> session.
>
> Device history is decided by the control surface you use, not merely by the device. The table
> below is the complete authority for direct changes in the built-in device panels today. A
> generic parameter control in the Inspector applies and saves its value but does not add an undo
> entry unless the table names that change explicitly.
>
> | Device          | Direct changes that add undo entries                                                                                         |
> | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
> | **Bacteria**    | None of its panel controls.                                                                                                  |
> | **Crumbs**      | Parameter gestures after release. Sample and operating-mode changes save and sync but are not undoable.                      |
> | **Crust**       | None of its panel controls.                                                                                                  |
> | **CvGate**      | None of its panel controls.                                                                                                  |
> | **Fermenter**   | None of its panel controls.                                                                                                  |
> | **Gluten**      | Individual control gestures after release. Preset loads and Quick moves are not recorded.                                    |
> | **Grand Boule** | Master gain, soundboard send, sympathetic send, lid position, and mic position. Other panel controls are not recorded.       |
> | **Grinder**     | None: knobs, presets, imported models, and snapshot recalls are not recorded.                                                |
> | **Knead**       | Committing a pitch edit records the clip edit; its device controls are not recorded.                                         |
> | **Levain**      | None. Instrument and articulation selections save and sync but are not undoable.                                             |
> | **Proof**       | None of its panel controls.                                                                                                  |
> | **Dutch Oven**  | Individual controls and algorithms; loading a Space creates grouped parameter entries that undo together.                    |
> | **Toaster**     | None. Kit changes save and sync but are not undoable.                                                                        |
> | **Tuner**       | A completed Concert A reference gesture.                                                                                     |
> | **Yeast**       | Selecting, creating, renaming, or deleting a groove template, plus Groove Amount; other processor controls are not recorded. |
>
> A recorded device entry restores project truth, the running sound, and the mounted controls that
> expose that value. Where the table describes a gesture after release, the movement you hear while
> dragging is only a preview and the release creates the single entry.
>
> Save a preset or duplicate the track before you experiment with a device.

A **branch** is the durable way to try something. It takes the project in two directions so you can
compare them, rather than choosing blindly and hoping undo is deep enough. Branches cover everything,
including the changes undo does not see. Open the Branch Manager from the command list to fork,
switch, merge, and delete them.

## Three ways to drive it

Most operations are available three ways:

1. **Direct manipulation** — dragging, clicking, and typing in the interface.
2. **Commands** — a searchable list of actions, reachable from the keyboard, plus shortcuts you can
   remap in Preferences.
3. **Natural language** — describing what you want to the assistant, from the prompt bar in the
   transport or the chat panel.

The three are not yet equivalent, and the difference shows up in undo. What decides whether a change
is recorded is the surface you touched, not who asked for it. The command list and the assistant
record most of what they do, and direct manipulation is the uneven one — but _most_ is the honest
word for all three. Some operations are not recorded from any route at all: importing a MIDI or
audio file, converting audio to MIDI, detecting song structure, clearing MIDI mappings, and the
assistant's automatic mix fix are unrecorded however you reach them.

Recorded when you do it by hand today: editing clips and notes, arming a track, tempo and time
signature, the channel strip's level and pan, deleting a track from wherever you delete it — the
timeline, the track list, or the mixer — adjustment layers, the chord track, and track alternatives.
Not recorded: adding or removing a device, macros, device parameters on the devices that do not
record their own controls, and mute and solo — from the strip because they are performance rather
than editing, and from the track header because that surface has not been converted at all. The
assistant and the command list still record a mute they issue: what you are doing decides it, not
only where.

**Every list on this page is what we know of, not the whole map** — including the claim that the
command list and the assistant record. The split is decided one operation at a time, the same
gesture can land on either side depending on where you performed it, and the lists move as
operations are converted. Routing a change through the command list or the assistant improves the
odds it is recorded; it does not guarantee it. When a change genuinely must be reversible, take a
branch first — branches cover everything, including what undo cannot see.

## Where sound actually comes out

Audio reaches your ears through an output device you choose. Recording needs an input, an armed
track, and a monitoring decision. Some processing introduces **latency** — a small, reported delay —
and playback compensates for it so tracks stay aligned.

## See also

- [Gluten](./devices/07-gluten.md) — a worked example of a device page
- [Manual index](./README.md) — every chapter and device page
