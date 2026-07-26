# Rotating Sphere

A rotating sphere rendered in a single self-contained `index.html`. No build step, no
dependencies, no network access — open the file and it runs.

## Approach

The sphere is **ray-traced analytically** rather than built from triangles. Every pixel
solves the ray/sphere intersection in closed form, which means:

- The silhouette is a mathematically exact circle at any zoom or resolution. There is no
  tessellation, so there is no faceting to find.
- There is no UV seam and no pole pinch. The surface is shaded from 3D solid noise sampled
  in the sphere's own object space, so the poles are no different from anywhere else.
- Edges are anti-aliased analytically. Rather than supersampling, the shader computes one
  pixel's world-space footprint at the ray's closest approach to the centre and uses it as
  the smoothstep width across the limb.

## Rendering

- Ray/sphere intersection, with the shading ray held just inside the limb so the normal
  stays well defined at grazing angles.
- Height field from 5-octave value-noise fBm; the surface normal is perturbed by the
  tangential part of that field's tetrahedrally-sampled gradient.
- Blinn-Phong specular with a Schlick-Fresnel term, roughness driven by terrain height, so
  basins read as smooth water and highlands as rough land.
- Hemispheric ambient fill, a wrapped diffuse term to soften the terminator, and a cool rim
  light along the limb.
- Sun-directional atmospheric halo — brightest where the limb is actually lit.
- Procedural starfield, ACES tone mapping, and a linear-to-sRGB transfer at the end.

## Controls

| Input | Action |
| --- | --- |
| Drag / one-finger swipe | Orbit the camera — flick and release to keep spinning |
| Scroll / pinch | Zoom (stops where the sphere fills the frame) |
| Button, or space | Pause / resume rotation |

Pointer Events drive all of it, so mouse, trackpad, touch, and pen take the same path.
The pointer map is the source of truth for how many fingers are down: one orbits, two
pinch, and lifting one finger of a pinch hands control back to the survivor without the
view jumping. Release velocity is smoothed over recent moves, so a flick coasts and a
drag that stops before letting go does not.

The hint line and the pause control adapt to the device — a phone is told to pinch rather
than scroll, and gets a real tap target instead of a key it has no way to press.

## Smoothness

Nothing the user drives is applied to the camera directly. Input moves a *target*, and the
rendered value chases it with an exponential ease written against delta time
(`1 - exp(-rate * dt)`), so the feel is identical at 60 Hz and 144 Hz rather than being
tuned for one refresh rate. Flick momentum decays the same way.

Resolution is adaptive. The renderer measures frame time over short windows and scales the
drawing buffer between 1.0x and 0.6x to stay inside a 60 fps budget, with CSS stretching it
back to full size — so a slow GPU loses sharpness instead of losing frames. Because fill
cost scales with pixel count, and pixel count with the square of the scale factor, each
correction moves by the square root of the timing miss and lands in one step instead of
creeping down over several seconds. A dead band around the target stops it oscillating.

The fragment shader's cost is dominated by fBm evaluations, so the height gradient uses
forward differences that reuse the centre sample the shader already computed — three taps
per pixel rather than the four a tetrahedral stencil needs.

Output is dithered by less than one 8-bit level before quantisation. Without it the dark
background gradient bands visibly; the pattern is fixed per pixel, so it never shimmers.

## Details

Rotation is integrated against frame delta time, and a backgrounded tab does not jump on
return. The device pixel ratio is capped at 2 since the shader is fill-rate bound. WebGL
context loss is handled by rebuilding the program, and if WebGL is unavailable the page
shows a plain message instead of a blank canvas. `prefers-reduced-motion` slows the
rotation to a drift and drops the control's transitions.

Framing is normalised to the shorter viewport edge, so the sphere fits in portrait and
landscape alike and stays perfectly circular at any aspect ratio.
