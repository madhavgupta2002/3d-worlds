# 3D World

Nine explorable 3D worlds behind one interface: a sidebar and gallery shell that hosts each world.

| Category | World | Source |
|---|---|---|
| Space | SkyStreet (map, street view, real sky) | TypeScript, MapLibre, three |
| Space | Solar System | plain JS |
| Places | Earth Atlas | CesiumJS from CDN, needs network |
| Places | Walkable City | three |
| Places | Meadowlane Village, Meadowlane Village v2 | three |
| Buildings | House | three |
| Nature | Creek (Blender `creek.glb` optional) | three |
| Shopping | Orbit Market | React, three-style CSS 3D |

## Run

    npm install
    npm run dev        # http://localhost:5173
    npm run build      # static site in dist/

Shell keys: `M` toggles the menu, `F` toggles fullscreen. Routes are hash-based (`#/house`).

## Layout

- `index.html`, `src/shell/`: the shell (registry of worlds, gallery, sidebar, iframe stage).
- `worlds/<id>/index.html`: one Vite page per world; the build picks them up automatically.
- `public/`: shared static assets (SkyStreet star data, favicon).
- `docs/`: SkyStreet notes and screenshots.

## Adding a world

Create `worlds/<id>/index.html` (import `three` from npm, no CDN importmap) and add an entry to `src/shell/registry.ts`.

## Creek model

`npm run creek:blender` needs Blender and writes `public/creek.glb`; without it Creek uses its built-in fallback.
