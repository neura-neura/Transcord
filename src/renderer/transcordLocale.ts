/* SPDX-License-Identifier: GPL-3.0-or-later */

import { LocaleStore, useEffect, useState } from "@vencord/types/webpack/common";
import { transcordText } from "shared/transcordText";

export function currentLocale() {
    try {
        return LocaleStore?.locale || document.documentElement.lang || navigator.language;
    } catch {
        return document.documentElement.lang || navigator.language;
    }
}

export function ui(text: string) {
    return transcordText(currentLocale(), text);
}

export function useUiLocale() {
    const [, setLocale] = useState(currentLocale);
    useEffect(() => {
        const change = () => setLocale(currentLocale());
        try {
            LocaleStore?.addChangeListener(change);
            return () => LocaleStore?.removeChangeListener(change);
        } catch {
            return;
        }
    }, []);
}
