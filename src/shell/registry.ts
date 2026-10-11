export type Category = 'Space' | 'Places' | 'Buildings' | 'Nature' | 'Shopping';

export interface World {
  id: string;
  name: string;
  category: Category;
  blurb: string;
  hint: string;
  accent: string;
}

// Each id maps to worlds/<id>/index.html.
export const WORLDS: World[] = [
  { id: 'skystreet', name: 'SkyStreet', category: 'Space', accent: '#7aa2ff',
    blurb: 'Pick any place on a 3D map, drop into street view and see the real sky above it.',
    hint: 'Search a place, drag the time bar' },
  { id: 'solar-system', name: 'Solar System', category: 'Space', accent: '#ffb347',
    blurb: 'The Sun and its planets in orbit.',
    hint: 'Drag to orbit, scroll to zoom' },
  { id: 'earth-atlas', name: 'Earth Atlas', category: 'Places', accent: '#4fc3f7',
    blurb: 'A 3D globe you can spin and zoom (CesiumJS, needs network).',
    hint: 'Drag to rotate, scroll to zoom' },
  { id: 'walkable-city', name: 'Walkable City', category: 'Places', accent: '#b0bec5',
    blurb: 'Walk the streets of a small city in first person.',
    hint: 'Click to capture the mouse, WASD to move' },
  { id: 'meadowlane-village', name: 'Meadowlane Village', category: 'Places', accent: '#9ccc65',
    blurb: 'A village of homes and lanes to explore.',
    hint: 'See the on-screen controls' },
  { id: 'meadowlane-village-v2', name: 'Meadowlane Village v2', category: 'Places', accent: '#66bb6a',
    blurb: 'The second, richer take on Meadowlane Village.',
    hint: 'See the on-screen controls' },
  { id: 'house', name: 'House', category: 'Buildings', accent: '#ffcc80',
    blurb: 'A three-room house with windows, a front entrance and a back wall.',
    hint: 'Look around inside' },
  { id: 'creek', name: 'Creek', category: 'Nature', accent: '#80cbc4',
    blurb: 'A forest creek with water, terrain and sky. Loads creek.glb from Blender when present.',
    hint: 'Drag to look around' },
  { id: 'orbit-market', name: 'Orbit Market', category: 'Shopping', accent: '#ff8a65',
    blurb: 'An immersive three-dimensional shopping experience.',
    hint: 'Browse products in 3D' },
];

export const byId = (id: string) => WORLDS.find((w) => w.id === id);
