// Shader for the Moon's surface: colour map, crisp day/night edge, near/far side tint,
// latitude/longitude grid and coloured polar caps. Everything is computed per pixel from the
// surface direction, so it stays sharp at any zoom.

export const moonVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vPos;
  void main() {
    vUv = uv;
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

export const moonFragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform float hasMap;
  uniform vec3 sunDir;      // unit vector toward the Sun, in the mesh's local frame
  uniform float useSun;
  uniform float night;      // brightness floor on the night side, so it stays readable
  uniform float tintAmt;
  uniform vec3 nearTint;
  uniform vec3 farTint;
  uniform float showGrid;
  uniform float capFill;    // strength of the polar-cap colour wash; faded out in close-ups
  uniform vec3 northCol;
  uniform vec3 southCol;
  varying vec2 vUv;
  varying vec3 vPos;

  // Anti-aliased line masks; w is how much the coordinate changes per pixel.
  float lineAt(float v, float target, float w, float px) {
    float pd = abs(v - target) / w;
    return 1.0 - smoothstep(px * 0.5 - 0.5, px * 0.5 + 0.5, pd);
  }
  float gridAt(float v, float stepDeg, float w, float px) {
    float pd = abs(fract(v / stepDeg + 0.5) - 0.5) * stepDeg / w;
    return 1.0 - smoothstep(px * 0.5 - 0.5, px * 0.5 + 0.5, pd);
  }

  void main() {
    vec3 n = normalize(vPos);
    // Mesh local frame: x toward 0° longitude, y toward the north pole, z toward 90° W.
    float lat = degrees(asin(clamp(n.y, -1.0, 1.0)));
    float lon = degrees(atan(-n.z, n.x));
    float lon360 = mod(lon + 360.0, 360.0);
    float wLat = max(fwidth(lat), 1e-5);
    float wLon = max(min(fwidth(lon), fwidth(lon360)), 1e-5); // avoids the jump at 180°

    vec3 albedo = hasMap > 0.5 ? texture2D(map, vUv).rgb : vec3(0.32);

    // Near/far side: a hue wash, kept separate from brightness (brightness means sunlight).
    float nearK = smoothstep(-0.4, 0.4, 90.0 - abs(lon));
    vec3 tint = mix(farTint, nearTint, nearK);
    float tintLuma = dot(tint, vec3(0.2126, 0.7152, 0.0722));
    albedo *= mix(vec3(1.0), tint / tintLuma, tintAmt);

    // Sunlight: a crisp terminator (the Moon has no air) and gentle shading on the day side.
    float ndl = dot(n, normalize(sunDir));
    float lit = smoothstep(-0.006, 0.006, ndl);
    float day = lit * (0.38 + 0.62 * max(ndl, 0.0));
    float light = mix(1.0, night + (1.0 - night) * day, useSun);
    vec3 col = albedo * light;
    col += tint * 0.012 * tintAmt * (1.0 - lit) * useSun;

    if (showGrid > 0.5) {
      float merFade = 1.0 - smoothstep(70.0, 80.0, abs(lat));
      float minor = max(gridAt(lat, 30.0, wLat, 1.0), gridAt(lon, 30.0, wLon, 1.0) * merFade);
      float major = max(lineAt(lat, 0.0, wLat, 1.8), lineAt(lon, 0.0, wLon, 1.8) * merFade);
      float edge = lineAt(abs(lon), 90.0, wLon, 1.8) * merFade * step(0.45, fract(lat / 4.0));
      vec3 bright = vec3(0.92, 0.88, 0.78);
      col = mix(col, bright, minor * 0.14);
      col = mix(col, bright, major * 0.42);
      col = mix(col, bright, edge * 0.75);
    }

    // Polar caps: a faint fill poleward of 80°, and a solid ring at 80°.
    float lift = max(light, 0.25);
    col = mix(col, northCol * lift, smoothstep(79.6, 80.4, lat) * capFill);
    col = mix(col, southCol * lift, smoothstep(79.6, 80.4, -lat) * capFill);
    col = mix(col, northCol, lineAt(lat, 80.0, wLat, 2.2) * 0.95);
    col = mix(col, southCol, lineAt(lat, -80.0, wLat, 2.2) * 0.95);

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;
