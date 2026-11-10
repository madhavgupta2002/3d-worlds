/**
 * GLSL shared by everything that has to sit on, or sway above, the water:
 * the same summed-Gerstner evaluation the water surface and the CPU use.
 */

export const WAVE_UNIFORMS = /* glsl */ `
  uniform vec4 waves[ 4 ];
  uniform float waveTime;
  uniform float waveScale;
`;

export const WAVE_FUNC = /* glsl */ `
  void gerstner( in vec2 p, out vec3 disp, out vec3 nrm ) {
    vec3 tangent = vec3( 1.0, 0.0, 0.0 );
    vec3 binormal = vec3( 0.0, 0.0, 1.0 );
    disp = vec3( 0.0 );
    for ( int i = 0; i < 4; i ++ ) {
      vec2 dir = normalize( waves[ i ].xy );
      float steepness = waves[ i ].z * waveScale;
      float wavelength = max( 0.5, waves[ i ].w );
      float k = 6.283185307 / wavelength;
      float c = sqrt( 9.81 / k );
      float a = steepness / k;
      float f = k * ( dot( dir, p ) - c * waveTime );
      float sinF = sin( f );
      float cosF = cos( f );
      disp += vec3( dir.x * a * cosF, a * sinF, dir.y * a * cosF );
      tangent += vec3( -dir.x * dir.x * steepness * sinF, dir.x * steepness * cosF, -dir.x * dir.y * steepness * sinF );
      binormal += vec3( -dir.x * dir.y * steepness * sinF, dir.y * steepness * cosF, -dir.y * dir.y * steepness * sinF );
    }
    nrm = normalize( cross( binormal, tangent ) );
  }
`;

/**
 * Make a material's geometry ride the waves. Uniform objects are shared with
 * the water material, so they stay in sync for free.
 * `opts.bobScale` damps vertical motion (use < 1 for big rafts).
 */
export function makeFloating(material, waterSystem, opts = {}) {
  const wu = waterSystem.uniforms;
  const extra = {
    waves: wu.waves,
    waveTime: wu.waveTime,
    waveScale: wu.waveScale,
    uBob: { value: opts.bobScale ?? 1 },
    uTilt: { value: opts.tilt ?? 1 },
  };
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, extra);
    shader.vertexShader =
      WAVE_UNIFORMS +
      'uniform float uBob;\nuniform float uTilt;\n' +
      WAVE_FUNC +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        `
        vec4 _wp = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          _wp = instanceMatrix * _wp;
        #endif
        _wp = modelMatrix * _wp;

        vec3 _disp; vec3 _wnrm;
        gerstner( _wp.xz, _disp, _wnrm );
        _wp.xyz += vec3( _disp.x * uTilt, _disp.y * uBob, _disp.z * uTilt );

        vec4 mvPosition = viewMatrix * _wp;
        gl_Position = projectionMatrix * mvPosition;

        #ifndef FLAT_SHADED
          vNormal = normalize( ( viewMatrix * vec4( normalize( mix( vec3(0.0,1.0,0.0), _wnrm, uTilt ) ), 0.0 ) ).xyz );
        #endif
        `
      );
  };
  const key = 'floating-' + (opts.bobScale ?? 1) + '-' + (opts.tilt ?? 1);
  // NB: the default customProgramCacheKey reads `this.onBeforeCompile`, so the
  // previous implementation has to be called bound to the material.
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => key;
  void prevKey;
  return material;
}

/**
 * Wind sway for foliage: displacement grows with height up the model, phase
 * varies with world position so a forest never moves in lockstep.
 */
export function makeWindy(material, clock, opts = {}) {
  const extra = {
    uWindTime: clock.uniform,
    uWind: { value: opts.strength ?? 0.12 },
    uWindHeight: { value: opts.height ?? 6 },
    uWindDir: { value: opts.dir ?? [1, 0.35] },
  };
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, extra);
    shader.vertexShader =
      `
      uniform float uWindTime;
      uniform float uWind;
      uniform float uWindHeight;
      uniform vec2 uWindDir;
      ` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        {
          vec4 _iw = vec4( 0.0, 0.0, 0.0, 1.0 );
          #ifdef USE_INSTANCING
            _iw = instanceMatrix * _iw;
          #endif
          _iw = modelMatrix * _iw;
          float _phase = uWindTime * 1.15 + _iw.x * 0.09 + _iw.z * 0.11;
          float _up = clamp( transformed.y / uWindHeight, 0.0, 1.0 );
          float _amt = uWind * pow( _up, 1.6 );
          float _gust = 0.65 + 0.35 * sin( uWindTime * 0.37 + _iw.x * 0.02 );
          transformed.x += sin( _phase ) * _amt * uWindDir.x * _gust;
          transformed.z += sin( _phase * 1.27 + 1.7 ) * _amt * uWindDir.y * _gust;
          transformed.y -= abs( sin( _phase ) ) * _amt * 0.12;
        }
        `
      );
  };
  const key = 'windy-' + (opts.strength ?? 0.12) + '-' + (opts.height ?? 6);
  // NB: the default customProgramCacheKey reads `this.onBeforeCompile`, so the
  // previous implementation has to be called bound to the material.
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => key;
  void prevKey;
  return material;
}

/** A single shared time uniform so every windy material animates together. */
export class WindClock {
  constructor() {
    this.uniform = { value: 0 };
  }
  update(dt) {
    this.uniform.value += dt;
  }
}
