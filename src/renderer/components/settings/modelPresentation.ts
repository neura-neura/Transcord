/* SPDX-License-Identifier: GPL-3.0-or-later */

import { currentLocale, ui } from "renderer/transcordLocale";
import { HexModel } from "shared/dictation";

export const modelGroups = [
    { id: "ready", title: "Listos para usar", badge: "Instalado" },
    { id: "detected", title: "Detectados", badge: "Detectado" },
    { id: "available", title: "Disponibles para descargar", badge: "Por descargar" }
] as const;
export type ModelGroup = (typeof modelGroups)[number]["id"];

export function hexModelGroup(model: HexModel): ModelGroup {
    return model.detected && !model.owned ? "detected" : model.installed ? "ready" : "available";
}

export function hexModelStatus(model: HexModel) {
    if (model.detected && !model.owned) return ui("Detectado");
    if (model.installed) return model.owned ? ui("Instalado en Transcord") : ui("Listo desde caché");
    return ui("Sin descargar ·") + " " + model.size;
}

let displayNames: Intl.DisplayNames | undefined;
let locale: string | undefined;
export function languageLabel(code: string) {
    if (code === "zh") return ui("Chino mandarín");
    if (code === "auto") return ui("Detección automática");
    try {
        const activeLocale = currentLocale();
        if (!displayNames || activeLocale !== locale) {
            displayNames = new Intl.DisplayNames([activeLocale], { type: "language" });
            locale = activeLocale;
        }
        const label = displayNames.of(code) ?? code;
        return label[0].toLocaleUpperCase(activeLocale) + label.slice(1);
    } catch {
        return code;
    }
}

export function hexModelLanguages(model: HexModel) {
    return model.languages.includes("*")
        ? ui("Multilingüe · admite todos los idiomas del selector de Transcord")
        : model.languages
              .filter(code => code !== "auto")
              .map(languageLabel)
              .sort((a, b) => a.localeCompare(b, currentLocale()))
              .join(", ");
}
