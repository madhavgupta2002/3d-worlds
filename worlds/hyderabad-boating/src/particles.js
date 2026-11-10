import * as THREE from 'three';

/**
 * Small CPU-driven particle pool (spray, splashes, dust, fireflies). Points
 * with a soft sprite; cheap enough at a few hundred live particles and much
 * easier to steer than a GPU system.
 */
export class Particles {
  constructor(
    scene,
    {
      texture,
      max = 600,
      size = 0.35,
      gravity = -9.8,
      drag = 0.6,
      color = 0xffffff,
      opacity = 0.9,
      additive = false,
      fadeIn = 0.06,
      waterLevel = 0,
      killBelowWater = true,
      name = 'particles',
    } = {}
  ) {
    this.max = max;
    this.gravity = gravity;
    this.drag = drag;
    this.waterLevel = waterLevel;
    this.killBelowWater = killBelowWater;

    this.positions = new Float32Array(max * 3);
    this.velocities = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.sizes = new Float32Array(max);
    this.alphas = new Float32Array(max);
    this.cursor = 0;
    this.liveCount = 0;
    this.fadeIn = fadeIn;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    geometry.setDrawRange(0, max);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: texture },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
        uScale: { value: size },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        varying float vAlpha;
        uniform float uScale;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4( position, 1.0 );
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale * 300.0 / max( 1.0, -mv.z );
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTexture;
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vAlpha;
        void main() {
          if ( vAlpha <= 0.001 ) discard;
          vec4 t = texture2D( uTexture, gl_PointCoord );
          gl_FragColor = vec4( uColor, t.a * vAlpha * uOpacity );
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.name = name;
    this.points.renderOrder = 3;
    scene.add(this.points);
    this.scene = scene;
  }

  spawn(x, y, z, vx, vy, vz, life = 1, size = 1) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.positions[i3] = x;
    this.positions[i3 + 1] = y;
    this.positions[i3 + 2] = z;
    this.velocities[i3] = vx;
    this.velocities[i3 + 1] = vy;
    this.velocities[i3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.sizes[i] = size;
    this.alphas[i] = 0.001;
  }

  update(dt) {
    const { positions, velocities, life, maxLife, alphas } = this;
    const dragF = Math.exp(-this.drag * dt);
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) {
        alphas[i] = 0;
        continue;
      }
      life[i] -= dt;
      if (life[i] <= 0) {
        alphas[i] = 0;
        continue;
      }
      const i3 = i * 3;
      velocities[i3 + 1] += this.gravity * dt;
      velocities[i3] *= dragF;
      velocities[i3 + 1] *= dragF;
      velocities[i3 + 2] *= dragF;
      positions[i3] += velocities[i3] * dt;
      positions[i3 + 1] += velocities[i3 + 1] * dt;
      positions[i3 + 2] += velocities[i3 + 2] * dt;
      if (this.killBelowWater && positions[i3 + 1] < this.waterLevel - 0.05) {
        life[i] = 0;
        alphas[i] = 0;
        continue;
      }
      const t = life[i] / maxLife[i];
      const fade = Math.min(1, (maxLife[i] - life[i]) / this.fadeIn);
      alphas[i] = Math.min(1, t * 1.6) * fade;
      live++;
    }
    this.liveCount = live;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }

  setWaterLevel(y) {
    this.waterLevel = y;
  }

  dispose() {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
