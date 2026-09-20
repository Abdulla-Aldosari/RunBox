# Tooltip System

The tooltip system is a self-contained IIFE in `media/main.js`. It uses event delegation on `mouseover`/`mouseout` to show a VS Code-style floating tooltip after a 550 ms delay. A single DOM element (`.tr-tooltip-hover`) is created once and reused for every tooltip.

## Data Attributes

| Attribute | Type | Required | Description |
| - | - | :-: | - |
| `data-tooltip` | string | no | Body text. Bold. Supports HTML. |
| `data-tooltip-header` | string | no | Header text. Smaller, muted. Appears above the body. Supports HTML. |
| `data-tooltip-footer` | string | no | Footer text. Smaller, muted. Appears below a divider line. Supports HTML. |
| `data-tooltip-pos` | string | no | Position: `top`, `bottom` (default), `left`, `right`. |

Any combination is valid. Sections that have no value are not rendered. A divider line (`.tr-tooltip-divider`) is inserted automatically between the body/header area and the footer when both are present.

## CSS Classes

| Class | Element | Description |
| - | :-: | - |
| `.tr-tooltip-hover` | root container | Fixed-position wrapper, handles shadow and arrow |
| `.tr-tooltip-header` | header section | Small, 75% opacity |
| `.tr-tooltip-body` | body section | Bold text |
| `.tr-tooltip-divider` | divider | 1px border, 50% opacity |
| `.tr-tooltip-footer` | footer section | Small, 65% opacity |

## Usage Examples

```html
<!-- Body only (backward-compatible with all existing usages) -->
<button data-tooltip="Run command">...</button>

<!-- Body + Footer -->
<button data-tooltip="git status" data-tooltip-footer="Shows the working tree status">...</button>

<!-- Header + Body + Footer -->
<button data-tooltip-header="Title" data-tooltip="Value" data-tooltip-footer="Description">...</button>

<!-- Position override -->
<button data-tooltip="Remove from favorites" data-tooltip-pos="left">...</button>
```

> **Note:** `data-tooltip` values are injected via `innerHTML`. Use only with trusted code — never with user input.
