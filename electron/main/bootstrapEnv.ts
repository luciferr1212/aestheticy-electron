// MUST be the first import of electron/main/index.ts.
// ES module imports are evaluated in order, so by the time the services below are loaded
// the data directory is already pointing at the per-user Electron `userData` folder.
import { app } from 'electron';
import path from 'path';

if (app.isPackaged && !process.env.AESTHETICY_DATA_DIR) {
  process.env.AESTHETICY_DATA_DIR = path.join(app.getPath('userData'), 'data');
}
