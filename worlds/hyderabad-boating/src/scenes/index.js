import { hussainSagar } from './hussainSagar.js';
import { durgamCheruvu } from './durgamCheruvu.js';
import { musiRiver } from './musiRiver.js';
import { villagePond } from './villagePond.js';

export const SCENES = [hussainSagar, durgamCheruvu, musiRiver, villagePond];
export const SCENE_BY_ID = Object.fromEntries(SCENES.map((s) => [s.id, s]));
export { hussainSagar, durgamCheruvu, musiRiver, villagePond };
