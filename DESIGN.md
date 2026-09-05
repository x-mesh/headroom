---
name: Rack Mesh
description: A daylight telemetry console for topology constraints and failure effects.
colors:
  ground: "#e7f0ea"
  surface: "#f7faf7"
  surface-raised: "#ffffff"
  surface-tint: "#dceae2"
  panel-deep: "#16332d"
  panel-mid: "#20483f"
  panel-line: "#365a50"
  on-deep: "#f4fbf7"
  on-deep-muted: "#dceae2"
  on-deep-line: "#628279"
  danger-soft: "#ff9c94"
  canvas: "#eaf2ed"
  line: "#9eb9ad"
  line-soft: "#c9d9d1"
  text: "#13241f"
  muted: "#526e64"
  signal: "#b8e737"
  signal-deep: "#587d00"
  amber: "#b66b00"
  danger: "#c9473f"
  unknown: "#697286"
  cyan: "#087d70"
  action-ink: "#173028"
typography:
  display:
    fontFamily: "Avenir Next, Avenir, Segoe UI, sans-serif"
    fontSize: "clamp(20px, 2vw, 31px)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Avenir Next, Avenir, Segoe UI, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Avenir Next, Avenir, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.55
  data:
    fontFamily: "SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1
  label:
    fontFamily: "SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "9px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.13em"
rounded:
  square: "0"
spacing:
  compact: "8px"
  control: "14px"
  panel: "18px"
  shell: "22px"
components:
  button-solid:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.action-ink}"
    typography: "{typography.data}"
    rounded: "{rounded.square}"
    padding: "0 15px"
    height: "40px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.on-deep}"
    typography: "{typography.data}"
    rounded: "{rounded.square}"
    padding: "0 15px"
    height: "40px"
  editor-tool-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "0 11px"
    height: "36px"
  editor-field:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "0 10px"
    height: "40px"
  failure-switch:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.data}"
    rounded: "{rounded.square}"
    padding: "9px 18px"
    height: "52px"
  topology-node:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    typography: "{typography.data}"
    rounded: "{rounded.square}"
    width: "126px"
  status-badge:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "7px 8px"
  summary-metric:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.data}"
    rounded: "{rounded.square}"
    padding: "15px 22px"
    height: "106px"
  mobile-failure-tray:
    backgroundColor: "{colors.panel-deep}"
    textColor: "{colors.on-deep}"
    typography: "{typography.data}"
    rounded: "{rounded.square}"
    padding: "10px 14px"
---

# Design System: Rack Mesh

## Overview

**Creative North Star: "The Daylight Telemetry Console"**

Rack Mesh uses a pale sage work surface and a deep green control frame. Device symbols and their axis labels sit directly on the tinted canvas.

The interface treats telemetry motion as a presentation layer. Deterministic scenario results remain the source for state, comparison, and export.

A compact toolbar and inline task panel extend the console into a topology editor. Keep edits in the daylight workspace.

**Key Characteristics:**

- Light sage ground, quiet surfaces, and borderless device symbols on a tinted canvas.
- Deep green top and mobile control bars.
- Square controls, thin rules, and compact data typography.
- Four summary sparklines and status-aware topology motion.
- An editor toolbar, inline forms, and inspector-based resource edit forms.
- Text, shape, and line patterns that support each semantic color.

## Colors

The palette separates a calm daylight workspace from a deep operational frame. Semantic colors report capacity and fault states.

### Primary

- **Signal Lime** (#b8e737): Use for primary actions, focus outlines, the stable run state, and the brand mark.
- **Deep Signal Green** (#587d00): Use for decisive values, section codes, packet dots, and positive comparison values.

### Secondary

- **Capacity Cyan** (#087d70): Use for healthy resources, active links, live telemetry, and the first sparkline.
- **Constraint Amber** (#b66b00): Use for caution states and the second sparkline.
- **Fault Red** (#c9473f): Use for overloads, failures, negative changes, and the third sparkline.
- **Unknown Slate** (#697286): Use when a capacity limit is not known.

### Neutral

- **Sage Ground** (#e7f0ea): Use for the page ground.
- **Quiet Surface** (#f7faf7): Use for control panels, summary cells, and inspectors.
- **White Raised Surface** (#ffffff): Use for small markers and symbol highlights.
- **Sage Surface Tint** (#dceae2): Use for topology and comparison regions.
- **Deep Forest Panel** (#16332d): Use for the top bar, toast, and mobile failure tray.
- **Canvas Sage** (#eaf2ed): Use for the fixed topology canvas and its label masks.
- **Forest Text** (#13241f): Use for primary text on light surfaces.
- **Muted Sage Text** (#526e64): Use for notes, labels, and metadata.

### Named Rules

**The Daylight Hierarchy Rule.** Keep work surfaces pale. Reserve deep forest for global control and compact mobile action.

**The Signal Economy Rule.** Reserve signal lime for action, focus, stable state, and selected key values.

**The Red Means Impact Rule.** Use fault red only for failures, overloads, and negative changes.

## Typography

**Display Font:** Avenir Next with Avenir and Segoe UI fallbacks.

**Body Font:** Avenir Next with Avenir and Segoe UI fallbacks.

**Label/Mono Font:** SFMono-Regular with Menlo and Consolas fallbacks.

**Character:** The UI stack keeps Korean copy clear. The monospace stack gives metrics, states, resource names, and section codes an operational rhythm.

### Hierarchy

- **Display** (600, fluid 20px to 31px, 1.2): Use for the topology question.
- **Title** (600, 17px, 1.2): Use for panels, the brand, and comparison titles.
- **Body** (400, 11px, 1.55): Use for notes, source conditions, and scenario context.
- **Data** (600, 10px, 1): Use for metrics, states, resource data, and compact controls.
- **Label** (600, 9px, 0.13em): Use uppercase text for section codes and zone labels.

### Named Rules

**The Data Voice Rule.** Use monospace text for values, machine states, identifiers, and operational labels.

## Layout

The desktop shell stacks the top bar, control deck, editor toolbar, optional editor panel, summary strip, workspace, and comparison panel.

The main workspace uses 250px, a flexible center of at least 680px, and 330px columns.

At 1180px, use 230px and a flexible center of at least 650px. Place the inspector below in four columns.

At 1180px, place editor forms in three columns. Keep demand rows in four columns with internal horizontal scroll.

At 760px, use one vertical flow and a two-column summary. Place topology before failures and the inspector.

At 760px, place editor forms and demand rows in two columns. Keep each form action row across the full width.

Keep the topology canvas at 940px by 580px. On mobile, cap its viewport at 500px and provide horizontal pan access.

Give the mobile editor toolbar its own horizontal scroll. Preserve the separate pan region inside the topology viewport.

Keep the mobile failure tray sticky at the top. Keep its deep green surface above the light workspace.

Use the observed space rhythm: 8px for compact gaps, 14px for mobile controls, 18px for panels, and 22px for shell edges.

## Elevation & Depth

The system uses tonal layers, one-pixel borders, and limited shadows. White nodes lift from the sage canvas without a card-heavy page.

### Shadow Vocabulary

- **Status Glow** (`0 2px 10px currentColor`): Mark the current scenario state in the top bar.
- **Live Glow** (`0 2px 9px color-mix(in srgb, var(--cyan) 65%, transparent)`): Mark the live telemetry indicator.
- **Node Rest** (`0 8px 22px color-mix(in srgb, var(--panel-deep) 15%, transparent)`): Separate white nodes from the canvas.
- **Node State Glow** (`0 8px 26px color-mix(in srgb, var(--node-color) 18%, transparent)`): Mark hover and selection.
- **Sticky Tray** (`0 8px 22px color-mix(in srgb, var(--panel-deep) 24%, transparent)`): Separate the mobile tray from content.
- **Toast Lift** (`0 10px 30px color-mix(in srgb, var(--panel-deep) 24%, transparent)`): Lift transient result feedback.

### Named Rules

**The Structural Depth Rule.** Use surface tone and borders before shadow.

## Shapes

The system uses square geometry. Buttons, badges, nodes, panels, meters, switches, and toast feedback have no corner radius.

Use one-pixel borders for structure. Use dashed borders for disabled nodes and a 7 7 dash pattern for disabled links.

Use three-pixel status rails under node symbols. Use seven-pixel axis meters for clear load comparison.

## Components

### Buttons

- **Shape:** Use square corners and a minimum height of 40px.
- **Primary:** Use signal lime, dark action text, and 15px horizontal padding.
- **Text:** Use a transparent surface and a visible border on the deep top bar.
- **Hover / Focus:** Shift the border or surface. Use a 2px signal focus outline with a 3px offset.

### Editor Toolbar and Inline Panel

- **Toolbar:** Use a 54px white deck with compact square buttons, six-pixel gaps, and a visible tool separator.
- **Actions:** Expose new, add device, connect, manage demand, save, open, and import actions.
- **Mode:** Show select or connect state with text and a seven-pixel indicator. Update `aria-pressed` for connect mode.
- **Panel:** Open the task panel directly below the toolbar. Do not use an HTML modal or overlay.
- **Fields:** Use 40px white fields with one-pixel borders. Use 36px fields inside dense demand and inspector rows.
- **Primary Action:** Use signal lime for create, update, and add demand actions.

### Traffic Demand Manager

- **List:** Show one bordered row for each demand. Keep endpoints, bps, pps, CPS, and sessions editable.
- **State:** Replace explicit paths with calculated shortest ECMP paths after endpoint or load changes.
- **Empty:** Show an inline empty state and a clear action to create the first demand.
- **Errors:** Keep validation errors inside the related row. Do not clear valid field values.

### Resource Inspector Editor

- **Device:** Edit the name, zone, and independent capacity limits below the device telemetry.
- **Link:** Edit directional capacity below the link telemetry.
- **Empty:** If the topology has no devices, explain how to add or import the first device.
- **Delete:** Keep resource deletion beside the apply action. Use fault red for the delete label.

### Top Bar and Live State

- **Frame:** Use the deep forest surface, light text, and a 72px minimum height.
- **Run State:** Pair an 8px lamp with visible state text. Use lime, amber, or red for state.
- **Live State:** Pair a cyan 7px indicator with `LIVE · SYNTHETIC TELEMETRY`.
- **Motion:** Use a 1.8s alternate breath with the standard motion curve.

### Summary Metrics and Sparklines

- **Structure:** Present four equal summary cells. Keep 28 recent samples in each SVG sparkline.
- **Series:** Show headroom, maximum utilization, delivery, and total traffic.
- **Color:** Use cyan, amber, red, and deep signal green in that order.
- **Telemetry:** Add about ±1–2% synthetic variation to the presentation layer. Keep scenario values unchanged.
- **Cadence:** Refresh visible motion every 820ms. Pause refresh work while the document is hidden.

### Design Board Tabs

- **Tabs:** Split the left board into a component tab and a failure tab. Keep the component tab first and open by default, because building comes before breaking.
- **Shape:** Use a two-pixel underline on the open tab. Use no corner radius and no filled tab body.
- **Badge:** Show the active-fault count only on the failure tab. Hide it on the component tab.
- **Keyboard:** Move between tabs with the arrow keys, Home, and End. Keep only the open tab in the tab order.

### Component Palette

- **Grid:** Show one cell for each device class in a two-column grid. Separate cells with one-pixel lines, not gaps.
- **Cell:** Stack the class symbol, a Korean name, and the class code. Use the grab cursor.
- **Drag:** Drag a cell onto the canvas to place a device. Show a ghost symbol under the pointer and outline the canvas as a drop target.
- **Click:** A click places the device in the first free grid slot. Keep this path working on touch.
- **New Device:** Give the device the axes its class uses and leave every limit unknown. Select it so the inspector opens for the limits.

### Failure Switch

- **Shape:** Use a 52px minimum height and 9px by 18px padding.
- **State:** Show UP or DOWN text and update `aria-pressed`.
- **Active:** Use a red inner square, red border, and red DOWN text.

### Canvas

- **Minimum:** Start at 940 by 580. A layout that fits keeps that size.
- **Growth:** Grow the canvas toward any device placed outside it. Add 40px of slack in the direction that grows.
- **Origin:** Let device coordinates go negative. Move the canvas origin instead of clamping the device.
- **World Position:** Keep the grid and the zone labels fixed to world coordinates, not to the canvas edge.
- **Cap:** Stop growing at 12000px so an imported file cannot ask for a canvas the browser cannot paint.

### Topology Node and Link

- **Node:** Stack a 112 by 44 device symbol over a label block in a 126px column. Use no card border, no card surface, and no shadow.
- **Anchor:** Keep the device position at the center of the symbol box. Offset the node by half the symbol height, never by half the node height.
- **Symbol:** Draw one inline sprite symbol for each device. Map the device class to a symbol and fall back to the rack symbol. Paint the symbol with text color, never with state color. Shape carries the class. Color and token carry the state.
- **Symbol Fill:** Fill the symbol with the canvas color. Links stop at the shape edge.
- **State Rail:** Put a three-pixel state rail under the symbol. Hatch it for overload. Dash it for unknown and offline.
- **Axis Rows:** Show one monospace row for each configured axis: state token, four-character axis name, compact load, and utilization. Show at most four rows and count the rest in the meta line.
- **State Token:** Pair each state color with its token. Use a period for healthy, an exclamation mark for warning, a greater-than sign for overload, a question mark for unknown, and the letter x for invalid.
- **Compact Load:** Drop the unit from the node value. The axis name carries the unit. Keep the unit in the inspector.
- **Unknown Axis:** Print the measured load and an em dash. Never print zero percent for an unknown limit.
- **Binding Axis:** Give the binding axis row full-strength label text. Keep the other axis labels muted.
- **Name and Meta:** Show the device name in 11px data type. Show the class and the zone in 8px label type. Clip overflow.
- **Selected:** Use a two-pixel state-color outline. Do not change the layout.
- **Drag:** Use the grab cursor and stronger saturation while a node moves.
- **Connect:** Enter a two-node mode. Outline the source and prompt for the target before link creation.
- **Disabled Node:** Reduce opacity, mute the symbol, dash the rail, and show OFFLINE and DOWN.
- **Accessible Name:** Give the node one label that starts with the device name and states class, zone, state, and binding axis. Keep synthetic telemetry out of that label.
- **Active Link:** Use a solid semantic stroke and one to three SVG packet dots.
- **Packet Speed:** Reduce duration as utilization rises. Use 3.4s as the base and 1.25s as the minimum.
- **Unknown Link:** Use a slate stroke with a 5 4 dash pattern. A link with no known capacity must never read as healthy.
- **Invalid Link:** Use a red stroke with a tight 2 3 dash pattern. Keep it distinct from the 7 7 pattern that marks a disabled link.
- **Disabled Link:** Use a red dashed stroke, hide packet dots, and show DOWN.

### Axis Meter

- **Track:** Use a seven-pixel sage track.
- **Fill:** Use cyan for healthy, amber for warning, red for overload and invalid, and slate for unknown.
- **Labels:** Show axis name, status, utilization, load, and limit as text.
- **Overload:** Add a diagonal red pattern to the track.
- **Invalid:** A bad limit leaves the bar empty, so mark the track itself. Add a tight diagonal red pattern and keep it finer than the overload pattern.

### Project and Device Files

- **Save:** Download a versioned Rack Mesh project as JSON. Preserve topology, scenario scale, faults, and selection.
- **Open:** Validate the schema before replacement. Confirm the impact on the current design and the loaded design before replacement.
- **Import:** Accept Rack Mesh performance, Rack Mesh device, and NetBox device type JSON. Open the result in the device form.
- **Safety:** Limit files to 2 MB. Validate structured data and escape imported text before HTML insertion.

### Errors, Empty States, and Confirmation

- **Form Error:** Show validation text in fault red below the related form.
- **File Error:** Use the status toast for parse, schema, and import errors.
- **Empty Inspector:** Center a short explanation and the next available actions.
- **Destructive Action:** Use native confirmation for new design, delete, and project replacement actions. State the affected resources.

### Mobile Failure Tray

- **Position:** Keep it sticky at the top of the mobile flow.
- **Surface:** Use deep forest, light text, and a structural shadow.
- **Controls:** Expose FW A, FW B, and a link to the full list.
- **State:** Show UP or DOWN and update `aria-pressed`.

### Reduced Motion

- **Preference:** If reduced motion is active, hide packet dots and stop visible telemetry variation.
- **Indicator:** Keep the live label visible without perceptible motion.
- **Transitions:** Set motion duration to 0.01ms and restore automatic scroll behavior.
- **Cadence:** Reduce telemetry refresh to 2400ms. Preserve flat sparkline history and exact scenario values.

## Do's and Don'ts

### Do:

- **Do** keep the light sage workspace and deep green control frame.
- **Do** draw topology nodes as a device symbol over a label stack.
- **Do** label all synthetic telemetry as synthetic.
- **Do** keep presentation variation separate from deterministic scenario results.
- **Do** pair each status color with text, shape, or a line pattern.
- **Do** preserve the fixed topology canvas and mobile pan access.
- **Do** keep the mobile toolbar scroll separate from topology pan.
- **Do** keep editor tasks inline below the toolbar.
- **Do** validate project and import data before state replacement.
- **Do** escape imported or project text before HTML insertion.
- **Do** confirm each destructive action with its affected resources.
- **Do** honor reduced motion for packet dots, telemetry variation, transitions, and scroll behavior.

### Don't:

- **Don't** reduce bps, pps, CPS, sessions, power, or rack space to one health score.
- **Don't** convert unknown capacity data to a healthy state.
- **Don't** let synthetic telemetry change comparison or export values.
- **Don't** show packet dots on disabled links.
- **Don't** shrink the topology canvas to fit a mobile viewport.
- **Don't** place editor tasks in HTML modals or overlays.
- **Don't** replace the current project before validation and confirmation.
- **Don't** hide form errors in a global status message.
- **Don't** encode capacity or failure state with color alone.
