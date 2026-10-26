/**
 * Burg's desktop shell.
 *
 * The app is still the Next.js app: server components, server actions, and
 * the database inside the server process. What Electron adds is a way to run
 * that server on this Mac without a terminal, and a window to look at it in.
 *
 *   1. Start the standalone Next server (`.next/standalone/server.js`) as an
 *      Electron utility process -- Electron's own Node, so nothing needs
 *      installing -- on a free loopback port, with the database pointed at
 *      ~/Library/Application Support/Burg/data.
 *   2. Give it a random launch token, and give the window the same token as a
 *      cookie. proxy.ts refuses any request without it, so the port answers
 *      nothing to other programs or other accounts on the machine.
 *   3. On quit, ask the server to close the database before it exits, so the
 *      files are left as a clean checkpoint rather than a crash to recover.
 *
 * Plain ESM with no build step, and no dependencies beyond Electron: this
 * directory is the whole of the app bundle's own code.
 */
import { app, BrowserWindow, dialog, Menu, session, shell, utilityProcess } from "electron";
import { randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

/** Kept in step with proxy.ts, which checks it. */
const LAUNCH_COOKIE = "burg-launch";

/** `BURG_DATA_DIR` points a test run somewhere other than the real city. */
const DATA_DIR = process.env.BURG_DATA_DIR ?? path.join(app.getPath("userData"), "data");
const LOG_FILE = path.join(app.getPath("logs"), "server.log");

/** Packaged, the server ships as a resource; from a checkout it is the last standalone build. */
const SERVER_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "server")
  : path.join(import.meta.dirname, "..", ".next", "standalone");

/** @type {Electron.UtilityProcess | null} */
let server = null;
let origin = "";
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  // A second copy would try to open the same database. Hand over and leave.
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(launch).catch(fail);
}

async function launch() {
  Menu.setApplicationMenu(menu());
  mkdirSync(DATA_DIR, { recursive: true });

  const port = await freePort();
  const token = randomBytes(32).toString("hex");
  origin = `http://127.0.0.1:${port}`;

  mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const log = createWriteStream(LOG_FILE, { flags: "w" });

  server = utilityProcess.fork(path.join(SERVER_DIR, "server.js"), [], {
    cwd: SERVER_DIR,
    serviceName: "Burg server",
    stdio: "pipe",
    env: {
      ...withoutRunAsNode(process.env),
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      BURG_DATA_DIR: DATA_DIR,
      BURG_LAUNCH_TOKEN: token,
    },
  });
  server.stdout?.pipe(log);
  server.stderr?.pipe(log);
  server.once("exit", (code) => {
    server = null;
    if (!quitting) fail(new Error(`The Burg server stopped unexpectedly (exit code ${code}).`));
  });

  await session.defaultSession.cookies.set({
    url: origin,
    name: LAUNCH_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "strict",
  });

  await waitForServer();
  openWindow();

  // macOS keeps an app running with no windows; the dock icon brings one back.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });
}

/** The server is a utility process, not `node`; an inherited RUN_AS_NODE means nothing to it but noise. */
function withoutRunAsNode(env) {
  const rest = { ...env };
  delete rest.ELECTRON_RUN_AS_NODE;
  return rest;
}

function openWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Burg",
    backgroundColor: "#f2efe4",
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });

  // Pixel art is drawn at integer zoom steps so it never resamples; a pinch
  // would scale the whole page by a fraction and blur every sprite. The map
  // has its own zoom, and the View menu deliberately has no zoom items. The
  // limit needs a live page, so it is set once each load has finished.
  win.webContents.on("did-finish-load", () => {
    win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  });

  // Anything off this server -- a link in a document, a newsstand clipping --
  // opens in the real browser, never inside the app's window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== origin) {
      event.preventDefault();
      openOutside(url);
    }
  });

  win.once("ready-to-show", () => win.show());
  win.loadURL(`${origin}/city`);
}

function openOutside(url) {
  const { protocol } = new URL(url);
  if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") shell.openExternal(url);
}

/** Poll until the server answers anything at all; the proxy's 403 counts. */
async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (!server) throw new Error("The Burg server exited while starting.");
    try {
      await fetch(origin, { signal: AbortSignal.timeout(2000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error("The Burg server did not start within a minute.");
}

/** Let the OS pick a port nothing else is using, then give it back for the server to take. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

app.on("before-quit", (event) => {
  if (!server || quitting) return;
  quitting = true;
  event.preventDefault();

  const stopping = server;
  const force = setTimeout(() => stopping.kill(), 5000);
  stopping.once("exit", () => {
    clearTimeout(force);
    app.quit();
  });
  stopping.postMessage("shutdown");
});

function fail(error) {
  if (quitting) return;
  quitting = true;
  dialog.showErrorBox(
    "Burg could not start",
    `${error instanceof Error ? error.message : String(error)}\n\nThe server's log is at:\n${LOG_FILE}`,
  );
  server?.kill();
  app.exit(1);
}

function menu() {
  return Menu.buildFromTemplate([
    { role: "appMenu" },
    {
      label: "File",
      submenu: [
        {
          label: "Show Data Folder",
          click: () => shell.openPath(DATA_DIR),
        },
        {
          label: "Show Server Log",
          click: () => shell.showItemInFolder(LOG_FILE),
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    // Without an Edit menu, ⌘C, ⌘V and ⌘Z do nothing in an Electron window.
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ]);
}
