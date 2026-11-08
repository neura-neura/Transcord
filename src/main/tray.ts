/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow, Menu, Tray } from "electron";
import { DictationLanguage, LANGUAGES, PAUSES } from "shared/dictation";
import { sleep } from "shared/utils/sleep";

import { createAboutWindow } from "./about";
import { isStatusNotifierHostRegistered } from "./dbus";
import {
    dictationTrayState,
    observeDictation,
    setDictationLanguage,
    setDictationPause,
    toggleDictation
} from "./dictation";
import { AppEvents } from "./events";
import { Settings } from "./settings";
import { resolveAssetPath } from "./userAssets";
import { clearData } from "./utils/clearData";
import { relaunch } from "./utils/relaunch";
import { showWindow } from "./utils/showWindow";
import { downloadVencordFiles } from "./utils/vencordLoader";

let tray: Tray | undefined;
let unobserveDictation: (() => void) | undefined;
let trayVariant: "tray" | "trayUnread" = "tray";

// resolve the image before checking tray, as it might get destroyed in the meantime
AppEvents.on("userAssetChanged", async asset => {
    if (asset !== "tray" && asset !== "trayUnread") return;

    const image = await resolveAssetPath(trayVariant);
    tray?.setImage(image);
});

AppEvents.on("setTrayVariant", async variant => {
    if (trayVariant === variant) return;

    trayVariant = variant;
    const image = await resolveAssetPath(trayVariant);
    tray?.setImage(image);
});

export function destroyTray() {
    unobserveDictation?.();
    unobserveDictation = undefined;
    tray?.destroy();
    tray = undefined;
}

// Chromium gives up on the tray if no StatusNotifierHost is registered when it is created and never retries.
// This happens when we are autostarted before the desktop shell is ready, so wait for it first
async function waitForStatusNotifierHost() {
    if (process.platform !== "linux") return;

    for (let i = 0; i < 30; i++) {
        if (isStatusNotifierHostRegistered()) return;

        await sleep(1000);
    }

    console.warn(
        "StatusNotifierHost not registered after 30 seconds. Vesktop's Tray will likely not function correctly.\n" +
            "If you are on GNOME, make sure you installed & enabled the AppIndicator and KStatusNotifierItem Support extension:\n" +
            "https://extensions.gnome.org/extension/615/appindicator-support/"
    );
}

export async function initTray(win: BrowserWindow, setIsQuitting: (val: boolean) => void) {
    const onTrayClick = () => {
        if (Settings.store.clickTrayToShowHide && win.isVisible()) win.hide();
        else showWindow(win);
    };

    const refreshMenu = () => {
        if (!tray) return;
        const { phase, target, detail, shortcut, pause, source, translationTarget } = dictationTrayState();
        const languageMenu = (field: "source" | "translationTarget") =>
            (Object.keys(LANGUAGES) as DictationLanguage[]).map(code => ({
                label: LANGUAGES[code].label,
                type: "radio" as const,
                checked: (field === "source" ? source : translationTarget) === code,
                enabled: field === "source" || code !== source,
                click: () => {
                    setDictationLanguage(field, code);
                    refreshMenu();
                }
            }));
        const active = phase !== "idle" && phase !== "error";
        const action = active ? "Detener dictado" : "Activar dictado en este chat";
        const phaseLabel = {
            idle: "Micrófono apagado",
            starting: "Preparando Hex",
            listening: "Escuchando",
            speech: "Dictando",
            transcribing: "Transcribiendo",
            error: "Dictado detenido"
        }[phase];
        tray.setToolTip(["Transcord", phaseLabel, target].filter(Boolean).join(" · ").slice(0, 127));
        tray.setContextMenu(
            Menu.buildFromTemplate([
                ...(process.platform === "win32"
                    ? [
                          { label: action + (shortcut ? " · " + shortcut : ""), click: toggleDictation },
                          {
                              label: (detail ?? [phaseLabel, target].filter(Boolean).join(" · ")).slice(0, 110),
                              enabled: false
                          },
                          {
                              label: "Pausa antes de enviar",
                              enabled: !active,
                              submenu: PAUSES.map(value => ({
                                  label: (value / 1000).toLocaleString("es-MX") + " s",
                                  type: "radio" as const,
                                  checked: value === pause,
                                  click: () => {
                                      setDictationPause(value);
                                      refreshMenu();
                                  }
                              }))
                          },
                          { label: "Idioma del dictado", enabled: !active, submenu: languageMenu("source") },
                          {
                              label: "Traducir con Ollama",
                              enabled: !active,
                              submenu: [
                                  {
                                      label: "Desactivado",
                                      type: "radio" as const,
                                      checked: !translationTarget,
                                      click: () => {
                                          setDictationLanguage("translationTarget");
                                          refreshMenu();
                                      }
                                  },
                                  ...languageMenu("translationTarget")
                              ]
                          },
                          { type: "separator" as const }
                      ]
                    : []),
                {
                    label: "Open",
                    click() {
                        showWindow(win);
                    }
                },
                {
                    label: "About",
                    click: createAboutWindow
                },
                {
                    label: "Repair Vencord",
                    async click() {
                        await downloadVencordFiles();
                        relaunch();
                    }
                },
                {
                    label: "Reset Vesktop",
                    async click() {
                        await clearData(win);
                    }
                },
                {
                    type: "separator"
                },
                {
                    label: "Restart",
                    click: relaunch
                },
                {
                    label: "Quit",
                    click() {
                        setIsQuitting(true);
                        app.quit();
                    }
                }
            ])
        );
    };

    await waitForStatusNotifierHost();
    if (Settings.store.tray === false) return;

    tray = new Tray(await resolveAssetPath(trayVariant));
    unobserveDictation = observeDictation(refreshMenu);
    refreshMenu();
    tray.on("click", onTrayClick);
}
