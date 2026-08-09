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

| Kind | Carries | Use it for |
|---|---|---|
| **Audio** | Recorded or imported sound | Vocals, guitars, samples, stems |
| **MIDI** | Notes and controller data | Anything played by an instrument device |
| **Bus** | No material of its own | Grouping several tracks under one fader and one device chain |
| **Folder** | No material of its own | Tidying the track list without changing the signal path |
| **Master** | The final mix | The last stage before export |

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
> **Not yet active.** Undo does not yet cover the mixer, and its coverage of devices is uneven.
> Moving a fader or a pan control, and adding or removing a device by hand, apply immediately and
> are not recorded — undo will skip straight past them to the last material edit.
>
> Whether a device records anything is decided device by device, so the device page is the
> authority where there is one. Gluten is the furthest along: a settled control move is one undo
> step, while loading a preset or pressing a Quick move is not recorded at all. Grinder records
> nothing you do by hand — knobs, presets, and snapshot recalls alike. The reverb records a loaded
> space as one grouped step, so a single press of undo restores the whole space.
>
> What undo restores is the project and the sound, not the panel. Every device draws its controls
> from its own session state, and undo does not write back into it — so after undoing a device
> change the control keeps showing the value you set until you close the device and open it again.
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

The three are not yet equivalent, and the difference shows up in undo. What the assistant does is
recorded as a matter of course, because everything it performs runs through the recorded path. Doing
the same thing by hand is patchier: editing clips and notes is recorded, and so are a few controls
that were wired up individually — arming a track, changing the tempo — but most of the mixer and most
device work is not.

The list of operations that split this way is long and still moving, so treat it as a rule rather
than something to memorise: if it is not a clip or note edit, assume your own hand does not record it.
Track gain and pan, mute, solo, rename, track colour, deleting a track, adding or removing a device,
and device parameters on the devices that do not record their own controls all behave this way — one
undo step from the assistant, nothing at all from you. Until that evens out, ask the assistant for a
change you may want to walk back.

## Where sound actually comes out

Audio reaches your ears through an output device you choose. Recording needs an input, an armed
track, and a monitoring decision. Some processing introduces **latency** — a small, reported delay —
and playback compensates for it so tracks stay aligned.

## See also

- [Gluten](./devices/07-gluten.md) — a worked example of a device page
- [Manual index](./README.md) — every chapter and device page
