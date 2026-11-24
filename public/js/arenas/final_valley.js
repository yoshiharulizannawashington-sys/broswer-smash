// Final Valley arena entry point.
//
// The procedural cliffs, waterfalls, guardian statues and the optional `final_valley.glb` export
// that used to live here have been replaced by the supplied Valley of the End model, mounted at
// arena scale by `arenas/valley_of_the_end.js`. The function signature, the returned group and the
// obstacle list are unchanged so `main.js` keeps owning visibility, collision and the frame update.
import { createValleyOfTheEnd } from './valley_of_the_end.js';

export function createFinalValley(THREE) {
  return createValleyOfTheEnd(THREE);
}
