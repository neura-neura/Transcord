/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Node } from "@vencord/venmic";
import { ipcRenderer } from "electron/renderer";
import type { IpcMessage, IpcResponse } from "main/ipcCommands";
import {
    DictationPreferences,
    DictationStatus,
    HexModel,
    HexSetting,
    HudUpdate,
    IpcDictation,
    ModelLibrary,
    ModelOperation
} from "shared/dictation";
import type { Settings } from "shared/settings";

import { IpcEvents } from "../shared/IpcEvents";
import { invoke, sendSync } from "./typedIpc";

type SpellCheckerResultCallback = (word: string, suggestions: string[]) => void;

const spellCheckCallbacks = new Set<SpellCheckerResultCallback>();

ipcRenderer.on(IpcEvents.SPELLCHECK_RESULT, (_, w: string, s: string[]) => {
    spellCheckCallbacks.forEach(cb => cb(w, s));
});

let onDevtoolsOpen = () => {};
let onDevtoolsClose = () => {};

ipcRenderer.on(IpcEvents.DEVTOOLS_OPENED, () => onDevtoolsOpen());
ipcRenderer.on(IpcEvents.DEVTOOLS_CLOSED, () => onDevtoolsClose());

export const VesktopNative = {
    app: {
        relaunch: () => invoke<void>(IpcEvents.RELAUNCH),
        getVersion: () => sendSync<void>(IpcEvents.GET_VERSION),
        setBadgeCount: (count: number) => invoke<void>(IpcEvents.SET_BADGE_COUNT, count),
        supportsWindowsTransparency: () => sendSync<boolean>(IpcEvents.SUPPORTS_WINDOWS_TRANSPARENCY),
        getEnableHardwareAcceleration: () => sendSync<boolean>(IpcEvents.GET_ENABLE_HARDWARE_ACCELERATION),
        isOutdated: () => invoke<boolean>(IpcEvents.UPDATER_IS_OUTDATED),
        openUpdater: () => invoke<void>(IpcEvents.UPDATER_OPEN),
        // used by vencord
        getRendererCss: () => invoke<string>(IpcEvents.GET_VESKTOP_RENDERER_CSS),
        onRendererCssUpdate: (cb: (newCss: string) => void) => {
            if (!IS_DEV) return;

            ipcRenderer.on(IpcEvents.VESKTOP_RENDERER_CSS_UPDATE, (_e, newCss: string) => cb(newCss));
        }
    },
    autostart: {
        isEnabled: () => sendSync<boolean>(IpcEvents.AUTOSTART_ENABLED),
        enable: () => invoke<void>(IpcEvents.ENABLE_AUTOSTART),
        disable: () => invoke<void>(IpcEvents.DISABLE_AUTOSTART)
    },
    fileManager: {
        isUsingCustomVencordDir: () => sendSync<boolean>(IpcEvents.IS_USING_CUSTOM_VENCORD_DIR),
        showCustomVencordDir: () => invoke<void>(IpcEvents.SHOW_CUSTOM_VENCORD_DIR),
        selectVencordDir: (value?: null) => invoke<"cancelled" | "invalid" | "ok">(IpcEvents.SELECT_VENCORD_DIR, value),
        chooseUserAsset: (asset: string, value?: null) =>
            invoke<"cancelled" | "invalid" | "ok" | "failed">(IpcEvents.CHOOSE_USER_ASSET, asset, value)
    },
    settings: {
        get: () => sendSync<Settings>(IpcEvents.GET_SETTINGS),
        set: (settings: Settings, path?: string) => invoke<void>(IpcEvents.SET_SETTINGS, settings, path)
    },
    spellcheck: {
        getAvailableLanguages: () => sendSync<string[]>(IpcEvents.SPELLCHECK_GET_AVAILABLE_LANGUAGES),
        onSpellcheckResult(cb: SpellCheckerResultCallback) {
            spellCheckCallbacks.add(cb);
        },
        offSpellcheckResult(cb: SpellCheckerResultCallback) {
            spellCheckCallbacks.delete(cb);
        },
        replaceMisspelling: (word: string) => invoke<void>(IpcEvents.SPELLCHECK_REPLACE_MISSPELLING, word),
        addToDictionary: (word: string) => invoke<void>(IpcEvents.SPELLCHECK_ADD_TO_DICTIONARY, word)
    },
    win: {
        focus: () => invoke<void>(IpcEvents.FOCUS),
        close: (key?: string) => invoke<void>(IpcEvents.CLOSE, key),
        minimize: (key?: string) => invoke<void>(IpcEvents.MINIMIZE, key),
        maximize: (key?: string) => invoke<void>(IpcEvents.MAXIMIZE, key),
        flashFrame: (flag: boolean) => invoke<void>(IpcEvents.FLASH_FRAME, flag),
        setDevtoolsCallbacks: (onOpen: () => void, onClose: () => void) => {
            onDevtoolsOpen = onOpen;
            onDevtoolsClose = onClose;
        }
    },
    capturer: {
        getLargeThumbnail: (id: string) => invoke<string>(IpcEvents.CAPTURER_GET_LARGE_THUMBNAIL, id)
    },
    /** only available on Linux. */
    virtmic: {
        list: () =>
            invoke<
                { ok: false; isGlibCxxOutdated: boolean } | { ok: true; targets: Node[]; hasPipewirePulse: boolean }
            >(IpcEvents.VIRT_MIC_LIST),
        start: (include: Node[]) => invoke<void>(IpcEvents.VIRT_MIC_START, include),
        startSystem: (exclude: Node[]) => invoke<void>(IpcEvents.VIRT_MIC_START_SYSTEM, exclude),
        unmute: () => invoke<void>(IpcEvents.VIRT_MIC_UNMUTE),
        stop: () => invoke<void>(IpcEvents.VIRT_MIC_STOP)
    },
    clipboard: {
        copyImage: (imageBuffer: Uint8Array, imageSrc: string) =>
            invoke<void>(IpcEvents.CLIPBOARD_COPY_IMAGE, imageBuffer, imageSrc)
    },
    debug: {
        launchGpu: () => invoke<void>(IpcEvents.DEBUG_LAUNCH_GPU),
        launchWebrtcInternals: () => invoke<void>(IpcEvents.DEBUG_LAUNCH_WEBRTC_INTERNALS)
    },
    rpc: {
        ready: () => invoke<void>(IpcEvents.RPC_READY),
        send: (id: string, json: string) => invoke<void>(IpcEvents.RPC_SEND, id, json),
        close: (id: string, code: number, message?: string) => invoke<void>(IpcEvents.RPC_CLOSE, id, code, message)
    },
    dictation: {
        preferences: () => invoke<{ preferences: DictationPreferences; shortcut: string }>(IpcDictation.GetPreferences),
        hud: (data: HudUpdate) => invoke<void>(IpcDictation.HudUpdate, data),
        speechPreview: (wav: Uint8Array) => invoke<string>(IpcDictation.SpeechPreview, wav),
        library: () => invoke<ModelLibrary>(IpcDictation.Library),
        modelAction: (operation: ModelOperation) =>
            invoke<{ result?: string; error?: string }>(IpcDictation.ModelAction, operation),
        cancelModelAction: () => invoke<void>(IpcDictation.ModelCancel),
        onModelProgress: (cb: (text: string) => void) => {
            const listener = (_: Electron.IpcRendererEvent, text: string) => cb(text);
            ipcRenderer.on(IpcDictation.ModelProgress, listener);
            return () => {
                ipcRenderer.removeListener(IpcDictation.ModelProgress, listener);
            };
        },
        hexSettings: () => invoke<HexSetting[]>(IpcDictation.HexSettings),
        saveHexSetting: (key: string, value: unknown) => invoke<string>(IpcDictation.HexSettingSave, key, value),
        models: () =>
            invoke<{
                hex: HexModel[] | null;
                ollama: string[] | null;
                detected: string[];
                issues?: ModelLibrary["issues"];
            }>(IpcDictation.Models),
        savePreferences: (options: DictationPreferences) => invoke<string>(IpcDictation.SavePreferences, options),
        status: (status: DictationStatus) => invoke<void>(IpcDictation.Status, status),
        hex: (wav?: Uint8Array, intermediate = false) => invoke<string>(IpcDictation.Hex, wav, intermediate),
        translate: (text: string) => invoke<string>(IpcDictation.Translate, text),
        onTranslationProgress: (cb: (text: string) => void) => {
            ipcRenderer.on(IpcDictation.TranslationProgress, (_, partial: string) => cb(partial));
        }
    },
    commands: {
        onCommand(cb: (message: IpcMessage) => void) {
            ipcRenderer.on(IpcEvents.IPC_COMMAND, (_, message) => cb(message));
        },
        respond: (response: IpcResponse) => ipcRenderer.send(IpcEvents.IPC_COMMAND, response)
    }
};
