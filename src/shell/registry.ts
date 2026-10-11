export type Category = 'Space' | 'Places' | 'Buildings' | 'Nature';

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
  { id: 'solar-system', name: 'Solar System', category: 'Space', accent: '#ffb347',
    blurb: 'The Sun and its planets in orbit.',
    hint: 'Drag to orbit, scroll to zoom' },
  { id: 'walkable-city', name: 'Walkable City', category: 'Places', accent: '#b0bec5',
    blurb: 'Walk the streets of a small city in first person.',
    hint: 'Click to capture the mouse, WASD to move' },
  { id: 'house', name: 'House', category: 'Buildings', accent: '#ffcc80',
    blurb: 'A three-room house with windows, a front entrance and a back wall.',
    hint: 'Look around inside' },
  { id: 'creek', name: 'Creek', category: 'Nature', accent: '#80cbc4',
    blurb: 'A forest creek with water, terrain and sky. Loads creek.glb from Blender when present.',
    hint: 'Drag to look around' },
];

export const byId = (id: string) => WORLDS.find((w) => w.id === id);
