/* SPDX-License-Identifier: GPL-3.0-or-later */

import { execFile } from "child_process";
import { mkdir, readFile, rm, stat, writeFile } from "fs/promises";
import { join } from "path";

import { app } from "electron";
import { HexModel, HexSetting } from "shared/dictation";

import { DATA_DIR } from "./constants";
import { openHexEngine } from "./hexEngine";
import { ensureModelFolder, modelStorageFailure } from "./modelStorage";

export const engineResources = () => (app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "vendor"));
export const hexExe = () => join(engineResources(), "hex", "hex.exe");
const profile = () => join(DATA_DIR, "Hex");
export const hexModelsFolder = () => join(profile(), "models");
const original = () => join(app.getPath("appData"), "hex");
export const hexEnv = () => ({ ...process.env, HEX_APPLICATION_SUPPORT_DIR: profile() });

const catalog: Record<string, string> = {
    parakeet_unified_en: "parakeet-unified-en-0.6b-Q8_0.gguf",
    parakeet_v2: "parakeet-tdt-0.6b-v2-Q8_0.gguf",
    parakeet_v3: "parakeet-tdt-0.6b-v3-Q8_0.gguf",
    whisper_large_v3_turbo: "whisper-large-v3-turbo-Q8_0.gguf",
    qwen3_asr06_b: "Qwen3-ASR-0.6B-Q8_0.gguf",
    qwencleo_asr_1_7b: "QwenCleo-ASR-1.7B-Q8_0.gguf",
    ivrit_whisper_large_v3_turbo: "ivrit-whisper-large-v3-turbo-Q8_0.gguf",
    sense_voice_small: "SenseVoiceSmall-Q8_0.gguf",
    cohere_transcribe: "cohere-transcribe-03-2026-Q8_0.gguf",
    underdog_bark_3_pro: "underdog-bark-3.0-pro-Q8_0.gguf",
    underdog_bark_3_clean: "underdog-bark-3.0-clean-Q8_0.gguf",
    parakeet_ultra: "parakeet-ultra-Q8_0.gguf",
    nemotron_3_5_asr: "nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf",
    gigaam_v3: "gigaam-v3-e2e-rnnt-Q8_0.gguf"
};

export async function hexList(signal = AbortSignal.timeout(15_000)): Promise<HexModel[]> {
    await ensureModelFolder("Hex", hexModelsFolder());
    const helper = await openHexEngine(hexExe(), signal, hexEnv());
    let models: Awaited<ReturnType<typeof helper.models>>;
    try {
        models = (await helper.models(signal)).filter(model => Object.hasOwn(catalog, model.id));
    } finally {
        helper.close();
    }
    return Promise.all(
        models.map(async model => ({
            ...model,
            selected: false,
            size: Math.round(model.downloadBytes / 1e6) + " MB",
            owned: await stat(join(profile(), "models", catalog[model.id])).then(
                s => s.isFile(),
                () => false
            ),
            location: join(original(), "models", catalog[model.id]),
            detected: await stat(join(original(), "models", catalog[model.id])).then(
                s => s.isFile() && s.size === model.downloadBytes,
                () => false
            )
        }))
    );
}

export async function referenceDetectedHex(model: HexModel) {
    if (model.owned || !model.detected || !Object.hasOwn(catalog, model.id)) return;
    const path = join(original(), "models", catalog[model.id]);
    const current = await stat(path).catch(() => undefined);
    if (!current?.isFile() || current.size !== model.downloadBytes) {
        throw new Error("El modelo detectado ya no está disponible en Hex.");
    }
    const folder = join(hexModelsFolder(), "found");
    await ensureModelFolder("Hex", folder);
    const descriptor = join(folder, model.id + ".json");
    const existing = await readFile(descriptor, "utf8").then(
        data => {
            try {
                return JSON.parse(data).path;
            } catch {
                return undefined;
            }
        },
        () => undefined
    );
    if (existing === path) return;
    // A deliberately invalid receipt lets Hex locate the original and forces its pinned SHA-256 verification.
    await writeFile(descriptor, JSON.stringify({ path, receipt: { bytes: 0, sha256: "", modified_ns: 0 } }));
}

export async function checkHexDownloadSpace(model: HexModel) {
    if (model.installed || model.detected || !model.downloadBytes || !Object.hasOwn(catalog, model.id)) return;
    const partial = join(hexModelsFolder(), catalog[model.id] + ".partial");
    const size = await stat(partial).then(
        info => (info.isFile() ? info.size : 0),
        () => 0
    );
    await ensureModelFolder("Hex", hexModelsFolder(), Math.max(0, model.downloadBytes - size));
}

export async function changeHexModel(
    action: "pull" | "delete" | "test",
    id: string,
    signal: AbortSignal,
    progress: (text: string) => void,
    preferredLanguage: string
) {
    if (!Object.hasOwn(catalog, id)) throw new Error("El modelo no está en el catálogo.");
    const model = (await hexList(signal)).find(item => item.id === id);
    if (!model) throw new Error("El modelo no está disponible.");
    const file = catalog[id];
    const target = join(hexModelsFolder(), file);
    if (action === "delete") {
        if (!model.owned) throw new Error("Solo puedes eliminar modelos propios de Transcord.");
        try {
            await rm(target);
            await rm(target + ".verified.json", { force: true });
        } catch (error) {
            throw modelStorageFailure("Hex", hexModelsFolder(), error) ?? error;
        }
        return "Modelo eliminado de Transcord.";
    }
    await referenceDetectedHex(model);
    signal.throwIfAborted();
    if (action === "pull") await checkHexDownloadSpace(model);
    if (action === "test" && !model.installed && !model.detected)
        throw new Error("Descarga el modelo antes de probarlo.");
    progress(action === "pull" ? "Preparando el modelo en Hex…" : "Verificando y cargando el modelo…");
    const language =
        model.languages.includes(preferredLanguage) || model.languages.includes("*")
            ? preferredLanguage
            : model.languages[0];
    const helper = await openHexEngine(hexExe(), signal, hexEnv());
    try {
        await helper.prepare(id, signal, language, progress);
    } finally {
        helper.close();
    }
    return action === "test" ? "El modelo cargó correctamente." : "Modelo listo para dictar.";
}

export async function hexSettings(): Promise<HexSetting[]> {
    const schema = JSON.parse(
        await readFile(join(engineResources(), "hex", "settings-schema.json"), "utf8")
    ) as HexSetting[];
    const saved = JSON.parse(
        await readFile(join(profile(), "settings.json"), "utf8").catch(error => {
            if (error.code === "ENOENT") return "{}";
            throw error;
        })
    );
    return schema.map(item => {
        const value = item.key.split(".").reduce((current, key) => current?.[key], saved);
        return value === undefined ? item : { ...item, value };
    });
}

export async function setHexSetting(key: string, value: unknown) {
    const setting = (await hexSettings()).find(item => item.key === key);
    if (!setting?.available || !setting.writable) throw new Error("Este ajuste no se puede cambiar en Windows.");
    const payload = JSON.stringify({ [key]: value });
    if (payload.length > 65536) throw new Error("El valor es demasiado largo.");
    await mkdir(profile(), { recursive: true });
    // The native CLI validates types, enum values, ranges, and shortcut conflicts before writing.
    return new Promise<void>((resolve, reject) => {
        const child = execFile(
            hexExe(),
            ["settings", "apply", "-", "--json"],
            { env: hexEnv(), timeout: 20000, windowsHide: true },
            (error, stdout) => {
                if (!error) return resolve();
                try {
                    reject(new Error(String(JSON.parse(stdout).message).slice(0, 300)));
                } catch {
                    reject(new Error("Hex no pudo guardar el ajuste."));
                }
            }
        );
        child.stdin?.on("error", () => {});
        child.stdin?.end(payload);
    });
}
