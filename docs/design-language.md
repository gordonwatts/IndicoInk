# IndicoInk Design Language

## 1. Principles

### Calm by default

Show the minimum information required for the current decision. Reveal
secondary metadata after selection. Prefer whitespace, alignment, and typography over containers and decoration.

### Spatially coherent

Schedules should preserve the relationship between time and simultaneous sessions. Avoid nested or competing scroll regions when one continuous surface can express the content.

### Touch and pen first, mouse complete

Every primary workflow must work without a keyboard. Touch targets are generous and controls remain understandable with mouse and keyboard. Pen behavior is explicit and never confused with finger scrolling.

### Native Windows character

Use Windows 11 Fluent conventions while implementing them with web technology. The app should feel at home beside modern Windows applications without trying to imitate every native visual effect.

### Status is explicit

Use concise labels with icons for important states. Do not require the user to decode color or an unfamiliar icon.

## 2. Visual Foundation

### 2.1 Typography

Use `Segoe UI Variable`, falling back to `Segoe UI`, system UI, and sans-serif.

| Role | Suggested size | Weight |
| --- | ---: | ---: |
| Display/event title | 28-32 px | 600 |
| Page title | 24 px | 600 |
| Section/session title | 18-20 px | 600 |
| Talk title | 16 px | 600 |
| Body/control text | 14-16 px | 400-500 |
| Supporting metadata | 12-13 px | 400 |

Talk titles may wrap to two lines. Avoid truncating titles to one line when a
second line would preserve meaning without harming scanability.

### 2.2 Spacing

Use a 4 px base grid.

| Token | Value | Typical use |
| --- | ---: | --- |
| `space-1` | 4 px | Icon/text adjustment |
| `space-2` | 8 px | Tight internal spacing |
| `space-3` | 12 px | Related control spacing |
| `space-4` | 16 px | Standard component padding |
| `space-5` | 20 px | Comfortable row padding |
| `space-6` | 24 px | Section spacing |
| `space-8` | 32 px | Major grouping |

Prefer fewer, larger groups over many tightly packed groups.

### 2.3 Shape and Elevation

* Small controls: 4-6 px corner radius.
* Inputs, buttons, and rows: 6-8 px corner radius.
* Dialogs, panes, and large surfaces: 10-12 px corner radius.
* Pills are reserved for filters, counts, and compact status values.

Use elevation sparingly. Most grouping should use spacing, alignment, subtle
surface tint, or a divider. Do not place cards inside cards.

### 2.4 Color

Use system-aware light and dark themes. The default visual direction is a cool
neutral base with a restrained Windows-blue accent.

Define semantic tokens rather than using raw colors in components:

* `surface-base`
* `surface-subtle`
* `surface-raised`
* `text-primary`
* `text-secondary`
* `border-subtle`
* `accent`
* `accent-hover`
* `focus-ring`
* `status-success`
* `status-warning`
* `status-error`

Color may reinforce a state but must not be its only signal.

## 3. Layout

### 3.1 Application Frame

The standard frame consists of:

* A compact navigation rail.
* A top command bar.
* A page-specific content surface.

The navigation rail is expanded only when space and context justify labels. It
collapses to icons on narrow screens. Navigation icons always have tooltips and
accessible names.

### 3.2 Content Density

Default to comfortable density. A normal talk row should have at least 12 px
vertical padding and a minimum interactive height of 48 px. Rows containing
two-line titles may grow naturally.

Avoid showing data merely because it is available. The default agenda row does
not need contribution IDs, descriptions, full material lists, or repeated room
names.

### 3.3 Responsive Breakpoints

Breakpoints are behavioral guides rather than device labels:

* **Wide**: `>= 1200 px`; side panes and approximately three agenda columns.
* **Medium**: `800-1199 px`; icon rail, approximately two agenda columns.
* **Narrow**: `< 800 px`; one primary content column, overlays or bottom sheets.

Also respond to orientation. A portrait screen may be tall but should still use
the narrow agenda treatment.

## 4. Components

### 4.1 Command Bar

Place page-level navigation and actions in the command bar. Keep the primary
action visible as a labeled button. Move secondary actions into overflow when
space is limited.

Do not allow the command bar to become a second metadata row.

### 4.2 Day Strip

The day strip is a segmented control with clear selected state and
previous/next-day buttons. Day labels include weekday and date. It changes the
day canvas without changing event-level search or filters.

### 4.3 Filter Control

Use a compact segmented control or filter menu for mutually exclusive agenda
views. Keep the common filters visible:

* All.
* Bookmarked.
* Annotated.
* Slides available.

### 4.4 Session Block

A session block represents a scheduled session during a specific time range.
Its header contains title, time range, and location. It owns its talk rows.

Session blocks are positioned on the agenda canvas according to time and
concurrency. They do not imply permanent tracks that last all day.

### 4.5 Talk Row

A talk row is a single large target. The full row selects the talk. Embedded
actions such as Bookmark must remain independently operable.

Default contents:

* Time.
* Title.
* Speaker.
* Bookmark.
* Material state.
* Annotated-slide count.

Selected, hovered, pressed, and focused states must be distinct.

### 4.6 Material State

Material state always combines an icon with text:

* `No slides`
* `PDF`
* `2 PDFs`, `3 PDFs`, and so on

Do not use a generic attachment icon without a label. Non-PDF material may be
shown in talk details but does not count as an annotatable PDF.

### 4.7 Annotation Count

Use a pencil icon plus a number to show the number of annotated slides. The
number counts slides, not strokes or notes. Hide the indicator when the count
is zero unless a zero value is needed in a summary.

Accessible label example: `3 annotated slides`.

### 4.8 Bookmark

Use a familiar bookmark outline/filled icon. Bookmarking is immediate and does
not open the talk. Provide a brief tooltip and accessible state such as
`Bookmark talk` or `Remove bookmark`.

### 4.9 Details Surface

Use a side pane on wide layouts and a bottom sheet or full-width overlay on
narrow layouts. It holds metadata and choices that should not burden the
default agenda.

The primary action is **Open slides** when an annotatable PDF exists.

### 4.10 Dialogs

Use dialogs for destructive actions, credentials, and decisions with important
consequences. Dialog titles describe the decision. Primary and destructive
actions use explicit verbs.

Do not use a dialog for ordinary navigation or lightweight metadata.

## 5. Input and Interaction

### 5.1 Minimum Targets

Interactive targets are at least 44 by 44 CSS pixels and preferably 48 by 48.
Maintain enough separation to avoid accidental touches.

### 5.2 Pointer and Touch

* Mouse wheel: vertical scroll.
* `Shift` plus mouse wheel: horizontal scroll where applicable.
* Trackpad: two-axis pan.
* One-finger touch: pan/scroll.
* Pinch: zoom where supported.

Use visible scrollbars on two-dimensional surfaces. Content clipping should
also hint that horizontal content exists.

### 5.3 Pen

In Slide Notes, pen input draws when a drawing tool is active. Finger input
continues to pan and zoom and does not place typed annotations in V1. Pen and
touch behaviors must never switch silently.

### 5.4 Keyboard

All controls participate in a logical tab order. Arrow keys navigate segmented
controls and pan the agenda canvas when focus is on it. Escape closes the top
overlay or pane. Enter and Space activate focused controls according to Windows
conventions.

## 6. Icons and Labels

Use a consistent Fluent-compatible icon library. Prefer icons already familiar
to Windows users: Back, Search, Refresh, Export/Save, Bookmark, Delete, Pen,
Eraser, Undo, Redo, and Settings.

Icon-only controls require:

* A tooltip.
* An accessible name.
* Visible hover, pressed, and focus states.

Use text labels beside icons for unfamiliar or important states. For example,
show `3 PDFs`, not only a document icon with a badge.

## 7. Feedback and Motion

Feedback should be immediate but quiet:

* Bookmark changes update in place.
* Automatic saves use a subtle transient status.
* Refresh and export show progress without blocking unrelated work when safe.
* Errors appear near the failed action and preserve user input.

Use short Fluent-style transitions for panes, selection, and state changes.
Avoid decorative motion. Respect reduced-motion preferences.

## 8. Accessibility Checklist

* WCAG AA contrast for text and controls.
* Visible keyboard focus.
* No color-only status communication.
* Screen-reader names for every icon action and status indicator.
* Logical reading and tab order on the two-dimensional agenda canvas.
* Text remains usable at Windows text scaling settings.
* Touch controls remain usable with limited dexterity.
* Motion respects system preferences.

## 9. Writing Style

Use concise, direct language:

* Prefer **Open event** over **Submit**.
* Prefer **Open slides** over **View material**.
* Prefer **3 annotated slides** over **3 annotations**.
* Prefer **No slides** over an empty or disabled icon.

Errors explain what happened and what the user can do next. Avoid technical
Indico terminology unless it helps the target user understand the problem.
