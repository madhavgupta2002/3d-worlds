"""Builds the world terrain (mountains, canyon, river valley, lake) + rocks in Blender and exports public/creek.glb.

    blender -b -P blender/make_creek.py -- public/creek.glb

Terrain maths mirrors src/terrain.js (Blender is Z-up: blender (x, y, z) = three (x, -z, y)).
"""
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Vector, noise

HALF_X, HALF_Z, STEP = 240.0, 320.0, 1.0


def clamp01(t):
    return min(1.0, max(0.0, t))


def smoothstep(a, b, x):
    t = clamp01((x - a) / (b - a))
    return t * t * (3 - 2 * t)


def center_x(z):
    return 40 * math.sin(z * 0.012) + 15 * math.sin(z * 0.031 + 1)


def lake_t(z):
    return smoothstep(215, 275, z)


def half_width(z):
    return 5 + 1.5 * math.sin(z * 0.045 + 0.5) + 38 * lake_t(z)


def river_level(z):
    return 6 + 34 * (1 - clamp01((z + 320) / 540))


def canyon(z):
    return smoothstep(-170, -130, z) * (1 - smoothstep(10, 50, z))


def fbm(x, z, octaves=5, f0=0.05):
    s, a, f = 0.0, 1.0, f0
    for i in range(octaves):
        s += a * math.sin(x * f + i * 1.7 + math.sin(z * f * 0.8 + i)) * math.cos(z * f * 1.1 + i * 2.3 + math.cos(x * f * 0.7))
        a *= 0.5
        f *= 2.03
    return s


def height(x, z):
    W, d, hw = river_level(z), abs(x - center_x(z)), half_width(z)
    depth = 1.6 + 6 * lake_t(z)
    bed = W - depth + (depth - 0.4) * smoothstep(0, hw, d) + 0.08 * math.sin(x * 1.3) * math.sin(z * 1.1)
    f1 = fbm(x, z)
    ridge = smoothstep(0.15, 0.95, 1 - min(1, abs(fbm(x * 0.5 + 31, z * 0.5 + 17, 3)) / 1.2))
    mask = max(smoothstep(70, 190, d), smoothstep(-120, -300, z))
    mountain = (0.6 * ridge + 0.4 * (f1 * 0.5 + 0.5)) * 130 * mask
    hills = f1 * 3.5 * smoothstep(hw + 4, hw + 40, d) * (1 - mask)
    edge = max(smoothstep(185, 235, abs(x)), smoothstep(270, 315, z), smoothstep(-270, -315, z)) * 70
    land = (W + 1.5 + 0.12 * math.sin(x * 0.9 + z * 0.4) + hills + mountain + edge
            + canyon(z) * 30 * smoothstep(hw + 1, hw + 8, d))
    return bed + (land - bed) * smoothstep(hw * 0.8, hw + 2.5, d)


def material(name, color, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = color
    b.inputs["Roughness"].default_value = rough
    return m


def build_terrain(mat):
    nx, nz = round(2 * HALF_X / STEP) + 1, round(2 * HALF_Z / STEP) + 1
    verts, faces = [], []
    for j in range(nz):
        z = -HALF_Z + j * STEP
        for i in range(nx):
            x = -HALF_X + i * STEP
            verts.append((x, -z, height(x, z)))
    for j in range(nz - 1):
        for i in range(nx - 1):
            a = j * nx + i
            faces.append((a, a + nx, a + nx + 1, a + 1))
    mesh = bpy.data.meshes.new("Terrain")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    for p in mesh.polygons:
        p.use_smooth = True
    mesh.materials.append(mat)
    obj = bpy.data.objects.new("Terrain", mesh)
    bpy.context.collection.objects.link(obj)


def build_rocks(mat, count=700):
    rnd = random.Random(7)
    for n in range(count):
        z = rnd.uniform(-HALF_Z + 30, HALF_Z - 30)
        near_river = rnd.random() < 0.6
        if near_river:
            x = center_x(z) + rnd.uniform(-1, 1) * (half_width(z) + 4 + rnd.random() * 3)
            sc = rnd.uniform(1, 2.5) if rnd.random() < 0.1 else 0.15 + rnd.random() * rnd.random() * 0.8
        else:
            x = center_x(z) + rnd.uniform(-150, 150)
            sc = 0.6 + rnd.random() * rnd.random() * 3
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
        off = Vector((rnd.uniform(0, 100), rnd.uniform(0, 100), rnd.uniform(0, 100)))
        for v in bm.verts:
            d = v.co.normalized()
            r = 1 + 0.28 * noise.noise(d * 1.6 + off) + 0.08 * noise.noise(d * 5 + off)
            v.co = Vector((d.x * r, d.y * r, d.z * r * 0.62))
        mesh = bpy.data.meshes.new(f"Rock_{n:03d}")
        bm.to_mesh(mesh)
        bm.free()
        for p in mesh.polygons:
            p.use_smooth = True
        mesh.materials.append(mat)
        obj = bpy.data.objects.new(f"Rock_{n:03d}", mesh)
        obj.scale = (sc * rnd.uniform(0.8, 1.3), sc * rnd.uniform(0.8, 1.3), sc)
        obj.rotation_euler = (rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), rnd.uniform(0, math.tau))
        obj.location = (x, -z, height(x, z) - sc * 0.15)
        bpy.context.collection.objects.link(obj)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.join(here, "..", "public", "creek.glb")
    out = os.path.abspath(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_terrain(material("Terrain", (0.25, 0.35, 0.15, 1), 0.95))
    build_rocks(material("Rock", (0.35, 0.33, 0.30, 1), 0.85))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(here, "creek.blend"))
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, export_yup=True)
    print("exported", out)


main()
