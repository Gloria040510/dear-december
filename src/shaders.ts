export const velocityShader = /* glsl */ `
  uniform sampler2D shape;
  uniform float dt, clock, formation, breath, twist, still, spread;
  uniform vec4 handA, handB;
  const float PI = 3.14159265;

  vec3 goal(vec4 rest) {
    float angle = twist + clock * .09 + rest.y * .09;
    mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    vec2 ring = rotation * rest.xz * breath;
    vec3 tree = vec3(ring.x, rest.y, ring.y);
    vec3 dust = vec3(sin(rest.w * 231. + clock * .25), cos(rest.w * 125.), sin(rest.w * 381.)) *
      vec3(3.8, 2.55, 2.35) * (.3 + .75 * fract(rest.w * 162.));
    return mix(dust, tree, formation);
  }
  vec3 influence(vec3 p, vec4 hand) {
    if (abs(hand.w) < .01) return vec3(0.);
    vec3 delta = hand.xyz - p;
    float d = dot(delta, delta);
    return delta * hand.w * exp(-d * .60) * 9.;
  }
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 p = texture2D(texturePosition, uv).xyz;
    vec3 v = texture2D(textureVelocity, uv).xyz;
    vec4 rest = texture2D(shape, uv);
    float mass = .6 + rest.w * .9;
    vec3 q = p * 1.8 + vec3(clock * .38, 0., -clock * .22);
    // Analytic curl of a periodic vector potential.
    vec3 curl = vec3(cos(q.y) + sin(q.z), cos(q.z) + sin(q.x), cos(q.x) + sin(q.y));
    vec3 spiral = vec3(-p.z, .12 * sin(p.y * 3. + clock), p.x) * .30;
    vec3 force = (goal(rest) - p) * mix(2.35, 5.8, formation);
    force += (curl * (.36 + spread * .9) + spiral + influence(p, handA) + influence(p, handB)) * (1. - still);
    v = (v + force * dt / mass) * exp(-dt * mix(2.7, 5.2, still));
    gl_FragColor = vec4(v, 1.);
  }`;
export const positionShader = /* glsl */ `
  uniform float dt;
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 p = texture2D(texturePosition, uv);
    vec3 v = texture2D(textureVelocity, uv).xyz;
    gl_FragColor = vec4(p.xyz + dt * v, mod(p.w + dt * (.12 + p.w * .04), 1.));
  }`;
export const pointVertex = /* glsl */ `
  uniform sampler2D simulation, motionField;
  uniform vec2 viewport;
  uniform float simulated, pixelRatio, glow, density;
  attribute vec2 particleUV;
  attribute float glitter, kind;
  varying float vAlpha, vGlitter, vDepth;
  varying vec2 vCenter, vTrail;
  varying float vRadius;
  void main() {
    vec3 p = position;
    vTrail = vec2(0.);
    if (simulated > .5) {
      p = texture2D(simulation, particleUV).xyz;
      vec2 velocity = (modelViewMatrix * vec4(texture2D(motionField, particleUV).xyz, 0.)).xy;
      vTrail = velocity * min(.13, .32 / max(.001, length(velocity)));
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.);
    gl_Position = projectionMatrix * mv;
    float size = kind > .9 ? (1.7 + pow(glitter, 11.) * 4.0) : (1.85 + pow(glitter, 7.) * (kind > .4 ? 3.7 : 2.5));
    vDepth = clamp(abs(mv.z + 8.) * .21, 0., 1.);
    float diameter = clamp(size * pixelRatio * (8.4 / max(1., -mv.z)) * (1. + vDepth * .40 + length(vTrail)), 2., 19.);
    // Leave room for rasterizer rounding, then shade around the true
    // fractional screen position so small stars cross pixels smoothly.
    gl_PointSize = ceil(diameter) + 2.;
    vRadius = diameter * .5;
    vCenter = (gl_Position.xy / gl_Position.w * .5 + .5) * viewport;
    float index = floor(particleUV.y * 256.) * 256. + floor(particleUV.x * 256.);
    float edge = 1. - smoothstep(density - 1900., density, index);
    vAlpha = mix(.045, .49, pow(glitter, 2.2)) * (1. - vDepth * .47) * glow;
    if (kind > .9) vAlpha *= .46;
    else vAlpha *= edge * (kind > .4 ? 1.17 : 1.);
    vGlitter = glitter;
  }`;
export const pointFragment = /* glsl */ `
  uniform vec3 shadow, ink, light, white;
  uniform float warmth;
  varying float vAlpha, vGlitter, vDepth;
  varying vec2 vCenter, vTrail;
  varying float vRadius;
  void main() {
    vec2 offset = (gl_FragCoord.xy - vCenter) / vRadius;
    float distanceSquared = dot(offset, offset);
    if (distanceSquared >= 1.) discard;
    float core = exp(-distanceSquared * (3.7 - vDepth*.8));
    vec2 rear = offset + vTrail;
    float trail = exp(-dot(rear, rear)*5.2) * length(vTrail) * .27;
    float a = (core + trail) * (1. - smoothstep(.22, 1., distanceSquared));
    vec3 c = mix(shadow, ink, smoothstep(.09, .54, vGlitter));
    c = mix(c, light, smoothstep(.43, .91, vGlitter));
    c = mix(c, white, smoothstep(.83, 1., vGlitter)*(.66 + warmth * .16));
    gl_FragColor = vec4(c, vAlpha * a);
    #include <colorspace_fragment>
  }`;

export const backdropVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0., 1.);
  }`;

export const backdropFragment = /* glsl */ `
  uniform vec3 base, aura;
  uniform vec2 focalPoint;
  uniform sampler2D palace;
  uniform float artAspect, viewportAspect, artStrength;
  varying vec2 vUv;
  void main() {
    vec2 distanceToTree = (vUv - focalPoint) / vec2(.39, .46);
    float halo = exp(-dot(distanceToTree, distanceToTree) * 1.8);
    vec2 pool = (vUv - vec2(focalPoint.x, .15)) / vec2(.36, .17);
    float ground = exp(-dot(pool, pool) * 1.9);
    vec3 backdrop = mix(base, aura, halo * .77 + ground * .19);
    if (artAspect > 0.) {
      // Cover the canvas without moving or animating the illustration.
      vec2 fit = min(vec2(viewportAspect / artAspect, artAspect / viewportAspect), 1.);
      vec2 artUv = (vUv - .5) * fit + .5;
      vec3 illustration = texture2D(palace, artUv).rgb;
      backdrop = mix(backdrop, illustration * .86, artStrength);
    }
    gl_FragColor = vec4(backdrop, 1.);
    #include <colorspace_fragment>
  }`;
