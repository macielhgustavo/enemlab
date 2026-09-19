# Studium Labs — Cobalt palette

Graphite remains the foundation. Cobalt identifies actions, focus, selection and progress; amber identifies attention. Successful/completed states use slate blue and errors retain rose. Color is always paired with text or another state indicator.

| Role | Dark | Light |
| --- | --- | --- |
| Background | `#141416` | `#fafafa` |
| Primary | `#91afff` | `#315acb` |
| Selected surface | `#222e48` | `#eaf0ff` |
| Attention | `#e4b96b` | `#875900` |
| Error | `#f3999e` | `#9f2424` |

The primary color has separate values for filled controls, readable foregrounds and subtle surfaces. Neutral text remains dominant; decorative gradients and repeating color-filled cards are avoided. Tokens live in `src/app/studium-green.css`; the edition name does not prescribe green.

## Incorporated components

- **Origin UI / coss InputGroup:** grouped input and addons, including addon-click focus. Used by Bank search, with clear action returning focus to the input.
- **ReUI NumberField composition:** decrement/input/increment with native numeric input behavior. Used by the three numeric Adaptive goal fields; minimum/maximum states, direct editing and arrow-key stepping are preserved. No Base UI dependency or scrub gesture was introduced.
- **Kibo Status:** indicator and label composition, adapted to study states without pulsing decoration. Used in History rows.
- Existing Kibo Choicebox and ReUI Timeline adopt the cobalt selection/progress colors.

Sources and MIT notices are in `THIRD_PARTY_NOTICES.md`. Storybook includes palette, search, numeric goal and status examples. Browser tests cover clearing/focus, numeric bounds, native keyboard input, draft preservation and axe in both themes.
