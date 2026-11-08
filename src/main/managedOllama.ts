/* SPDX-License-Identifier: GPL-3.0-or-later */

import { execFile, spawn, ChildProcess } from "child_process";
import { link, lstat, readFile, readdir, readlink, stat, symlink, unlink, writeFile } from "fs/promises";
import { createServer } from "net";
import { join } from "path";
import { setTimeout as delay } from "timers/promises";

import { downloadFailure, ensureModelFolder } from "./modelStorage";

interface Runtime {
    executable: string;
    models: string;
    external: string;
}

let config: Runtime;
interface Server {
    child?: ChildProcess;
    pending?: Promise<string>;
}
const managed: Server = {};
const shared: Server = {};
const referenceFolder = () => config.models + "-references";

export function configureOllama(value: Runtime) {
    config = value;
}

export function stopOllama() {
    stopServer(managed);
    stopServer(shared);
}

function stopServer(server: Server) {
    const pid = server.child?.pid;
    if (pid) {
        if (process.platform === "win32")
            execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
        else server.child?.kill();
    }
}

export async function ensureOllamaStorage() {
    await ensureModelFolder("Ollama", join(config.models, "blobs"));
    await ensureModelFolder("Ollama", join(config.models, "manifests"));
}

async function launch(server: Server, models: string) {
    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", resolve);
    });
    const address = probe.address();
    if (!address || typeof address === "string") throw new Error("No se pudo asignar un puerto.");
    await new Promise<void>((resolve, reject) => probe.close(error => (error ? reject(error) : resolve())));
    const host = "127.0.0.1:" + address.port;
    const proc = (server.child = spawn(config.executable, ["serve"], {
        windowsHide: true,
        stdio: "ignore",
        env: {
            ...process.env,
            OLLAMA_HOST: host,
            OLLAMA_MODELS: models,
            OLLAMA_NO_CLOUD: "1",
            ...(server === shared && { OLLAMA_NOPRUNE: "1" })
        }
    }));
    const url = "http://" + host;
    let failed = false;
    const stopped = () => {
        failed = true;
        if (server.child === proc) {
            server.child = undefined;
            server.pending = undefined;
        }
    };
    proc.once("error", stopped);
    proc.once("exit", stopped);
    for (let attempt = 0; attempt < 70 && !failed; attempt++) {
        try {
            const response = await fetch(url + "/api/version", { redirect: "error", signal: AbortSignal.timeout(400) });
            if (response.ok && !failed) return url;
        } catch {}
        await delay(150);
    }
    if (!failed) stopServer(server);
    throw new Error("No se pudo iniciar el motor de Ollama incluido.");
}

function getServer(server: Server, folder: string, init?: () => Promise<void>) {
    return (server.pending ??= (async () => {
        await init?.();
        return launch(server, folder);
    })().catch(error => {
        server.pending = undefined;
        throw error;
    }));
}

export function localOllama() {
    return getServer(managed, config.models, ensureOllamaStorage);
}

const token = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/;

export function modelName(input: string) {
    const match = /^([A-Za-z0-9._-]+)(?:\/([A-Za-z0-9._-]+))?(?::([A-Za-z0-9._-]+))?$/.exec(input);
    if (!match) throw new Error("Usa un nombre de Ollama como kaelri/hy-mt2:1.8b-q8_0.");
    const [, first, second, tag = "latest"] = match;
    const namespace = second ? first : "library";
    const name = second || first;
    if (![namespace, name, tag].every(value => token.test(value)) || tag.endsWith("-cloud") || tag === "cloud") {
        throw new Error("Elige un modelo local del catálogo de Ollama.");
    }
    return { namespace, name, tag, full: (namespace === "library" ? "" : namespace + "/") + name + ":" + tag };
}

function manifest(base: string, name: ReturnType<typeof modelName>) {
    return join(base, "manifests", "registry.ollama.ai", name.namespace, name.name, name.tag);
}

export async function detectedOllamaLocation(input: string) {
    const path = manifest(config.external, modelName(input));
    try {
        const { layers } = JSON.parse(await readFile(path, "utf8"));
        const layer = layers?.find(
            (item: { mediaType?: string; digest?: string }) =>
                item.mediaType === "application/vnd.ollama.image.model" &&
                /^sha256:[a-f0-9]{64}$/.test(item.digest ?? "")
        );
        if (layer) return join(config.external, "blobs", layer.digest.replace(":", "-"));
    } catch {}
    return path;
}

export async function detectedOllamaModels() {
    const results: string[] = [];
    const folder = join(config.external, "manifests", "registry.ollama.ai");
    for (const scope of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
        if (!scope.isDirectory() || !token.test(scope.name)) continue;
        for (const model of await readdir(join(folder, scope.name), { withFileTypes: true }).catch(() => [])) {
            if (!model.isDirectory() || !token.test(model.name)) continue;
            for (const tag of await readdir(join(folder, scope.name, model.name), { withFileTypes: true }).catch(
                () => []
            )) {
                if (!tag.isFile() || !token.test(tag.name)) continue;
                try {
                    const name = modelName(scope.name + "/" + model.name + ":" + tag.name);
                    if (await externalManifest(name)) results.push(name.full);
                } catch {}
            }
        }
    }
    return results.sort();
}

async function externalManifest(model: ReturnType<typeof modelName>) {
    const source = await readFile(manifest(config.external, model)).catch(() => undefined);
    if (!source || source.length > 1_000_000) return;
    try {
        const parsed = JSON.parse(source.toString());
        const layers = [parsed.config, ...parsed.layers] as { digest: string; size: number }[];
        if (
            layers.length > 128 ||
            layers.some(
                layer =>
                    !/^sha256:[a-f0-9]{64}$/.test(layer.digest) || !Number.isSafeInteger(layer.size) || layer.size < 0
            )
        )
            return;
        const files = await Promise.all(
            [...new Map(layers.map(layer => [layer.digest, layer])).values()].map(async layer => {
                const name = layer.digest.replace(":", "-");
                const original = join(config.external, "blobs", name);
                const info = await stat(original, { bigint: true });
                if (!info.isFile() || info.size !== BigInt(layer.size)) throw new Error("Incomplete model");
                return { name, original, info };
            })
        );
        return { source, files };
    } catch {
        return undefined;
    }
}

async function referenceBlob(original: string, target: string, info: { dev: bigint; ino: bigint }) {
    const current = await lstat(target, { bigint: true }).catch(() => undefined);
    if (current) {
        if (current.isSymbolicLink() && (await readlink(target).catch(() => "")) === original) return;
        if (current.isFile() && current.dev === info.dev && current.ino === info.ino && current.ino !== 0n) return;
        await unlink(target);
    }
    try {
        await symlink(original, target, "file");
    } catch {
        try {
            await link(original, target);
        } catch {
            throw new Error(
                "Windows no permitió enlazar el modelo detectado sin copiarlo. Si está en otra unidad, activa el modo para desarrolladores de Windows o descarga el modelo en Transcord."
            );
        }
    }
}

export async function detectedOllama(input: string, signal: AbortSignal) {
    const model = modelName(input);
    const external = await externalManifest(model);
    if (!external) throw new Error("El modelo local no está disponible o sus archivos están incompletos.");
    const folder = referenceFolder();
    const blobs = join(folder, "blobs");
    await ensureModelFolder("Ollama", blobs);
    for (const { name, original, info } of external.files) {
        signal.throwIfAborted();
        await referenceBlob(original, join(blobs, name), info);
    }
    const target = manifest(folder, model);
    await ensureModelFolder("Ollama", join(target, ".."));
    await writeFile(target, external.source);
    return getServer(shared, folder);
}

export async function ollamaMutation(
    action: "pull" | "delete",
    input: string,
    signal: AbortSignal,
    progress: (text: string) => void
) {
    const name = modelName(input).full;
    await ensureOllamaStorage();
    const url = await localOllama();
    const response = await fetch(url + "/api/" + action, {
        method: action === "delete" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: name, stream: true }),
        signal,
        redirect: "error"
    });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
            downloadFailure("Ollama", String(body.error ?? "")) ??
                (action === "pull" && response.status === 404
                    ? "El modelo no está disponible en el catálogo de Ollama. Revisa el nombre y la etiqueta."
                    : "Ollama no pudo " + (action === "pull" ? "descargar" : "eliminar") + " el modelo.")
        );
    }
    if (action === "delete") return;
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let pendingText = "";
    let complete = false;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            pendingText += decoder.decode(value, { stream: !done });
            const lines = pendingText.split("\n");
            pendingText = done ? "" : lines.pop()!;
            if (pendingText.length > 64000) throw new Error("Respuesta de descarga inválida.");
            for (const line of lines) {
                if (!line.trim()) continue;
                const item = JSON.parse(line);
                if (item.error)
                    throw new Error(downloadFailure("Ollama", String(item.error)) ?? String(item.error).slice(0, 300));
                if (item.status === "success") complete = true;
                if (item.total > 0)
                    progress("Descargando capa · " + Math.round((100 * item.completed) / item.total) + " %");
                else if (item.status) progress(String(item.status).slice(0, 100));
            }
            if (done) break;
        }
    } finally {
        await reader.cancel().catch(() => {});
    }
    if (!complete) throw new Error("Descarga incompleta.");
}
