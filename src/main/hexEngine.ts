/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawn } from "child_process";
import { once } from "events";
import { createInterface } from "readline";

import { downloadFailure } from "./modelStorage";

export async function openHexEngine(exe: string, signal: AbortSignal, env?: NodeJS.ProcessEnv) {
    const child = spawn(exe, ["service", "--embedded"], {
        windowsHide: true,
        env,
        stdio: ["pipe", "pipe", "ignore"]
    });
    const lines = createInterface({ input: child.stdout });
    child.stdin.on("error", () => {});
    child.on("error", () => {});
    const closed = new Promise<never>((_, reject) => {
        child.once("error", reject);
        child.once("exit", () => reject(new Error("Hex se cerró")));
    });
    function close() {
        child.stdin.end();
        const timer = setTimeout(() => child.kill(), 6000);
        timer.unref();
        child.once("close", () => clearTimeout(timer));
    }
    try {
        const [line] = await Promise.race([
            once(lines, "line", { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) }),
            closed
        ]);
        const ready = JSON.parse(line);
        if (
            ready.type !== "ready" ||
            ready.apiVersion !== "2" ||
            !/^http:\/\/127\.0\.0\.1:\d+$/.test(ready.url) ||
            typeof ready.token !== "string" ||
            !ready.token.startsWith("hex_")
        )
            throw new Error("Respuesta de Hex inválida");

        async function request(path: string, signal: AbortSignal, body?: Uint8Array, method = "POST") {
            const response = await fetch(ready.url + path, {
                method,
                redirect: "error",
                signal,
                headers: {
                    Authorization: "Bearer " + ready.token,
                    ...(body && { "Content-Type": "audio/wav" })
                },
                body: body ? Buffer.from(body) : undefined
            });
            if (!response.ok) {
                await response.body?.cancel();
                throw new Error("Hex respondió " + response.status);
            }
            return response;
        }

        return {
            close,
            async models(signal: AbortSignal) {
                const response = await request("/models", signal, undefined, "GET");
                return (await response.json()) as {
                    id: string;
                    name: string;
                    installed: boolean;
                    languages: string[];
                    downloadBytes: number;
                }[];
            },
            async prepare(model: string, signal: AbortSignal, language = "es", progress?: (text: string) => void) {
                const response = await request(
                    "/models/" + encodeURIComponent(model) + "/prepare?language=" + encodeURIComponent(language),
                    signal
                );
                const reader = response.body!.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                let complete = false;
                try {
                    for (;;) {
                        const { done, value } = await reader.read();
                        buffer += decoder.decode(value, { stream: !done });
                        const lines = buffer.split(/\r?\n/);
                        buffer = done ? "" : lines.pop()!;
                        for (const line of lines) {
                            if (!line.startsWith("data:")) continue;
                            const event = JSON.parse(line.slice(5));
                            if (event.type === "ok") complete = true;
                            if (event.type === "error") {
                                const reason =
                                    String(event.error?.code ?? "") + " " + String(event.error?.message ?? "");
                                throw new Error(
                                    (event.error?.code === "download-failed"
                                        ? "Hex no pudo descargar el modelo. Revisa la conexión y el espacio libre, y vuelve a intentar."
                                        : downloadFailure("Hex", reason)) ??
                                        "Hex no pudo preparar el modelo. Revisa la Biblioteca de modelos."
                                );
                            }
                            if (event.type === "downloading" && event.totalBytes > 0)
                                progress?.(
                                    "Descargando · " +
                                        Math.round((100 * event.downloadedBytes) / event.totalBytes) +
                                        " %"
                                );
                            if (event.type === "verifying") progress?.("Verificando modelo…");
                            if (event.type === "loading") progress?.("Cargando modelo…");
                        }
                        if (done) break;
                    }
                } finally {
                    await reader.cancel().catch(() => {});
                }
                if (!complete) throw new Error("Hex no preparó el modelo.");
            },
            async transcribe(model: string, wav: Uint8Array, signal: AbortSignal, language = "es") {
                const response = await request(
                    "/transcriptions?language=" + encodeURIComponent(language) + "&model=" + encodeURIComponent(model),
                    signal,
                    wav
                );
                const { transcript } = await response.json();
                if (typeof transcript !== "string") throw new Error("Respuesta de Hex inválida");
                return transcript.trim();
            }
        };
    } catch (error) {
        close();
        throw error;
    } finally {
        lines.close();
        child.stdout.resume();
    }
}
