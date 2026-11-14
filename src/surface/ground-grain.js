// Decorative fine detail for the surface view's ground.
//
// The terrain data stops at 80 m per pixel, so up close the ground would be a featureless sheet. This adds
// grain to the ground's shader: speckle, and small bumps that catch the low Sun. It is NOT data. To keep that
// honest, every scale used here is smaller than the data's 80 m pixels, so nothing the data could show is
// invented, and the app says the grain is decorative.
//
// The same material also draws height contour lines, used by the lenses (src/surface/lenses.js). Those ARE
// data: they follow the terrain's elevation, passed in per vertex.
//
// It patches three.js's basic material (rather than replacing it) so the logarithmic depth buffer keeps working.
import * as THREE from 'three';

const GRAIN_GLSL = /* glsl */ `
  uniform vec2 grainSun;      // horizontal unit vector toward the Sun (x east, z south)
  uniform float grainRelief;  // how strongly small bumps catch the light; higher when the Sun is low
  uniform float grainStrength; // 1 = grain on, 0 = off (lenses show data, so they get no decoration)
  uniform float contourStrength; // 1 = draw height contour lines, 0 = none
  varying vec3 vGroundPos;
  varying float vElevation;      // metres above the Moon's mean radius

  // A line wherever "value" crosses a multiple of "interval", about widthPx pixels wide.
  // It fades out where lines would crowd closer than a few pixels, instead of turning into a smear.
  float contourLine(float value, float interval, float widthPx) {
    float f = value / interval;
    float perPixel = max(fwidth(f), 1e-6);
    float pixelsAway = abs(fract(f + 0.5) - 0.5) / perPixel;
    return (1.0 - smoothstep(widthPx * 0.5, widthPx * 0.5 + 1.0, pixelsAway)) * (1.0 - smoothstep(0.2, 0.45, perPixel));
  }
  vec3 withContours(vec3 color) {
    float line = max(contourLine(vElevation, 100.0, 1.7) * 0.6, contourLine(vElevation, 10.0, 1.0) * 0.32) * contourStrength;
    // Dark lines on light ground, light lines on dark ground, so they show on every colour of a ramp.
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(color, luma > 0.16 ? vec3(0.0) : vec3(1.0), line * (luma > 0.16 ? 0.6 : 0.45));
    // Faint rings of equal distance from the viewer (every 10 m, 100 m and 1 km), so flat ground of a
    // single colour still shows how far away things are. From eye height the ground foreshortens fast:
    // only the 10 m rings are far enough apart on screen to see nearby.
    float range = length(vGroundPos.xz);
    float ring = max(max(contourLine(range, 1000.0, 1.3) * 0.34, contourLine(range, 100.0, 1.0) * 0.22),
                     contourLine(range, 10.0, 1.0) * 0.14) * contourStrength;
    return mix(color, luma > 0.16 ? vec3(0.0) : vec3(1.0), ring);
  }

  // Integer hash, so the pattern stays stable hundreds of kilometres from the origin.
  float grainHash(vec2 cell) {
    uvec2 q = uvec2(ivec2(cell)) * uvec2(1597334673u, 3812015801u);
    uint n = (q.x ^ q.y) * 1597334673u;
    return float(n) * (1.0 / 4294967295.0);
  }
  vec2 grainGradient(vec2 cell) {
    float angle = grainHash(cell) * 6.2831853;
    return vec2(cos(angle), sin(angle));
  }
  // Gradient ("Perlin") noise, roughly -0.7 to 0.7. Smoother and less grid-like than averaging random values.
  float grainNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = dot(grainGradient(i), f);
    float b = dot(grainGradient(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
    float c = dot(grainGradient(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
    float d = dot(grainGradient(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  // One scale of detail. "period" is the size of its features in metres; "turn" rotates this scale's grid
  // so the grids of different scales never line up.
  float grainOctave(vec2 p, float period, float turn, float lit) {
    mat2 rotate = mat2(cos(turn), sin(turn), -sin(turn), cos(turn));
    vec2 q = rotate * p / period;
    float cellsPerPixel = max(fwidth(q.x), fwidth(q.y));
    float keep = 1.0 - smoothstep(0.2, 0.55, cellsPerPixel); // fade out with distance, before it shimmers
    if (keep <= 0.0) return 0.0;
    float here = grainNoise(q);
    float towardSun = grainNoise(q + rotate * grainSun * 0.3);
    // Treat the noise as tiny hills: ground that falls away toward the Sun faces it and is brighter.
    return keep * (here * 0.22 + (here - towardSun) * grainRelief * lit);
  }
  float groundGrain(vec3 pos, vec3 shade) {
    float lit = smoothstep(0.05, 0.2, dot(shade, vec3(0.333))); // bumps only catch light where there is some
    vec2 p = pos.xz;
    float g = grainOctave(p, 0.03, 0.0, lit) * 0.35
            + grainOctave(p, 0.11, 0.7, lit) * 0.45
            + grainOctave(p, 0.4, 1.9, lit) * 0.55
            + grainOctave(p, 1.5, 2.6, lit) * 0.65
            + grainOctave(p, 5.5, 3.8, lit) * 0.7
            + grainOctave(p, 19.0, 5.1, lit) * 0.5
            + grainOctave(p, 60.0, 0.4, lit) * 0.35;
    return clamp(1.0 + g * grainStrength, 0.3, 1.8);
  }
`;

/** A vertex-coloured ground material with grain. `uniforms` lets the caller move the Sun. */
export function createGroundMaterial() {
  const uniforms = {
    grainSun: { value: new THREE.Vector2(1, 0) },
    grainRelief: { value: 1 },
    grainStrength: { value: 1 },
    contourStrength: { value: 0 },
  };
  const material = new THREE.MeshBasicMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float groundElevation;\nvarying vec3 vGroundPos;\nvarying float vElevation;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundPos = position;\nvElevation = groundElevation;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GRAIN_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= groundGrain(vGroundPos, vColor.rgb);\nif (contourStrength > 0.0) diffuseColor.rgb = withContours(diffuseColor.rgb);');
  };
  return {
    material,
    /** Lenses show data: grain off, contour lines on. The natural view is the other way round. */
    setLensMode(on) {
      uniforms.grainStrength.value = on ? 0 : 1;
      uniforms.contourStrength.value = on ? 1 : 0;
    },
    /** @param {THREE.Vector3} sunDirection scene-space unit vector  @param {number} elevationDeg */
    setSun(sunDirection, elevationDeg) {
      const h = Math.hypot(sunDirection.x, sunDirection.z) || 1;
      uniforms.grainSun.value.set(sunDirection.x / h, sunDirection.z / h);
      // Low Sun rakes across the ground and makes every bump stand out; a high Sun flattens it.
      uniforms.grainRelief.value = THREE.MathUtils.lerp(1.5, 0.45, THREE.MathUtils.smoothstep(elevationDeg, 2, 25));
    },
  };
}
