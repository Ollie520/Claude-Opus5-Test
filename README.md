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
| Drag | Orbit the camera |
| Scroll | Zoom (stops where the sphere fills the frame) |
| Space | Pause / resume rotation |

## Details

Rotation is integrated against frame delta time, so speed is identical at 60 Hz and 144 Hz,
and a backgrounded tab does not jump on return. The device pixel ratio is capped at 2 since
the shader is fill-rate bound. WebGL context loss is handled by rebuilding the program, and
if WebGL is unavailable the page shows a plain message instead of a blank canvas.
`prefers-reduced-motion` slows the rotation to a drift.

Framing is normalised to the shorter viewport edge, so the sphere fits in portrait and
landscape alike and stays perfectly circular at any aspect ratio.
