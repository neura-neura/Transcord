/* SPDX-License-Identifier: GPL-3.0-or-later */

import translations from "./transcordTranslations.json";

const dictionaries: Record<string, Record<string, string>> = translations;

export function transcordText(locale: string | undefined, text: string) {
    const lang = (locale || "en").toLowerCase();
    if (lang.startsWith("es")) return text;
    const fallback = lang.split("-")[0];
    const prefix = text.match(/^\s*/)?.[0] ?? "";
    const suffix = text.match(/\s*$/)?.[0] ?? "";
    const key = text.trim();
    const value = dictionaries[lang]?.[key] ?? dictionaries[fallback]?.[key] ?? dictionaries.en?.[key];
    return value ? prefix + value + suffix : text;
}
