#!/usr/bin/env python3
"""Download CC0 / MIT assets for the Hyderabad boating sim.

Sources:
  - Poly Haven (CC0)  : HDRI skies + PBR ground/material textures
  - three.js examples : water normal map (MIT)

Everything lands in ../assets/<kind>/<name>/... and a manifest.json is written.
"""
import json
import os
import sys
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")

# --- what we want -----------------------------------------------------------
HDRIS = {
    # id                                        : local name
    "kloofendal_48d_partly_cloudy_puresky": "day",
    "kiara_3_morning": "morning",
    "belfast_sunset_puresky": "sunset",
    "dikhololo_night": "night",
    "kloofendal_overcast_puresky": "overcast",
}
HDRI_RES = "1k"

# Deccan-plateau palette: dry scrub, red laterite soil, granite, mud, sandstone
TEXTURES = {
    "aerial_grass_rock": "scrub",            # dry grass + rock ground
    "red_laterite_soil_stones": "laterite",  # red Deccan soil
    "brown_mud": "mud",                      # pond / river banks
    "dark_rock": "granite",                  # Hyderabad granite boulders
    "cliff_side": "cliff",
    "coast_sand_01": "sand",
    "brown_planks_09": "planks",             # decks, piers, country boats
    "large_sandstone_blocks": "sandstone",   # ghats, old bridges
    "brushed_concrete": "concrete",          # Tank Bund, embankments
    "bark_willow": "bark",
    "rusty_metal_04": "metal",
}
TEX_RES = "1k"
TEX_MAPS = {"Diffuse": "diff", "nor_gl": "nor", "arm": "arm"}

EXTRA = [
    # three.js (MIT) water normal map, used by the water shader
    ("https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/waternormals.jpg",
     "water/waternormals.jpg"),
]

API = "https://api.polyhaven.com/files/{}"
UA = {"User-Agent": "hyderabad-boating-asset-fetch/1.0"}


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 1024:
        return dest, os.path.getsize(dest), "cached"
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=300) as r, open(tmp, "wb") as f:
            while True:
                chunk = r.read(1 << 18)
                if not chunk:
                    break
                f.write(chunk)
    except Exception as e:  # noqa: BLE001
        if os.path.exists(tmp):
            os.remove(tmp)
        return dest, 0, "FAIL %s" % e
    os.replace(tmp, dest)
    return dest, os.path.getsize(dest), "ok"


def plan():
    jobs = []
    manifest = {"hdris": {}, "textures": {}, "water": {}, "credits": {
        "polyhaven": "CC0 - https://polyhaven.com",
        "three.js examples": "MIT - https://github.com/mrdoob/three.js",
    }}

    for pid, name in HDRIS.items():
        try:
            files = get_json(API.format(pid))
        except Exception as e:  # noqa: BLE001
            print("! hdri %s: %s" % (pid, e), file=sys.stderr)
            continue
        node = files.get("hdri", {}).get(HDRI_RES, {}).get("hdr")
        if not node:
            print("! hdri %s: no %s hdr" % (pid, HDRI_RES), file=sys.stderr)
            continue
        rel = "hdri/%s.hdr" % name
        jobs.append((node["url"], os.path.join(ASSETS, rel)))
        manifest["hdris"][name] = {"file": rel, "source": pid, "license": "CC0"}

    for pid, name in TEXTURES.items():
        try:
            files = get_json(API.format(pid))
        except Exception as e:  # noqa: BLE001
            print("! tex %s: %s" % (pid, e), file=sys.stderr)
            continue
        entry = {"source": pid, "license": "CC0", "maps": {}}
        for key, short in TEX_MAPS.items():
            node = files.get(key, {}).get(TEX_RES, {}).get("jpg")
            if not node:
                continue
            rel = "textures/%s/%s_%s.jpg" % (name, name, short)
            jobs.append((node["url"], os.path.join(ASSETS, rel)))
            entry["maps"][short] = rel
        if entry["maps"]:
            manifest["textures"][name] = entry

    for url, rel in EXTRA:
        jobs.append((url, os.path.join(ASSETS, rel)))
        manifest["water"]["normals"] = rel

    return jobs, manifest


def main():
    jobs, manifest = plan()
    print("planned %d downloads" % len(jobs))
    total = 0
    fails = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        for dest, size, status in pool.map(lambda j: download(*j), jobs):
            rel = os.path.relpath(dest, ASSETS)
            print("%-9s %8.2f MB  %s" % (status, size / 1e6, rel))
            total += size
            if status.startswith("FAIL"):
                fails.append(rel)
    with open(os.path.join(ASSETS, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print("\n%.1f MB total, %d failures" % (total / 1e6, len(fails)))
    for f in fails:
        print("  failed:", f)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
