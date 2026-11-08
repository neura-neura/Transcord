/* SPDX-License-Identifier: GPL-3.0-or-later */

import { ipcRenderer } from "electron/renderer";
import { HudState, IpcDictation, STANDARD_MESSAGE_LIMIT } from "shared/dictation";
import { createLiveTranscript } from "shared/liveTranscript";
import { transcordText } from "shared/transcordText";

const labels = {
    starting: "Preparando modelo",
    listening: "Puedes hablar",
    speech: "Escuchando",
    transcribing: "Transcribiendo",
    translating: "Traduciendo",
    sending: "Enviando",
    sent: "Enviado",
    "over-limit": "Mensaje demasiado largo",
    error: "Dictado detenido"
} as const;

document.addEventListener("DOMContentLoaded", () => {
    const field = (id: string) => document.getElementById(id)!;
    const text = (id: string, value: string) => {
        if (field(id).textContent !== value) field(id).textContent = value;
    };
    let motion = true;
    const updateTranscript = createLiveTranscript(field("transcript"), () => motion);
    const stop = field("stop") as HTMLButtonElement;
    stop.addEventListener("click", async () => {
        if (stop.disabled) return;
        stop.disabled = true;
        try {
            await ipcRenderer.invoke(IpcDictation.HudStop);
        } catch {
            /* The main window may be closing. */
        } finally {
            stop.disabled = false;
        }
    });
    ipcRenderer.on(IpcDictation.HudState, (_, state: HudState) => {
        const phase = state.phase ?? "listening";
        motion = state.motion !== false;
        const t = (value: string) => transcordText(state.locale, value);
        document.documentElement.lang = state.locale || "en";
        document.body.dataset.phase = phase;
        text("phase", t(labels[phase]));
        text("target", state.target || "Transcord");
        field("target").title = state.target || "";
        text("stop", t("Detener"));
        text("incoming-label", t("Mensaje recibido"));
        text("author", state.incoming?.author ?? "");
        text("incoming-text", state.incoming?.text ?? "");
        field("incoming").hidden = !state.incoming?.text;
        updateTranscript(state.text ?? "");
        const budget = field("budget");
        const remaining = (state.limit ?? STANDARD_MESSAGE_LIMIT) - (state.used ?? 0);
        const showBudget = remaining <= 320 && phase !== "sent" && phase !== "listening" && phase !== "starting";
        budget.hidden = !state.text;
        if (showBudget) {
            const amount = new Intl.NumberFormat(state.locale || "en").format(Math.abs(remaining));
            budget.dataset.over = String(remaining < 0);
            text(
                "budget",
                (state.estimated ? "≈ " : "") +
                    amount +
                    " · " +
                    t(remaining < 0 ? "Caracteres de más" : "Caracteres restantes")
            );
        } else {
            text("budget", "");
        }
    });
});
