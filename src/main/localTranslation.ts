/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { LANGUAGES, DictationLanguage, MAX_TRANSCRIPT_LENGTH } from "shared/dictation";

import { detectedOllama, localOllama, modelName } from "./managedOllama";

export async function listOllamaModels(abort?: AbortSignal): Promise<string[]> {
    const tags = await fetch((await localOllama()) + "/api/tags", {
        signal: abort ? AbortSignal.any([abort, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
        redirect: "error"
    });
    const { models } = (await tags.json()) as { models?: { name: string; size: number; remote_host?: string }[] };
    if (!tags.ok || !Array.isArray(models)) throw new Error("Ollama no está disponible.");
    return models
        .filter(item => item.size > 0 && !item.remote_host && !item.name.endsWith("-cloud"))
        .map(item => item.name);
}

export async function translateLocal(
    text: string,
    target: DictationLanguage,
    abort: AbortSignal,
    progress: (partial: string) => void,
    model: string
) {
    const name = modelName(model).full;
    const installed = await listOllamaModels(abort).catch((): string[] => []);
    const endpoint = installed.includes(name) ? await localOllama() : await detectedOllama(name, abort);
    const response = await fetch(endpoint + "/api/generate", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.any([abort, AbortSignal.timeout(90_000)]),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: name,
            stream: true,
            keep_alive: "5m",
            prompt:
                "Translate the following text into " +
                LANGUAGES[target].english +
                ". Output only the translation, without any additional explanation.\n\n" +
                text,
            options: { temperature: 0, num_predict: 4096, ...(text.length > 1800 && { num_ctx: 8192 }) }
        })
    });
    if (!response.ok || !response.body) throw new Error("Ollama no pudo traducir.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "",
        output = "",
        last = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            const lines = buffer.split("\n");
            buffer = done ? "" : lines.pop()!;
            if (buffer.length > 64_000) throw new Error("Respuesta de Ollama no válida.");
            for (const line of lines) {
                if (!line.trim()) continue;
                const item = JSON.parse(line);
                if (item.error) throw new Error("Ollama no pudo traducir.");
                if (typeof item.response === "string") output += item.response;
                if (output.length > MAX_TRANSCRIPT_LENGTH)
                    throw new Error("La traducción supera el límite de Discord.");
                if (item.done) {
                    if (!output.trim() || item.done_reason === "length") throw new Error("Traducción incompleta.");
                    return output.trim();
                }
                if (Date.now() - last > 90 && output.trim()) {
                    last = Date.now();
                    progress(output.trimStart());
                }
            }
            if (done) throw new Error("Traducción incompleta.");
        }
    } finally {
        await reader.cancel().catch(() => {});
    }
}
