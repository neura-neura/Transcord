/* SPDX-License-Identifier: GPL-3.0-or-later */

import { join } from "path";

import { BrowserWindow, ipcMain, screen } from "electron";
import { HudState, IpcDictation } from "shared/dictation";

import { loadView } from "./vesktopStatic";

let main: BrowserWindow | undefined;
let overlay: BrowserWindow | undefined;
let enabled = false;
let ready = false;
let foreground = false;
let state: HudState = {};

export function initDictationHud(window: BrowserWindow, stop: () => void) {
    main = window;
    foreground = window.isFocused();
    ipcMain.handle(IpcDictation.HudStop, event => {
        if (!overlay || event.sender.id !== overlay.webContents.id || event.senderFrame !== event.sender.mainFrame)
            return;
        stop();
    });
    const markForeground = () => showDictationMainWindow(window);
    const markBackground = () => {
        foreground = false;
        syncHud();
    };
    window.on("blur", markBackground);
    window.on("focus", markForeground);
    window.on("show", markForeground);
    window.on("hide", markBackground);
    window.on("minimize", markBackground);
    window.on("restore", markForeground);
    window.once("closed", () => {
        ipcMain.removeHandler(IpcDictation.HudStop);
        overlay?.destroy();
        overlay = undefined;
        main = undefined;
        enabled = ready = foreground = false;
        state = {};
    });
}

export function showDictationMainWindow(window: BrowserWindow) {
    if (main !== window) return;
    foreground = true;
    syncHud();
}

export function setDictationHud(update: HudState) {
    for (const key of Object.keys(update) as (keyof HudState)[]) {
        if (update[key] !== undefined) Object.assign(state, { [key]: update[key] });
    }
    syncHud();
}

export function refreshDictationHud(active: boolean) {
    enabled = active;
    if (!enabled) state = {};
    syncHud();
}

function syncHud() {
    const visible = enabled && main && !main.isDestroyed() && !foreground && !main.isFocused();
    if (!visible) {
        if (overlay?.isVisible()) overlay.hide();
        return;
    }
    if (!overlay) {
        const { workArea } = screen.getDisplayMatching(main!.getBounds());
        const width = Math.min(350, workArea.width);
        const height = Math.min(270, workArea.height);
        overlay = new BrowserWindow({
            x: workArea.x + workArea.width - width - 20,
            y: workArea.y + workArea.height - height - 20,
            width,
            height,
            show: false,
            frame: false,
            transparent: true,
            hasShadow: false,
            skipTaskbar: true,
            resizable: false,
            fullscreenable: false,
            webPreferences: {
                preload: join(__dirname, "dictationHudPreload.js"),
                contextIsolation: true,
                sandbox: true,
                backgroundThrottling: false
            }
        });
        overlay.setAlwaysOnTop(true, "screen-saver");
        overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        overlay.webContents.on("will-navigate", event => event.preventDefault());
        overlay.once("closed", () => {
            overlay = undefined;
            ready = false;
        });
        void loadView(overlay, "dictation-hud.html").then(
            () => {
                ready = true;
                syncHud();
            },
            () => overlay?.destroy()
        );
    }
    if (ready && overlay) {
        if (!overlay.isVisible()) overlay.showInactive();
        overlay.webContents.send(IpcDictation.HudState, state);
    }
}
