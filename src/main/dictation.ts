/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { join } from "path";

import { app, BrowserWindow, globalShortcut, Notification, powerMonitor } from "electron";
import {
    DEFAULT_OLLAMA_MODEL,
    DEFAULT_SHORTCUT,
    DictationLanguage,
    DictationPreferences,
    ModelOperation,
    DictationStatus,
    IpcDictation,
    HudUpdate,
    HudPhase,
    MAX_TRANSCRIPT_LENGTH,
    discordText,
    LANGUAGES,
    PAUSES,
    supportsDictationLanguage
} from "shared/dictation";

import { DATA_DIR } from "./constants";
import { initDictationHud, refreshDictationHud, setDictationHud } from "./dictationHud";
import { openHexEngine } from "./hexEngine";
import { sendRendererCommand } from "./ipcCommands";
import { listOllamaModels, translateLocal } from "./localTranslation";
import { mainWin } from "./mainWindow";
import {
    changeHexModel,
    checkHexDownloadSpace,
    engineResources,
    hexEnv,
    hexExe,
    hexList,
    hexSettings,
    referenceDetectedHex,
    setHexSetting
} from "./managedHex";
import {
    configureOllama,
    detectedOllamaModels,
    detectedOllamaLocation,
    ollamaMutation,
    stopOllama
} from "./managedOllama";
import { ModelStorageError } from "./modelStorage";
import { State } from "./settings";
import { handle } from "./utils/ipcWrappers";
import { showWindow } from "./utils/showWindow";

let maintenance: AbortController | undefined;
const defaultModel = "parakeet_v3";
let engine: Awaited<ReturnType<typeof openHexEngine>> | undefined;
let selectedModel: string | undefined;
let job: AbortController | undefined;
let status: DictationStatus = { phase: "idle" };
function preferences(): DictationPreferences {
    return {
        pause: 1500,
        source: "es",
        hexModel: "",
        ollamaModel: DEFAULT_OLLAMA_MODEL,
        accelerator: DEFAULT_SHORTCUT,
        ...State.store.dictation
    };
}
let activeOptions: DictationPreferences | undefined;
let shortcut = "";
let dictationNotice: Notification | undefined;
app.on("before-quit", () => {
    maintenance?.abort();
    stopOllama();
});
const listeners = new Set<() => void>();

async function prepare(signal: AbortSignal, { source, hexModel }: DictationPreferences) {
    if (engine && selectedModel) return;
    const compatible = (await hexList(signal)).filter(m => supportsDictationLanguage(m, source));
    const available = compatible.filter(m => m.installed || m.detected);
    const fallback = source === "zh" ? "sense_voice_small" : defaultModel;
    const model = hexModel
        ? compatible.find(m => m.id === hexModel)
        : (available.find(m => m.selected) ??
          available.find(m => m.id === fallback) ??
          available[0] ??
          compatible.find(m => m.id === fallback));
    if (!model) throw new Error("El modelo no admite este idioma.");
    await referenceDetectedHex(model);
    await checkHexDownloadSpace(model);
    if (!model.installed && !model.detected)
        update({ ...status, detail: "Descargando " + model.name + " (" + model.size + ")…" });
    const helper = await openHexEngine(hexExe(), signal, hexEnv());
    try {
        await helper.prepare(model.id, AbortSignal.any([signal, AbortSignal.timeout(40 * 60_000)]), source);
        signal.throwIfAborted();
        engine = helper;
        selectedModel = model.id;
    } catch (error) {
        helper.close();
        throw error;
    }
}

function closeEngine() {
    const previousJob = job;
    job = undefined;
    previousJob?.abort();
    engine?.close();
    engine = undefined;
    selectedModel = undefined;
}

function update(next: DictationStatus) {
    status = next;
    const hasTarget = next.phase !== "idle" && next.phase !== "error" && Boolean(next.target);
    if (hasTarget && next.phase === "starting")
        setDictationHud({
            phase: "starting",
            target: next.target,
            text: "",
            motion: activeOptions?.hudMotion !== false,
            incoming: { author: "", text: "" }
        });
    refreshDictationHud(hasTarget && Boolean(activeOptions?.floatingHud));
    for (const listener of listeners) listener();
}

function dictationError(detail: string) {
    update({ phase: "error", detail });
    const window = mainWin;
    if (!window || window.isDestroyed() || window.isFocused() || !Notification.isSupported()) return;
    dictationNotice?.close();
    const notice = new Notification({ title: "Transcord", body: detail, silent: true });
    dictationNotice = notice;
    notice.once("click", () => {
        if (!window.isDestroyed()) showWindow(window);
    });
    notice.once("close", () => {
        if (dictationNotice === notice) dictationNotice = undefined;
    });
    notice.show();
}

export function observeDictation(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function dictationTrayState() {
    return { ...status, shortcut, ...preferences() };
}

export function setDictationPause(value: number) {
    if (PAUSES.some(item => item === value)) State.store.dictation = { ...preferences(), pause: value };
}

export function setDictationLanguage(field: "source" | "translationTarget", language?: DictationLanguage) {
    const options = preferences();
    if (field === "source" && language && Object.hasOwn(LANGUAGES, language)) {
        if (options.source !== language) options.hexModel = "";
        options.source = language;
        if (options.translationTarget === language) options.translationTarget = undefined;
    } else if (
        field === "translationTarget" &&
        (!language || (language !== options.source && Object.hasOwn(LANGUAGES, language)))
    ) {
        options.translationTarget = language;
    }
    State.store.dictation = options;
}

export function stopDictation() {
    activeOptions = undefined;
    closeEngine();
    if (mainWin && !mainWin.isDestroyed()) {
        void sendRendererCommand(IpcDictation.Stop, undefined, 3000).catch(() => {});
    }
    update({ phase: "idle" });
}

export function toggleDictation() {
    if (status.phase !== "idle" && status.phase !== "error") return stopDictation();
    if (maintenance || !mainWin || mainWin.isDestroyed()) return;
    dictationNotice?.close();
    const options = (activeOptions = preferences());
    update({ phase: "starting" });
    void sendRendererCommand(IpcDictation.Start, options, 5000).catch(() => {
        if (activeOptions !== options) return;
        stopDictation();
        dictationError("Discord todavía no está listo. Abre un chat e inténtalo de nuevo.");
    });
}

export function initDictation(win: BrowserWindow) {
    if (process.platform !== "win32") return;
    configureOllama({
        executable: join(engineResources(), "ollama", "ollama.exe"),
        models: join(DATA_DIR, "Ollama", "models"),
        external: process.env.OLLAMA_MODELS || join(app.getPath("home"), ".ollama", "models")
    });
    initDictationHud(win, stopDictation);
    if (!registerShortcut(preferences().accelerator)) registerShortcut("Control+Alt+F9");
    const onSuspend = () => stopDictation();
    powerMonitor.on("suspend", onSuspend);
    powerMonitor.on("lock-screen", onSuspend);
    win.webContents.on("render-process-gone", onSuspend);
    win.webContents.on("did-start-navigation", ({ isMainFrame, isSameDocument }) => {
        if (isMainFrame && !isSameDocument) stopDictation();
    });
    win.once("closed", () => {
        dictationNotice?.close();
        closeEngine();
        if (shortcut) globalShortcut.unregister(shortcut);
        shortcut = "";
        powerMonitor.off("suspend", onSuspend);
        powerMonitor.off("lock-screen", onSuspend);
        update({ phase: "idle" });
    });
}

handle(IpcDictation.Status, (event, next: DictationStatus) => {
    if (event.sender !== mainWin?.webContents || event.senderFrame !== event.sender.mainFrame) return;
    if (!activeOptions) return;
    if (next?.phase === "idle" || next?.phase === "error") {
        activeOptions = undefined;
        closeEngine();
    }
    if (next?.phase === "error" && typeof next.detail === "string") dictationError(next.detail);
    else if (["idle", "starting", "listening", "speech", "transcribing", "error"].includes(next?.phase)) update(next);
});

handle(IpcDictation.Hex, async (event, wav?: Uint8Array, intermediate?: boolean) => {
    if (
        event.sender !== mainWin?.webContents ||
        event.senderFrame !== event.sender.mainFrame ||
        job ||
        !activeOptions
    ) {
        throw new Error("Hex está ocupado.");
    }
    if (wav !== undefined && (!(wav instanceof Uint8Array) || wav.length < 44 || wav.length > 810_000)) {
        throw new Error("El audio no tiene un tamaño válido.");
    }
    const expectedPhase = !wav ? "starting" : intermediate === true ? "speech" : "transcribing";
    if (status.phase !== expectedPhase) throw new Error("Dictado detenido.");
    const controller = (job = new AbortController());
    const { signal } = controller;
    try {
        const { source } = activeOptions;
        await prepare(signal, activeOptions);
        if (!wav) return "";
        return await engine!.transcribe(
            selectedModel!,
            wav,
            AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
            source
        );
    } catch (error) {
        if (job === controller) closeEngine();
        if (error instanceof ModelStorageError) throw error;
        throw new Error(
            "Hex no pudo preparar el modelo o transcribir. Comprueba la conexión y vuelve a activar el dictado."
        );
    } finally {
        if (job === controller) job = undefined;
    }
});

handle(IpcDictation.Translate, async (event, text: string) => {
    if (
        event.sender !== mainWin?.webContents ||
        event.senderFrame !== event.sender.mainFrame ||
        status.phase !== "transcribing" ||
        !activeOptions?.translationTarget ||
        job ||
        typeof text !== "string" ||
        !text.trim() ||
        text.length > MAX_TRANSCRIPT_LENGTH
    )
        throw new Error("Traducción no disponible.");
    const controller = (job = new AbortController());
    try {
        const { translationTarget, ollamaModel } = activeOptions;
        return await translateLocal(
            text,
            translationTarget,
            controller.signal,
            partial => {
                if (!controller.signal.aborted && !event.sender.isDestroyed())
                    event.sender.send(IpcDictation.TranslationProgress, partial);
                if (!controller.signal.aborted && activeOptions?.floatingHud)
                    setDictationHud({
                        phase: "translating",
                        text: partial,
                        estimated: false,
                        used: discordText(partial).length
                    });
            },
            ollamaModel
        );
    } finally {
        if (job === controller) job = undefined;
    }
});

function registerShortcut(key: string) {
    if (shortcut === key) return true;
    try {
        if (!globalShortcut.register(key, () => toggleDictation())) return false;
    } catch {
        return false;
    }
    if (shortcut) globalShortcut.unregister(shortcut);
    shortcut = key;
    return true;
}

handle(IpcDictation.GetPreferences, event => {
    if (event.sender !== mainWin?.webContents || event.senderFrame !== event.sender.mainFrame)
        throw new Error("Ventana inválida.");
    return { preferences: preferences(), shortcut };
});

handle(IpcDictation.Models, async event => {
    if (event.sender !== mainWin?.webContents || event.senderFrame !== event.sender.mainFrame)
        throw new Error("Ventana inválida.");
    const [hex, ollama, detected] = await Promise.allSettled([hexList(), listOllamaModels(), detectedOllamaModels()]);
    return {
        hex: hex.status === "fulfilled" ? hex.value : null,
        ollama: ollama.status === "fulfilled" ? ollama.value : null,
        detected: detected.status === "fulfilled" ? detected.value : [],
        issues: modelIssues(hex, ollama)
    };
});

handle(IpcDictation.SavePreferences, async (event, next: DictationPreferences) => {
    if (event.sender !== mainWin?.webContents || event.senderFrame !== event.sender.mainFrame)
        return "Ventana inválida.";
    if (status.phase !== "idle" && status.phase !== "error") return "Detén el dictado para cambiar los ajustes.";
    if (
        !next ||
        !Object.hasOwn(LANGUAGES, next.source) ||
        (next.translationTarget !== undefined &&
            (!Object.hasOwn(LANGUAGES, next.translationTarget) || next.translationTarget === next.source)) ||
        !PAUSES.some(pause => pause === next.pause) ||
        typeof next.hexModel !== "string" ||
        !/^[a-z0-9_]{0,64}$/.test(next.hexModel) ||
        typeof next.ollamaModel !== "string" ||
        !/^[a-zA-Z0-9._/:-]{1,180}$/.test(next.ollamaModel) ||
        typeof next.accelerator !== "string" ||
        !/^(Control(?:\+Alt)?(?:\+Shift)?|Alt(?:\+Shift)?)\+(F(?:[1-9]|1[0-2])|[A-Z0-9])$/.test(next.accelerator)
    ) {
        return "Revisa los idiomas, los modelos y el atajo.";
    }
    if (next.hexModel) {
        let catalog: Awaited<ReturnType<typeof hexList>>;
        try {
            catalog = await hexList();
        } catch {
            return "No se pudo comprobar el modelo de Hex. Actualiza la lista y vuelve a intentar.";
        }
        const model = catalog.find(item => item.id === next.hexModel);
        if (!model || !supportsDictationLanguage(model, next.source)) {
            return (
                "El modelo de dictado no admite " +
                LANGUAGES[next.source].label +
                ". Elige un modelo compatible o Automático."
            );
        }
        if (status.phase !== "idle" && status.phase !== "error") return "Detén el dictado para cambiar los ajustes.";
    }
    if (!registerShortcut(next.accelerator)) return "Ese atajo no está disponible. Prueba otra combinación.";
    const { pause, source, translationTarget, hexModel, ollamaModel, accelerator } = next;
    const floatingHud = next.floatingHud === true;
    const hudIncoming = next.hudIncoming === true;
    State.store.dictation = {
        pause,
        source,
        translationTarget,
        hexModel,
        ollamaModel,
        accelerator,
        floatingHud,
        hudMotion: next.hudMotion !== false,
        hudIncoming
    };
    update(status);
    return "";
});

function checkSettingsSender(event: Electron.IpcMainInvokeEvent) {
    if (event.sender !== mainWin?.webContents || event.senderFrame !== event.sender.mainFrame)
        throw new Error("Ventana inválida.");
}
function modelIssues(hex: PromiseSettledResult<unknown>, ollama: PromiseSettledResult<unknown>) {
    const issue = (result: PromiseSettledResult<unknown>, engine: string) =>
        result.status === "fulfilled"
            ? undefined
            : result.reason instanceof ModelStorageError
              ? result.reason.message
              : "No se pudo consultar el motor de " + engine + ". Pulsa Actualizar para reintentar.";
    return { hex: issue(hex, "Hex"), ollama: issue(ollama, "Ollama") };
}

handle(IpcDictation.Library, async event => {
    checkSettingsSender(event);
    const [hex, ollama, detected] = await Promise.allSettled([hexList(), listOllamaModels(), detectedOllamaModels()]);
    const installed = ollama.status === "fulfilled" ? ollama.value : [];
    return {
        hex: hex.status === "fulfilled" ? hex.value : [],
        ollama: installed,
        detected: detected.status === "fulfilled" ? detected.value.filter(name => !installed.includes(name)) : [],
        detectedLocations: Object.fromEntries(
            await Promise.all(
                (detected.status === "fulfilled" ? detected.value : []).map(
                    async name => [name, await detectedOllamaLocation(name)] as const
                )
            )
        ),
        issues: modelIssues(hex, ollama)
    };
});
handle(IpcDictation.HexSettings, event => {
    checkSettingsSender(event);
    return hexSettings();
});
handle(IpcDictation.HexSettingSave, async (event, key: string, value: unknown) => {
    checkSettingsSender(event);
    if ((status.phase !== "idle" && status.phase !== "error") || maintenance)
        return "Detén el dictado o la tarea en curso.";
    try {
        await setHexSetting(key, value);
        return "";
    } catch (error) {
        return (error as Error).message;
    }
});
handle(IpcDictation.ModelCancel, event => {
    checkSettingsSender(event);
    maintenance?.abort();
});
handle(IpcDictation.ModelAction, async (event, data: ModelOperation) => {
    checkSettingsSender(event);
    if ((status.phase !== "idle" && status.phase !== "error") || maintenance)
        return { error: "Detén el dictado o espera a que termine la tarea." };
    if (
        !data ||
        typeof data.model !== "string" ||
        data.model.length > 180 ||
        !["hex", "ollama"].includes(data.engine) ||
        !["pull", "delete", "test"].includes(data.action)
    )
        return { error: "Acción inválida." };
    const controller = (maintenance = new AbortController());
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60 * 60_000)]);
    let last = 0;
    const progress = (text: string) => {
        if (Date.now() - last < 300 || event.sender.isDestroyed() || signal.aborted) return;
        last = Date.now();
        event.sender.send(IpcDictation.ModelProgress, text);
    };
    try {
        if (data.engine === "hex")
            return { result: await changeHexModel(data.action, data.model, signal, progress, preferences().source) };

        if (data.action === "test") {
            if (
                typeof data.sample !== "string" ||
                !data.sample.trim() ||
                data.sample.length > 1000 ||
                !data.target ||
                !Object.hasOwn(LANGUAGES, data.target)
            )
                return { error: "Escribe un texto de prueba y elige el idioma." };
            return { result: await translateLocal(data.sample, data.target, signal, progress, data.model) };
        }
        await ollamaMutation(data.action, data.model, signal, progress);
        return { result: data.action === "delete" ? "Modelo eliminado de Transcord." : "Modelo descargado." };
    } catch (error) {
        return { error: signal.aborted ? "Tarea cancelada." : (error as Error).message.slice(0, 350) };
    } finally {
        maintenance = undefined;
    }
});

const hudPhases = new Set<HudPhase>([
    "starting",
    "listening",
    "speech",
    "transcribing",
    "translating",
    "sending",
    "sent",
    "over-limit",
    "error"
]);
handle(IpcDictation.HudUpdate, (event, data: HudUpdate) => {
    checkSettingsSender(event);
    if (!activeOptions?.floatingHud || status.phase === "idle" || status.phase === "error" || !data) return;
    setDictationHud({
        phase: data.phase && hudPhases.has(data.phase) ? data.phase : undefined,
        locale: typeof data.locale === "string" ? data.locale.slice(0, 20) : undefined,
        target: status.target,
        text: typeof data.text === "string" ? data.text.slice(-MAX_TRANSCRIPT_LENGTH) : undefined,
        used: typeof data.text === "string" ? discordText(data.text).length : undefined,
        limit: data.limit === 2000 || data.limit === 4000 ? data.limit : undefined,
        estimated: typeof data.estimated === "boolean" ? data.estimated : undefined,
        incoming:
            activeOptions.hudIncoming &&
            typeof data.incoming?.author === "string" &&
            typeof data.incoming.text === "string"
                ? { author: data.incoming.author.slice(0, 80), text: data.incoming.text.slice(0, 360) }
                : undefined
    });
});

handle(IpcDictation.SpeechPreview, async (event, wav: Uint8Array) => {
    checkSettingsSender(event);
    if (
        !activeOptions?.floatingHud ||
        !engine ||
        !selectedModel ||
        job ||
        status.phase !== "speech" ||
        !(wav instanceof Uint8Array) ||
        wav.length < 44 ||
        wav.length > 810_000
    )
        return "";
    const controller = (job = new AbortController());
    try {
        return await engine.transcribe(
            selectedModel,
            wav,
            AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]),
            activeOptions.source
        );
    } catch {
        return "";
    } finally {
        if (job === controller) job = undefined;
    }
});
