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
  tangential part of that field's gradient. Oceans stay geometrically flat — relief is
  applied to land only.
- Biomes chosen from height, latitude, elevation and a cheap moisture octave: wet tropics
  forest over, dry ones turn to desert, high latitudes go to tundra, snow and sea ice cap
  the poles, and anything tall enough becomes bare rock. Ocean darkens with depth.
  Albedos are linear values in roughly the range real surfaces occupy — ocean near 0.03,
  forest under 0.1, desert around 0.3, snow around 0.6.
- A separate cloud deck on its own slightly faster rotation, so weather drifts over the
  terrain instead of being painted onto it. Latitude is squashed before sampling, which
  stretches the noise into east-west bands the way rotation organises real weather. A
  single sample stepped along the light direction serves as both the deck's self-shadowing
  and the shadow it casts on the ground.
- Blinn-Phong specular with a Schlick-Fresnel term. Water is sharp enough to give a small
  sun glint, land is nearly matte, and cloud cover blocks the glint underneath it.
- Wrapped diffuse to let air scatter light into the terminator, plus an air-column term
  that goes blue where lit and warm right at the day/night line.
- Procedural starfield with colour by temperature, ACES tone mapping, and a
  linear-to-sRGB transfer at the end.

## The Sun

The Sun is drawn at its true angular size — a disc of 0.266° radius, which at this field of
view is only a handful of pixels — with limb darkening across it and two scales of glare
around it. What sells it is the glare, not the disc. The angle to it is computed in chord
form, `2·asin(|rd - L| / 2)`, because `acos(dot(...))` loses nearly all its precision at the
small angles that matter here.

It is a real object in the scene at a fixed world direction, so the planet occludes it and
you have to orbit to bring it into frame. **That is a physical constraint, not an
oversight:** a lit planet and the Sun cannot share the frame. Seeing the Sun means looking
along the light, which is the same thing as looking at the planet's night side. So the
default view is a well-lit gibbous with the Sun behind you, and orbiting round trades the
surface for a backlit planet, a dark disc ringed by forward-scattered light. Both are the
same scene from different sides.

Atmospheric scattering is what makes that second view work. Side-on, the shell scatters
blue; looking into the Sun through it, forward scattering lights the entire limb into a
bright ring.

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
per pixel rather than the four a tetrahedral stencil needs. The cloud deck runs at four
octaves rather than five, and its lighting reuses a single shadow sample for both the
deck's self-shadowing and the shadow cast on the ground.

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
