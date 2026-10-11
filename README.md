# 3D Worlds

Four explorable 3D worlds behind one interface: a sidebar and gallery shell that hosts each world.

| Category | World | Notes |
|---|---|---|
| Space | Solar System | plain JS |
| Places | Walkable City | first-person, three.js |
| Buildings | House | three-room house and gardens |
| Nature | Creek | forest creek; loads `creek.glb` from Blender when present |

## Run

    npm install
    npm run dev        # http://localhost:5173
    npm run build      # static site in dist/

Shell keys: `M` toggles the menu, `F` toggles fullscreen. Routes are hash-based (`#/house`).

## Layout

- `index.html`, `src/shell/`: the shell (world registry, gallery, sidebar, iframe stage).
- `worlds/<id>/index.html`: one Vite page per world; the build picks them up automatically.

## Adding a world

Create `worlds/<id>/index.html` (import `three` from npm, no CDN importmap) and add an entry to `src/shell/registry.ts`.

## Creek model

`npm run creek:blender` needs Blender and writes `public/creek.glb`; without it Creek uses its built-in fallback.

## Related projects

SkyStreet and Earth Atlas live on as `3d-earth`, Meadowlane Village is its own project, and Orbit Market moved to the Amazon projects.
