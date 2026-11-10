import * as THREE from 'three';
import { clamp } from './utils.js';

/**
 * Heightfield terrain with a four-way texture splat (lake bed / wet shore /
 * ground / rock), plus the two things everything else needs: a CPU height
 * query and a baked water-depth map that drives the water shader's shoreline.
 */
export class Terrain {
  constructor(assets, opts) {
    this.assets = assets;
    this.size = opts.size ?? 1500;
    this.segments = opts.segments ?? 448;
    this.level = opts.level ?? 0;
    this.heightFn = opts.heightFn;
    this.depthScale = opts.depthScale ?? 16;
    this.depthRes = opts.depthRes ?? 1024;

    const layers = opts.layers;
    this.layers = layers;

    this.half = this.size / 2;
    this.cells = this.segments;
    this.cellSize = this.size / this.cells;

    // ---- bake heights -------------------------------------------------------
    const n = this.cells + 1;
    this.gridN = n;
    this.heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      const z = -this.half + j * this.cellSize;
      for (let i = 0; i < n; i++) {
        const x = -this.half + i * this.cellSize;
        this.heights[j * n + i] = this.heightFn(x, z);
      }
    }

    // ---- geometry -----------------------------------------------------------
    const geometry = new THREE.PlaneGeometry(this.size, this.size, this.cells, this.cells);
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.attributes.position;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        pos.setY(j * n + i, this.heights[j * n + i]);
      }
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    this.material = this.#buildMaterial();
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.name = 'terrain';
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();

    this.#bakeDepthMap();
    this.#bakeMinimap();
  }

  // ----------------------------------------------------------------- material
  #buildMaterial() {
    const a = this.assets;
    const L = this.layers;
    const sets = L.map((l) => a.set(l.set, 1));

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      map: sets[2].map,
      normalMap: sets[2].normalMap,
    });
    mat.normalScale.set(1.1, 1.1);

    const uniforms = {
      uMap0: { value: sets[0].map },
      uMap1: { value: sets[1].map },
      uMap2: { value: sets[2].map },
      uMap3: { value: sets[3].map },
      uNrm0: { value: sets[0].normalMap },
      uNrm1: { value: sets[1].normalMap },
      uNrm2: { value: sets[2].normalMap },
      uNrm3: { value: sets[3].normalMap },
      uArm0: { value: sets[0].armMap },
      uArm1: { value: sets[1].armMap },
      uArm2: { value: sets[2].armMap },
      uArm3: { value: sets[3].armMap },
      uScale: {
        value: new THREE.Vector4(
          1 / (L[0].scale ?? 6),
          1 / (L[1].scale ?? 5),
          1 / (L[2].scale ?? 7),
          1 / (L[3].scale ?? 9)
        ),
      },
      uTint0: { value: new THREE.Color(L[0].tint ?? 0xffffff) },
      uTint1: { value: new THREE.Color(L[1].tint ?? 0xffffff) },
      uTint2: { value: new THREE.Color(L[2].tint ?? 0xffffff) },
      uTint3: { value: new THREE.Color(L[3].tint ?? 0xffffff) },
      uLevels: {
        value: new THREE.Vector4(
          this.level, // water line
          this.level + (this.layers[1].bandTop ?? 1.6), // wet shore top
          this.layers[2].blend ?? 2.2,
          0
        ),
      },
      uRock: { value: new THREE.Vector2(L[3].slopeStart ?? 0.3, L[3].slopeFull ?? 0.62) },
      uMacro: { value: L[2].macro ?? 0.35 },
    };
    this.uniforms = uniforms;

    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader =
        'varying vec3 vWPos;\nvarying vec3 vWNrm;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
           vWNrm = normalize( mat3( modelMatrix ) * objectNormal );`
        );

      shader.fragmentShader =
        `
        varying vec3 vWPos;
        varying vec3 vWNrm;
        uniform sampler2D uMap0; uniform sampler2D uMap1; uniform sampler2D uMap2; uniform sampler2D uMap3;
        uniform sampler2D uNrm0; uniform sampler2D uNrm1; uniform sampler2D uNrm2; uniform sampler2D uNrm3;
        uniform sampler2D uArm0; uniform sampler2D uArm1; uniform sampler2D uArm2; uniform sampler2D uArm3;
        uniform vec4 uScale;
        uniform vec3 uTint0; uniform vec3 uTint1; uniform vec3 uTint2; uniform vec3 uTint3;
        uniform vec4 uLevels;
        uniform vec2 uRock;
        uniform float uMacro;

        float hash21( vec2 p ) {
          p = fract( p * vec2( 123.34, 456.21 ) );
          p += dot( p, p + 45.32 );
          return fract( p.x * p.y );
        }
        float vnoise( vec2 p ) {
          vec2 i = floor( p ), f = fract( p );
          f = f * f * ( 3.0 - 2.0 * f );
          float a = hash21( i );
          float b = hash21( i + vec2( 1.0, 0.0 ) );
          float c = hash21( i + vec2( 0.0, 1.0 ) );
          float d = hash21( i + vec2( 1.0, 1.0 ) );
          return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
        }

        vec4 splatWeights() {
          float h = vWPos.y;
          float slope = 1.0 - clamp( vWNrm.y, 0.0, 1.0 );
          float grain = vnoise( vWPos.xz * 0.055 ) * 0.5 + vnoise( vWPos.xz * 0.21 ) * 0.5;

          float bed   = 1.0 - smoothstep( uLevels.x - 1.1, uLevels.x + 0.25, h );
          float wet   = ( 1.0 - smoothstep( uLevels.y, uLevels.y + uLevels.z, h ) )
                        * smoothstep( uLevels.x - 1.3, uLevels.x + 0.1, h );
          float ground = smoothstep( uLevels.y - 0.4, uLevels.y + uLevels.z, h );
          ground = mix( ground, ground * ( 0.55 + 0.9 * grain ), uMacro );
          float rock  = smoothstep( uRock.x, uRock.y, slope + ( grain - 0.5 ) * 0.14 );

          vec4 w = vec4( bed, wet, max( ground, 0.04 ), rock * 1.4 );
          w.rgb *= ( 1.0 - clamp( rock, 0.0, 1.0 ) * 0.85 );
          float total = w.x + w.y + w.z + w.w + 1e-4;
          return w / total;
        }
        ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          `
          vec4 sw = splatWeights();
          vec2 uv0 = vWPos.xz * uScale.x;
          vec2 uv1 = vWPos.xz * uScale.y;
          vec2 uv2 = vWPos.xz * uScale.z;
          vec2 uv3 = vWPos.xz * uScale.w;

          vec3 c0 = texture2D( uMap0, uv0 ).rgb * uTint0;
          vec3 c1 = texture2D( uMap1, uv1 ).rgb * uTint1;
          vec3 c2 = texture2D( uMap2, uv2 ).rgb * uTint2;
          vec3 c3 = texture2D( uMap3, uv3 ).rgb * uTint3;
          vec3 splatColor = c0 * sw.x + c1 * sw.y + c2 * sw.z + c3 * sw.w;

          vec3 a0 = texture2D( uArm0, uv0 ).rgb;
          vec3 a1 = texture2D( uArm1, uv1 ).rgb;
          vec3 a2 = texture2D( uArm2, uv2 ).rgb;
          vec3 a3 = texture2D( uArm3, uv3 ).rgb;
          vec3 splatArm = a0 * sw.x + a1 * sw.y + a2 * sw.z + a3 * sw.w;

          // large-scale colour variation so tiling never reads as a grid
          float macro = vnoise( vWPos.xz * 0.012 );
          splatColor *= mix( 0.82, 1.14, macro );

          diffuseColor.rgb *= splatColor * mix( 0.55, 1.0, splatArm.r );
          `
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = roughness * clamp( splatArm.g, 0.08, 1.0 );`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `
          vec3 n0 = texture2D( uNrm0, uv0 ).xyz * 2.0 - 1.0;
          vec3 n1 = texture2D( uNrm1, uv1 ).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D( uNrm2, uv2 ).xyz * 2.0 - 1.0;
          vec3 n3 = texture2D( uNrm3, uv3 ).xyz * 2.0 - 1.0;
          vec3 mapN = normalize( n0 * sw.x + n1 * sw.y + n2 * sw.z + n3 * sw.w );
          mapN.xy *= normalScale;
          normal = normalize( tbn * mapN );
          `
        );
    };
    mat.customProgramCacheKey = () => 'terrain-splat-v1';
    return mat;
  }

  // ------------------------------------------------------------- CPU queries
  height(x, z) {
    const fx = (x + this.half) / this.cellSize;
    const fz = (z + this.half) / this.cellSize;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= this.cells || j >= this.cells) {
      return this.heightFn(clamp(x, -this.half, this.half), clamp(z, -this.half, this.half));
    }
    const tx = fx - i;
    const tz = fz - j;
    const n = this.gridN;
    const h00 = this.heights[j * n + i];
    const h10 = this.heights[j * n + i + 1];
    const h01 = this.heights[(j + 1) * n + i];
    const h11 = this.heights[(j + 1) * n + i + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  /** Water depth at a point (negative = dry land). */
  depth(x, z) {
    return this.level - this.height(x, z);
  }

  normal(x, z, out = new THREE.Vector3()) {
    const d = this.cellSize;
    const hl = this.height(x - d, z);
    const hr = this.height(x + d, z);
    const hd = this.height(x, z - d);
    const hu = this.height(x, z + d);
    out.set(hl - hr, 2 * d, hd - hu).normalize();
    return out;
  }

  /** True if a point is navigable water with at least `draft` metres. */
  navigable(x, z, draft = 0.4) {
    return this.depth(x, z) > draft;
  }

  // ----------------------------------------------------------------- baked maps
  #bakeDepthMap() {
    const res = this.depthRes;
    const data = new Uint8Array(res * res);
    const step = this.size / (res - 1);
    for (let j = 0; j < res; j++) {
      const z = -this.half + j * step;
      for (let i = 0; i < res; i++) {
        const x = -this.half + i * step;
        const d = this.level - this.height(x, z);
        data[j * res + i] = Math.round(clamp(d / this.depthScale, 0, 1) * 255);
      }
    }
    const tex = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.depthTexture = tex;
    this.depthBounds = {
      minX: -this.half,
      minZ: -this.half,
      sizeX: this.size,
      sizeZ: this.size,
    };
  }

  #bakeMinimap() {
    const res = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = res;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(res, res);
    const step = this.size / (res - 1);
    for (let j = 0; j < res; j++) {
      const z = -this.half + j * step;
      for (let i = 0; i < res; i++) {
        const x = -this.half + i * step;
        const h = this.height(x, z);
        const d = this.level - h;
        const o = (j * res + i) * 4;
        let r, g, b;
        if (d > 0) {
          const t = clamp(d / 8, 0, 1);
          r = 26 + (1 - t) * 44;
          g = 58 + (1 - t) * 44;
          b = 62 + (1 - t) * 20;
        } else {
          const t = clamp(h / 26, 0, 1);
          r = 74 + t * 86;
          g = 70 + t * 70;
          b = 52 + t * 48;
        }
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.minimapCanvas = canvas;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.depthTexture.dispose();
  }
}
