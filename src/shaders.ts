export const velocityShader = /* glsl */ `
  uniform sampler2D shape;
  uniform float dt, clock, formation, breath, twist, still, spread;
  uniform vec4 handA, handB;
  const float PI = 3.14159265;

  vec3 goal(vec4 rest) {
    float angle = twist + clock * .13 + rest.y * .09;
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
  uniform float simulated, time, pixelRatio, glow;
  attribute vec2 particleUV;
  attribute float glitter, kind;
  varying float vAlpha, vGlitter, vKind, vDepth;
  varying vec2 vTrail;
  void main() {
    vec4 p = vec4(position, glitter);
    vTrail = vec2(0.);
    if (simulated > .5) {
      p = texture2D(simulation, particleUV);
      vec2 velocity = (modelViewMatrix * vec4(texture2D(motionField, particleUV).xyz, 0.)).xy;
      vTrail = velocity * min(.12, .28 / max(.001, length(velocity)));
    }
    vec4 mv = modelViewMatrix * vec4(p.xyz, 1.);
    gl_Position = projectionMatrix * mv;
    float pulse = .7 + .3 * sin(time * (1.3 + glitter * 3.) + glitter * 238.);
    float size = kind > .9 ? (1.1 + pow(glitter, 15.) * 5.4) : (.72 + pow(glitter, 8.) * (kind > .4 ? 3.7 : 2.6));
    vDepth = clamp(abs(mv.z + 8.) * .21, 0., 1.);
    gl_PointSize = clamp(size * pixelRatio * (8.4 / -mv.z) * (1. + vDepth * .45 + length(vTrail)), 1., 17.);
    vAlpha = mix(.14, .73, pow(glitter, 2.25)) * pulse * (1. - vDepth * .41) * (.87 + .13 * sin(p.w * 6.283)) * glow;
    if (kind > .9) vAlpha *= .48;
    else if (kind > .4) vAlpha *= 1.32;
    vGlitter = glitter;
    vKind = kind;
  }`;
export const pointFragment = /* glsl */ `
  uniform vec3 shadow, ink, light, white;
  varying float vAlpha, vGlitter, vKind, vDepth;
  varying vec2 vTrail;
  void main() {
    vec2 uv = gl_PointCoord - .5;
    float d = length(uv);
    float core = exp(-d*d*(28. - vDepth*8.));
    float a = core * (1. - smoothstep(.36, .5, d));
    float rear = length(uv + vec2(vTrail.x, -vTrail.y));
    a += exp(-rear*rear*43.) * length(vTrail) * .62 * (1. - smoothstep(.39, .5, d));
    if (vGlitter > .974 && vKind < .92) {
      float rays = exp(-abs(uv.x)*36.) * exp(-abs(uv.y)*5.) + exp(-abs(uv.y)*36.) * exp(-abs(uv.x)*5.);
      a += rays * .31 * (1. - smoothstep(.32, .5, d));
    }
    vec3 c = mix(shadow, ink, smoothstep(.09, .54, vGlitter));
    c = mix(c, light, smoothstep(.43, .91, vGlitter));
    c = mix(c, white, smoothstep(.83, 1., vGlitter)*.86);
    gl_FragColor = vec4(c, vAlpha * a);
    #include <colorspace_fragment>
  }`;
