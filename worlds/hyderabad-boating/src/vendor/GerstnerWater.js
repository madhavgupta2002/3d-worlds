/**
 * GerstnerWater — an extended copy of three.js examples/jsm/objects/Water.js
 *
 * Original: Copyright (c) 2010-2024 three.js authors — MIT licence.
 *   Work based on:
 *     https://github.com/Slayvin             : flat mirror for three.js
 *     https://home.adelphi.edu/~stemkoski/   : water shader on the flat mirror
 *     http://29a.ch/slides/2012/webglwater/  : water shader explanations in WebGL
 *
 * Additions for this project:
 *   - summed Gerstner waves displace the surface and give an analytic normal,
 *     so the water actually has swell the boat can ride (the CPU uses the same
 *     formula for buoyancy — see src/water.js)
 *   - a baked water-depth map drives the shoreline: fragments on dry land are
 *     discarded, shallows go murky and translucent, and a noisy foam band sits
 *     where the water meets the bank
 *   - a dynamic foam map painted by the boat (wake / churn)
 *   - directional flow for the river
 *   - crest foam on steep wave tops, and optional reflection frame-skipping
 */

import {
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Plane,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three';

const NUM_WAVES = 4;

class GerstnerWater extends Mesh {
  constructor(geometry, options = {}) {
    super(geometry);

    this.isWater = true;

    const scope = this;

    const textureWidth = options.textureWidth !== undefined ? options.textureWidth : 512;
    const textureHeight = options.textureHeight !== undefined ? options.textureHeight : 512;

    const clipBias = options.clipBias !== undefined ? options.clipBias : 0.0;
    const alpha = options.alpha !== undefined ? options.alpha : 1.0;
    const time = options.time !== undefined ? options.time : 0.0;
    const normalSampler = options.waterNormals !== undefined ? options.waterNormals : null;
    const sunDirection =
      options.sunDirection !== undefined ? options.sunDirection : new Vector3(0.70707, 0.70707, 0.0);
    const sunColor = new Color(options.sunColor !== undefined ? options.sunColor : 0xffffff);
    const waterColor = new Color(options.waterColor !== undefined ? options.waterColor : 0x7f7f7f);
    const eye = options.eye !== undefined ? options.eye : new Vector3(0, 0, 0);
    const distortionScale = options.distortionScale !== undefined ? options.distortionScale : 20.0;
    const side = options.side !== undefined ? options.side : DoubleSide;
    const fog = options.fog !== undefined ? options.fog : false;

    this.reflectEveryNFrames = options.reflectEveryNFrames || 1;
    this._frame = 0;

    // ---------------------------------------------------------------- internals
    const mirrorPlane = new Plane();
    const normal = new Vector3();
    const mirrorWorldPosition = new Vector3();
    const cameraWorldPosition = new Vector3();
    const rotationMatrix = new Matrix4();
    const lookAtPosition = new Vector3(0, 0, -1);
    const clipPlane = new Vector4();

    const view = new Vector3();
    const target = new Vector3();
    const q = new Vector4();

    const textureMatrix = new Matrix4();

    const mirrorCamera = new PerspectiveCamera();

    const renderTarget = new WebGLRenderTarget(textureWidth, textureHeight);
    renderTarget.texture.minFilter = LinearFilter;
    renderTarget.texture.magFilter = LinearFilter;
    this.renderTarget = renderTarget;

    // 1×1 black stand-in so the depth/foam samplers are always valid
    const emptyMap = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    emptyMap.needsUpdate = true;

    const mirrorShader = {
      name: 'GerstnerWaterShader',

      uniforms: UniformsUtils.merge([
        UniformsLib['fog'],
        UniformsLib['lights'],
        {
          normalSampler: { value: null },
          mirrorSampler: { value: null },
          alpha: { value: 1.0 },
          time: { value: 0.0 },
          size: { value: 1.0 },
          distortionScale: { value: 20.0 },
          textureMatrix: { value: new Matrix4() },
          sunColor: { value: new Color(0x7f7f7f) },
          sunDirection: { value: new Vector3(0.70707, 0.70707, 0) },
          eye: { value: new Vector3() },
          waterColor: { value: new Color(0x555555) },

          // --- additions -------------------------------------------------
          waves: {
            value: [
              new Vector4(1, 0, 0.14, 26),
              new Vector4(0.7, 0.7, 0.1, 15),
              new Vector4(-0.6, 0.8, 0.07, 8.5),
              new Vector4(0.2, -0.95, 0.05, 4.5),
            ],
          },
          waveTime: { value: 0 },
          waveScale: { value: 1 },
          waveDetail: { value: 0.75 },
          crestFoam: { value: 0.35 },
          crestHeight: { value: 0.55 },
          flow: { value: new Vector2(0, 0) },
          depthMap: { value: emptyMap },
          depthBounds: { value: new Vector4(-500, -500, 1000, 1000) },
          depthScale: { value: 16.0 },
          shallowColor: { value: new Color(0x4e6b46) },
          foamColor: { value: new Color(0xe8f0ee) },
          foamWidth: { value: 1.1 },
          shoreAlpha: { value: 0.45 },
          waterLevel: { value: 0 },
          foamMap: { value: emptyMap },
          foamBounds: { value: new Vector4(-200, -200, 400, 400) },
          foamStrength: { value: 0.9 },
          murk: { value: 0.75 },
        },
      ]),

      vertexShader: /* glsl */ `
				uniform mat4 textureMatrix;
				uniform float time;

				uniform vec4 waves[ ${NUM_WAVES} ];
				uniform float waveTime;
				uniform float waveScale;

				varying vec4 mirrorCoord;
				varying vec4 worldPosition;
				varying vec3 vWaveNormal;
				varying float vWaveHeight;
				varying float vSteepness;

				#include <common>
				#include <fog_pars_vertex>
				#include <shadowmap_pars_vertex>
				#include <logdepthbuf_pars_vertex>

				void gerstner( in vec2 p, out vec3 disp, out vec3 nrm, out float steepSum ) {
					vec3 tangent = vec3( 1.0, 0.0, 0.0 );
					vec3 binormal = vec3( 0.0, 0.0, 1.0 );
					disp = vec3( 0.0 );
					steepSum = 0.0;

					for ( int i = 0; i < ${NUM_WAVES}; i ++ ) {
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

						tangent += vec3(
							- dir.x * dir.x * steepness * sinF,
							dir.x * steepness * cosF,
							- dir.x * dir.y * steepness * sinF
						);
						binormal += vec3(
							- dir.x * dir.y * steepness * sinF,
							dir.y * steepness * cosF,
							- dir.y * dir.y * steepness * sinF
						);
						steepSum += steepness;
					}

					nrm = normalize( cross( binormal, tangent ) );
				}

				void main() {

					vec3 worldPos = ( modelMatrix * vec4( position, 1.0 ) ).xyz;

					vec3 disp;
					vec3 waveNormal;
					float steepSum;
					gerstner( worldPos.xz, disp, waveNormal, steepSum );

					vec3 displaced = worldPos + disp;

					vWaveNormal = waveNormal;
					vWaveHeight = disp.y;
					vSteepness = steepSum;

					mirrorCoord = vec4( displaced, 1.0 );
					worldPosition = mirrorCoord;
					mirrorCoord = textureMatrix * mirrorCoord;

					vec4 mvPosition = viewMatrix * vec4( displaced, 1.0 );
					gl_Position = projectionMatrix * mvPosition;

				#include <beginnormal_vertex>
				#include <defaultnormal_vertex>
				#include <logdepthbuf_vertex>
				#include <fog_vertex>
				#include <shadowmap_vertex>
			}`,

      fragmentShader: /* glsl */ `
				uniform sampler2D mirrorSampler;
				uniform float alpha;
				uniform float time;
				uniform float size;
				uniform float distortionScale;
				uniform sampler2D normalSampler;
				uniform vec3 sunColor;
				uniform vec3 sunDirection;
				uniform vec3 eye;
				uniform vec3 waterColor;

				uniform float waveDetail;
				uniform float crestFoam;
				uniform float crestHeight;
				uniform vec2 flow;
				uniform sampler2D depthMap;
				uniform vec4 depthBounds;
				uniform float depthScale;
				uniform vec3 shallowColor;
				uniform vec3 foamColor;
				uniform float foamWidth;
				uniform float shoreAlpha;
				uniform float waterLevel;
				uniform sampler2D foamMap;
				uniform vec4 foamBounds;
				uniform float foamStrength;
				uniform float murk;

				varying vec4 mirrorCoord;
				varying vec4 worldPosition;
				varying vec3 vWaveNormal;
				varying float vWaveHeight;
				varying float vSteepness;

				vec4 getNoise( vec2 uv ) {
					vec2 drift = flow * time * 6.0;
					vec2 uv0 = ( uv / 103.0 ) + vec2( time / 17.0, time / 29.0 ) + drift / 103.0;
					vec2 uv1 = uv / 107.0 - vec2( time / -19.0, time / 31.0 ) + drift / 107.0;
					vec2 uv2 = uv / vec2( 8907.0, 9803.0 ) + vec2( time / 101.0, time / 97.0 );
					vec2 uv3 = uv / vec2( 1091.0, 1027.0 ) - vec2( time / 109.0, time / -113.0 );
					vec4 noise = texture2D( normalSampler, uv0 ) +
						texture2D( normalSampler, uv1 ) +
						texture2D( normalSampler, uv2 ) +
						texture2D( normalSampler, uv3 );
					return noise * 0.5 - 1.0;
				}

				void sunLight( const vec3 surfaceNormal, const vec3 eyeDirection, float shiny, float spec, float diffuse, inout vec3 diffuseColor, inout vec3 specularColor ) {
					vec3 reflection = normalize( reflect( -sunDirection, surfaceNormal ) );
					float direction = max( 0.0, dot( eyeDirection, reflection ) );
					specularColor += pow( direction, shiny ) * sunColor * spec;
					diffuseColor += max( dot( sunDirection, surfaceNormal ), 0.0 ) * sunColor * diffuse;
				}

				#include <common>
				#include <packing>
				#include <bsdfs>
				#include <fog_pars_fragment>
				#include <logdepthbuf_pars_fragment>
				#include <lights_pars_begin>
				#include <shadowmap_pars_fragment>
				#include <shadowmask_pars_fragment>

				float sampleDepth( vec2 world ) {
					vec2 uv = ( world - depthBounds.xy ) / depthBounds.zw;
					if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) return depthScale;
					return texture2D( depthMap, uv ).r * depthScale;
				}

				void main() {

					#include <logdepthbuf_fragment>

					// ---- shoreline from the baked depth map -----------------
					float waterDepth = sampleDepth( worldPosition.xz );
					if ( waterDepth <= 0.02 ) discard;

					vec4 noise = getNoise( worldPosition.xz * size );
					vec3 detailNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );
					// macro swell normal + fine ripple detail
					vec3 surfaceNormal = normalize(
						vWaveNormal + vec3( detailNormal.x, 0.0, detailNormal.z ) * waveDetail
					);

					vec3 diffuseLight = vec3( 0.0 );
					vec3 specularLight = vec3( 0.0 );

					vec3 worldToEye = eye - worldPosition.xyz;
					vec3 eyeDirection = normalize( worldToEye );
					sunLight( surfaceNormal, eyeDirection, 100.0, 2.0, 0.5, diffuseLight, specularLight );

					float dist = length( worldToEye );

					vec2 distortion = surfaceNormal.xz * ( 0.001 + 1.0 / dist ) * distortionScale;
					vec3 reflectionSample = vec3( texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion ) );

					float theta = max( dot( eyeDirection, surfaceNormal ), 0.0 );
					float rf0 = 0.3;
					float reflectance = rf0 + ( 1.0 - rf0 ) * pow( ( 1.0 - theta ), 5.0 );
					vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;
					vec3 albedo = mix(
						( sunColor * diffuseLight * 0.3 + scatter ) * getShadowMask(),
						( vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight ),
						reflectance
					);

					// ---- shallows: murky, less reflective, slightly see-through
					float shallow = 1.0 - smoothstep( 0.0, 3.2, waterDepth );
					albedo = mix( albedo, mix( shallowColor, albedo, 1.0 - murk ), shallow * 0.9 );

					// ---- shore foam band + wave crest foam ------------------
					float wob = noise.x * 0.5 + 0.5;
					float band = 1.0 - smoothstep( 0.0, foamWidth, waterDepth );
					float foam = smoothstep( 0.32, 0.92, band * ( 0.6 + 0.75 * wob ) );

					float crest = smoothstep( 0.45, 1.0, vWaveHeight / max( 0.05, crestHeight ) );
					foam += crest * crestFoam * ( 0.5 + 0.5 * wob );

					// ---- dynamic foam painted by the boat -------------------
					vec2 fuv = ( worldPosition.xz - foamBounds.xy ) / foamBounds.zw;
					if ( fuv.x > 0.0 && fuv.x < 1.0 && fuv.y > 0.0 && fuv.y < 1.0 ) {
						float churn = texture2D( foamMap, fuv ).r;
						foam += churn * foamStrength * ( 0.55 + 0.6 * wob );
					}

					foam = clamp( foam, 0.0, 1.0 );
					vec3 outgoingLight = mix( albedo, foamColor * ( 0.35 + 0.65 * max( dot( vec3(0.0,1.0,0.0), sunDirection ), 0.15 ) + specularLight * 0.2 ), foam * 0.88 );

					float outAlpha = mix( alpha, shoreAlpha, shallow * ( 1.0 - foam ) );

					gl_FragColor = vec4( outgoingLight, outAlpha );

					#include <tonemapping_fragment>
					#include <colorspace_fragment>
					#include <fog_fragment>
				}`,
    };

    const material = new ShaderMaterial({
      name: mirrorShader.name,
      uniforms: UniformsUtils.clone(mirrorShader.uniforms),
      vertexShader: mirrorShader.vertexShader,
      fragmentShader: mirrorShader.fragmentShader,
      lights: true,
      side: side,
      fog: fog,
      transparent: true,
      depthWrite: true,
    });

    material.uniforms['mirrorSampler'].value = renderTarget.texture;
    material.uniforms['textureMatrix'].value = textureMatrix;
    material.uniforms['alpha'].value = alpha;
    material.uniforms['time'].value = time;
    material.uniforms['normalSampler'].value = normalSampler;
    material.uniforms['sunColor'].value = sunColor;
    material.uniforms['waterColor'].value = waterColor;
    material.uniforms['sunDirection'].value = sunDirection;
    material.uniforms['distortionScale'].value = distortionScale;
    material.uniforms['eye'].value = eye;

    scope.material = material;

    scope.onBeforeRender = function (renderer, scene, camera) {
      // Reflections are a full extra scene render: allow skipping frames.
      scope._frame++;
      if (scope.reflectEveryNFrames > 1 && scope._frame % scope.reflectEveryNFrames !== 0) {
        eye.setFromMatrixPosition(camera.matrixWorld);
        return;
      }

      mirrorWorldPosition.setFromMatrixPosition(scope.matrixWorld);
      cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);

      rotationMatrix.extractRotation(scope.matrixWorld);

      normal.set(0, 0, 1);
      normal.applyMatrix4(rotationMatrix);

      view.subVectors(mirrorWorldPosition, cameraWorldPosition);

      // Avoid rendering when mirror is facing away
      if (view.dot(normal) > 0) {
        eye.setFromMatrixPosition(camera.matrixWorld);
        return;
      }

      view.reflect(normal).negate();
      view.add(mirrorWorldPosition);

      rotationMatrix.extractRotation(camera.matrixWorld);

      lookAtPosition.set(0, 0, -1);
      lookAtPosition.applyMatrix4(rotationMatrix);
      lookAtPosition.add(cameraWorldPosition);

      target.subVectors(mirrorWorldPosition, lookAtPosition);
      target.reflect(normal).negate();
      target.add(mirrorWorldPosition);

      mirrorCamera.position.copy(view);
      mirrorCamera.up.set(0, 1, 0);
      mirrorCamera.up.applyMatrix4(rotationMatrix);
      mirrorCamera.up.reflect(normal);
      mirrorCamera.lookAt(target);

      mirrorCamera.far = camera.far;

      mirrorCamera.updateMatrixWorld();
      mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);

      textureMatrix.set(0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 1.0);
      textureMatrix.multiply(mirrorCamera.projectionMatrix);
      textureMatrix.multiply(mirrorCamera.matrixWorldInverse);

      mirrorPlane.setFromNormalAndCoplanarPoint(normal, mirrorWorldPosition);
      mirrorPlane.applyMatrix4(mirrorCamera.matrixWorldInverse);

      clipPlane.set(mirrorPlane.normal.x, mirrorPlane.normal.y, mirrorPlane.normal.z, mirrorPlane.constant);

      const projectionMatrix = mirrorCamera.projectionMatrix;

      q.x = (Math.sign(clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
      q.y = (Math.sign(clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
      q.z = -1.0;
      q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];

      clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));

      projectionMatrix.elements[2] = clipPlane.x;
      projectionMatrix.elements[6] = clipPlane.y;
      projectionMatrix.elements[10] = clipPlane.z + 1.0 - clipBias;
      projectionMatrix.elements[14] = clipPlane.w;

      eye.setFromMatrixPosition(camera.matrixWorld);

      const currentRenderTarget = renderer.getRenderTarget();
      const currentXrEnabled = renderer.xr.enabled;
      const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;

      scope.visible = false;

      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;

      renderer.setRenderTarget(renderTarget);
      renderer.state.buffers.depth.setMask(true);

      if (renderer.autoClear === false) renderer.clear();
      renderer.render(scene, mirrorCamera);

      scope.visible = true;

      renderer.xr.enabled = currentXrEnabled;
      renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;

      renderer.setRenderTarget(currentRenderTarget);

      const viewport = camera.viewport;
      if (viewport !== undefined) renderer.state.viewport(viewport);
    };
  }

  setReflectionSize(width, height) {
    this.renderTarget.setSize(width, height);
  }
}

export { GerstnerWater, NUM_WAVES };
