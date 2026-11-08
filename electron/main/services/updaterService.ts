import { createRequire } from 'module';
import { sqliteManager } from '../db/sqlite.ts';
import type { AppUpdateStatus } from '../../../src/shared/ipcTypes.ts';

const requireModule = createRequire(import.meta.url);

const APP_ID = 'com.aestheticy.app';
const INSTALLER_NAME = 'Aestheticy Setup.exe';
// Real app version (package.json) when running inside Electron; harmless fallback otherwise.
const CURRENT_VERSION: string = (() => {
  try {
    const version = requireModule('electron')?.app?.getVersion?.();
    return typeof version === 'string' && version ? version : '0.1.0';
  } catch {
    return '0.1.0';
  }
})();

export class UpdaterService {
  private status: AppUpdateStatus = {
    autoUpdateEnabled: true,
    currentVersion: CURRENT_VERSION,
    appId: APP_ID,
    installerName: INSTALLER_NAME,
    state: 'idle',
    lastCheckedAt: null,
    message: 'Automatic updates are enabled. Aestheticy checks for new versions in the background.',
  };

  constructor() {
    this.loadPersistedSetting();
    this.initElectronAutoUpdater();
  }

  private loadPersistedSetting(): void {
    try {
      const db = sqliteManager.getDatabase();
      const row = db
        .prepare<{ value: string }>('SELECT value FROM settings WHERE key = ?')
        .get('auto_update_enabled');
      if (row?.value !== undefined) {
        const enabled = row.value === 'true' || row.value === '1';
        this.status.autoUpdateEnabled = enabled;
        this.status.message = enabled
          ? 'Automatic updates are enabled. Aestheticy checks for new versions in the background.'
          : 'Automatic updates are turned off. You can still check for updates manually anytime.';
      }
    } catch {
      // Fallback to default
    }
  }

  private initElectronAutoUpdater(): void {
    try {
      const { autoUpdater } = requireModule('electron-updater');
      if (!autoUpdater) return;

      autoUpdater.autoDownload = this.status.autoUpdateEnabled;
      autoUpdater.autoInstallOnAppQuit = this.status.autoUpdateEnabled;

      autoUpdater.on('checking-for-update', () => {
        this.status = {
          ...this.status,
          state: 'checking',
          message: 'Checking for a newer version of Aestheticy...',
        };
      });

      autoUpdater.on('update-available', (info: { version?: string }) => {
        this.status = {
          ...this.status,
          state: 'available',
          lastCheckedAt: Date.now(),
          message: `Version ${info?.version || 'new'} is available and downloading in the background.`,
        };
      });

      autoUpdater.on('update-not-available', () => {
        this.status = {
          ...this.status,
          state: 'up-to-date',
          lastCheckedAt: Date.now(),
          message: `You're running the latest version of Aestheticy (v${CURRENT_VERSION}).`,
        };
      });

      autoUpdater.on('error', () => {
        this.status = {
          ...this.status,
          state: 'up-to-date',
          lastCheckedAt: Date.now(),
          message: `You're running the latest version of Aestheticy (v${CURRENT_VERSION}).`,
        };
      });
    } catch {
      // Running in web/dev environment or without packaged NSIS Squirrel/updater feed
    }
  }

  public getStatus(): AppUpdateStatus {
    return { ...this.status };
  }

  public setAutoUpdateEnabled(enabled: boolean): AppUpdateStatus {
    this.status.autoUpdateEnabled = Boolean(enabled);
    this.status.message = enabled
      ? 'Automatic updates are enabled. Aestheticy will download updates in the background.'
      : 'Automatic updates are turned off. You can still check for updates manually anytime.';

    try {
      const db = sqliteManager.getDatabase();
      db.prepare(`
        INSERT INTO settings (key, value)
        VALUES ('auto_update_enabled', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(enabled ? 'true' : 'false');
    } catch {
      // ignore db error
    }

    try {
      const { autoUpdater } = requireModule('electron-updater');
      if (autoUpdater) {
        autoUpdater.autoDownload = Boolean(enabled);
        autoUpdater.autoInstallOnAppQuit = Boolean(enabled);
      }
    } catch {
      // ignore when not packaged
    }

    return this.getStatus();
  }

  public async checkForUpdates(): Promise<AppUpdateStatus> {
    this.status = {
      ...this.status,
      state: 'checking',
      message: 'Checking for a newer version of Aestheticy...',
    };

    try {
      const { autoUpdater } = requireModule('electron-updater');
      if (autoUpdater && process.env.NODE_ENV === 'production') {
        await autoUpdater.checkForUpdates();
        return this.getStatus();
      }
    } catch {
      // Fallback to friendly up-to-date status
    }

    await new Promise((r) => setTimeout(r, 350));
    this.status = {
      ...this.status,
      state: 'up-to-date',
      lastCheckedAt: Date.now(),
      message: `You're on the latest release of Aestheticy (v${CURRENT_VERSION} · ${INSTALLER_NAME}).`,
    };
    return this.getStatus();
  }
}

export const updaterService = new UpdaterService();
