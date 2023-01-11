---
sidebar_label: Color Extension
---

# Color Extension

The Color Extension adds RGB color support to WASM-4, making full-color games and applications possible.

Implementation of the extension in runtimes is completely optional, but runtimes supporting the extension *must* also support games not using it.

Games can either require runtimes to support the extension, or fall back on using 4 colors if they don't.

## Changes

When the extension is enabled:
- [PALETTE](memory#palette) will be used per draw function rather than per frame. [DRAW_COLORS](memory#draw_colors) works the same.
- [FRAMEBUFFER](memory#framebuffer) will be unused, letting games use it as additional RAM instead.

## Enabling Color

At [`start`](functions#start-) check the [CAPABILITIES](memory#capabilities) flags to see if `CAPABILITY_COLOR_EXT` is set.
This lets you decide whether to fall back on 4 colors, or to show a custom error screen in the case that the runtime doesn't support the extension.

Set `SYSTEM_COLOR_EXT` in [SYSTEM_FLAGS](memory#system_flags) in [`start`](functions#start-) to enable the extension.
Enabling or disabling the extension from [`update`](functions#update-) is invalid.

## Of note

The extension will be enabled *after* the flag is set in [`start`](functions#start-), meaning anything drawn in [`start`](functions#start-) only uses 4 colors.

Since [FRAMEBUFFER](memory#framebuffer) is unused, you cannot read pixels back from the screen.

[`blit`](http://localhost:3000/docs/reference/functions#blit-spriteptr-x-y-width-height-flags)
and [`blitSub`](http://localhost:3000/docs/reference/functions#blitsub-spriteptr-x-y-width-height-srcx-srcy-stride-flags)
still operate on 1-bit or 2-bit bitmaps.
If you need more than this for your game, you will need to implement it yourself.
The Game Boy Color had a similar limitation for sprites.