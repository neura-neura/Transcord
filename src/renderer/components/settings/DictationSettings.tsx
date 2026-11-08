/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@vencord/types/webpack/common";
import { ui, useUiLocale } from "renderer/transcordLocale";
import {
    DEFAULT_SHORTCUT,
    DictationLanguage,
    DictationPreferences,
    LANGUAGES,
    PAUSES,
    supportsDictationLanguage
} from "shared/dictation";

import { hexModelGroup, hexModelStatus, modelGroups } from "./modelPresentation";

import "./dictationSettings.css";

const languages = Object.entries(LANGUAGES);
const modifierChoices = ["Control", "Control+Shift", "Control+Alt", "Control+Alt+Shift", "Alt", "Alt+Shift"];
const keyChoices = [
    ...Array.from({ length: 12 }, (_, index) => "F" + (index + 1)),
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
];

function formatShortcut(value: string) {
    return value.replace("Control", "Ctrl").replace("Shift", ui("Mayús")).replaceAll("+", " + ");
}

export default function DictationSettings() {
    useUiLocale();
    const [options, setOptions] = useState<DictationPreferences>();
    const [activeShortcut, setActiveShortcut] = useState("");
    const [models, setModels] = useState<Awaited<ReturnType<typeof VesktopNative.dictation.models>>>();
    const [loadingModels, setLoadingModels] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");
    const [loadFailed, setLoadFailed] = useState(false);

    async function refreshModels() {
        setLoadingModels(true);
        try {
            setModels(await VesktopNative.dictation.models());
        } catch {
            setModels({ hex: null, ollama: null, detected: [] });
        } finally {
            setLoadingModels(false);
        }
    }

    useEffect(() => {
        void VesktopNative.dictation.preferences().then(
            state => {
                setOptions(state.preferences);
                setActiveShortcut(state.shortcut);
            },
            () => setLoadFailed(true)
        );
        void refreshModels();
    }, []);

    if (!options)
        return (
            <p role="status">
                {loadFailed ? ui("No se pudieron abrir los ajustes del dictado.") : ui("Cargando ajustes…")}
            </p>
        );

    const { source, translationTarget, hexModel, ollamaModel, accelerator, pause } = options;
    const compatible = models?.hex?.filter(model => supportsDictationLanguage(model, source));
    const selectedHex = compatible?.find(model => model.id === hexModel);
    const staleModel = Boolean(hexModel && compatible && !selectedHex);
    const readyModels = compatible?.filter(model => model.installed || model.detected) ?? [];
    const ready = readyModels.length;
    const detectedOllama = (models?.detected ?? []).filter(model => !models?.ollama?.includes(model));
    const installedOllama = !!models?.ollama?.includes(ollamaModel);
    const selectedOllamaStatus = installedOllama
        ? ui("Instalado en Transcord")
        : detectedOllama.includes(ollamaModel)
          ? ui("Detectado")
          : ui("Sin descargar en Transcord");
    const [modifiers, key] = [accelerator.split("+").slice(0, -1).join("+"), accelerator.split("+").at(-1)!];

    function change(patch: Partial<DictationPreferences>) {
        setMessage("");
        setOptions(previous => previous && { ...previous, ...patch });
    }

    async function save() {
        if (!options) return;
        setSaving(true);
        try {
            const error = await VesktopNative.dictation.savePreferences(options);
            if (!error) setActiveShortcut(options.accelerator);
            setMessage(error ? ui(error) : ui("Cambios guardados."));
        } catch {
            setMessage(ui("No se pudieron guardar los cambios. Inténtalo de nuevo."));
        } finally {
            setSaving(false);
        }
    }

    return (
        <form
            className="transcord-settings"
            onSubmit={event => {
                event.preventDefault();
                void save();
            }}
        >
            <p>
                {ui(
                    "Configura cómo se transcribe y se envía tu voz al chat. Detén el dictado antes de guardar cambios."
                )}
            </p>
            <fieldset disabled={saving}>
                <legend>{ui("Dictado con Hex")}</legend>
                <label>
                    {ui("Idioma del dictado")}
                    <select
                        value={source}
                        onChange={event => {
                            const value = event.currentTarget.value as DictationLanguage;
                            const keep =
                                !hexModel ||
                                Boolean(
                                    models?.hex?.some(
                                        model => model.id === hexModel && supportsDictationLanguage(model, value)
                                    )
                                );
                            change({
                                source: value,
                                hexModel: keep ? hexModel : "",
                                ...(translationTarget === value && { translationTarget: undefined })
                            });
                            if (!keep)
                                setMessage(
                                    ui("El modelo anterior no se puede usar con ese idioma. Se seleccionó Automático.")
                                );
                        }}
                    >
                        {languages.map(([code, lang]) => (
                            <option key={code} value={code}>
                                {ui(lang.label)}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    {ui("Modelo de dictado")}
                    <select
                        value={hexModel}
                        onChange={event => change({ hexModel: event.currentTarget.value })}
                        aria-describedby="tc-hex-status"
                    >
                        <option value="">{ui("Automático · prefiere modelos listos")}</option>
                        {hexModel && !selectedHex && (
                            <option value={hexModel} disabled>
                                {hexModel} · {staleModel ? ui("No compatible o no disponible") : ui("Sin verificar")}
                            </option>
                        )}
                        {modelGroups.map(group => {
                            const entries = compatible?.filter(model => hexModelGroup(model) === group.id);
                            return entries?.length ? (
                                <optgroup key={group.id} label={ui(group.title)}>
                                    {entries.map(model => (
                                        <option key={model.id} value={model.id}>
                                            {model.name} ·{" "}
                                            {model.detected && !model.owned
                                                ? ui("Detectado")
                                                : model.installed
                                                  ? model.owned
                                                      ? ui("Instalado")
                                                      : ui("En caché")
                                                  : model.size}
                                        </option>
                                    ))}
                                </optgroup>
                            ) : null;
                        })}
                    </select>
                </label>
                <p id="tc-hex-status" role="status" className={staleModel ? "transcord-model-warning" : undefined}>
                    {loadingModels
                        ? ui("Consultando modelos…")
                        : models?.hex === null
                          ? (models.issues?.hex ?? ui("No se pudo comprobar el catálogo. Pulsa Actualizar modelos."))
                          : staleModel
                            ? ui(
                                  "El modelo guardado no está disponible para este idioma. Elige Automático u otro modelo."
                              )
                            : selectedHex
                              ? hexModelStatus(selectedHex)
                              : ready
                                ? ui("Modelos compatibles listos: ") +
                                  ready +
                                  ". " +
                                  ui("Automático usará uno disponible.")
                                : ui("No hay modelos compatibles listos. Puedes descargar uno en la Biblioteca.")}
                </p>
                {!!ready && (
                    <div className="transcord-installed-summary">
                        <strong>{ui("Listos para dictar")}</strong>
                        <ul>
                            {readyModels.map(model => (
                                <li key={model.id}>
                                    {model.name}
                                    {model.owned ? "" : model.detected ? " · Detectado" : " · En caché"}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </fieldset>

            <fieldset disabled={saving}>
                <legend>{ui("Traducción local con Ollama")}</legend>
                <label>
                    {ui("Traducir a")}
                    <select
                        value={translationTarget ?? ""}
                        onChange={event =>
                            change({
                                translationTarget: (event.currentTarget.value || undefined) as
                                    | DictationLanguage
                                    | undefined
                            })
                        }
                    >
                        <option value="">{ui("Desactivado")}</option>
                        {languages
                            .filter(([code]) => code !== source)
                            .map(([code, lang]) => (
                                <option key={code} value={code}>
                                    {lang.label}
                                </option>
                            ))}
                    </select>
                </label>
                <label>
                    {ui("Modelo de traducción")}
                    <select
                        value={ollamaModel}
                        onChange={event => change({ ollamaModel: event.currentTarget.value })}
                        aria-describedby="tc-ollama-status"
                    >
                        {!installedOllama && !detectedOllama.includes(ollamaModel) && (
                            <option value={ollamaModel}>{ollamaModel} · Sin descargar</option>
                        )}
                        {!!models?.ollama?.length && (
                            <optgroup label={ui("Instalados en Transcord")}>
                                {models.ollama.map(model => (
                                    <option key={model} value={model}>
                                        {model} · Instalado
                                    </option>
                                ))}
                            </optgroup>
                        )}
                        {!!detectedOllama.length && (
                            <optgroup label={ui("Detectados en Ollama")}>
                                {detectedOllama.map(model => (
                                    <option key={model} value={model}>
                                        {model} · Detectado
                                    </option>
                                ))}
                            </optgroup>
                        )}
                    </select>
                </label>
                <p id="tc-ollama-status" role="status">
                    {loadingModels
                        ? ui("Consultando modelos…")
                        : models?.ollama === null
                          ? (models.issues?.ollama ?? ui("No se pudo iniciar Ollama."))
                          : selectedOllamaStatus}
                </p>
            </fieldset>
            <div className="transcord-settings-footer">
                <button type="button" disabled={loadingModels || saving} onClick={() => void refreshModels()}>
                    {loadingModels ? ui("Actualizando…") : ui("Actualizar modelos de Hex y Ollama")}
                </button>
            </div>

            <fieldset disabled={saving}>
                <legend>{ui("Envío y atajo")}</legend>
                <label>
                    {ui("Pausa antes de enviar")}
                    <select value={pause} onChange={event => change({ pause: Number(event.currentTarget.value) })}>
                        {PAUSES.map(value => (
                            <option key={value} value={value}>
                                {value / 1000} s
                            </option>
                        ))}
                    </select>
                </label>
                <div className="transcord-shortcut-row">
                    <label>
                        {ui("Modificadores del atajo")}
                        <select
                            value={modifiers}
                            onChange={event => change({ accelerator: event.currentTarget.value + "+" + key })}
                        >
                            {modifierChoices.map(value => (
                                <option key={value} value={value}>
                                    {formatShortcut(value)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        {ui("Tecla del atajo")}
                        <select
                            value={key}
                            onChange={event => change({ accelerator: modifiers + "+" + event.currentTarget.value })}
                        >
                            {keyChoices.map(value => (
                                <option key={value} value={value}>
                                    {value}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                <p>
                    {ui("Atajo activo:")}{" "}
                    <strong>{activeShortcut ? formatShortcut(activeShortcut) : ui("ninguno disponible")}</strong>
                </p>
                <button type="button" onClick={() => change({ accelerator: DEFAULT_SHORTCUT })}>
                    {ui("Restablecer atajo")}
                </button>
            </fieldset>

            <fieldset disabled={saving}>
                <legend>{ui("Ventana flotante")}</legend>
                <label className="transcord-check">
                    <input
                        type="checkbox"
                        checked={!!options.floatingHud}
                        onChange={event => change({ floatingHud: event.currentTarget.checked })}
                    />
                    {ui("Mostrar la burbuja cuando Transcord esté en segundo plano")}
                </label>
                <label className="transcord-check">
                    <input
                        type="checkbox"
                        disabled={!options.floatingHud}
                        checked={options.hudMotion !== false}
                        onChange={event => change({ hudMotion: event.currentTarget.checked })}
                    />
                    {ui("Animar el texto y el desplazamiento")}
                </label>
                <label className="transcord-check">
                    <input
                        type="checkbox"
                        disabled={!options.floatingHud}
                        checked={!!options.hudIncoming}
                        onChange={event => change({ hudIncoming: event.currentTarget.checked })}
                    />
                    {ui("Mostrar mensajes nuevos del chat fijado")}
                </label>
                <p>
                    {ui(
                        "La burbuja muestra el estado, el dictado provisional y la traducción. Los mensajes se muestran solo durante el dictado."
                    )}
                </p>
            </fieldset>
            <div className="transcord-settings-footer">
                <button className="transcord-save" type="submit" disabled={saving || staleModel}>
                    {saving ? ui("Guardando…") : ui("Guardar cambios")}
                </button>
                <span role="status">{message}</span>
            </div>
        </form>
    );
}
