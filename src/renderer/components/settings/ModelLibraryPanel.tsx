/* SPDX-License-Identifier: GPL-3.0-or-later */

import { useEffect, useState } from "@vencord/types/webpack/common";
import { ui, useUiLocale } from "renderer/transcordLocale";
import {
    DEFAULT_OLLAMA_MODEL,
    DictationLanguage,
    LANGUAGES,
    ModelLibrary,
    ModelOperation,
    supportsDictationLanguage
} from "shared/dictation";

import { hexModelGroup, hexModelLanguages, languageLabel, modelGroups, ModelGroup } from "./modelPresentation";

import "./dictationSettings.css";

export default function ModelLibraryPanel() {
    useUiLocale();
    const [library, setLibrary] = useState<ModelLibrary>();
    const [kind, setKind] = useState<"hex" | "ollama">("hex");
    const [filter, setFilter] = useState("");
    const [groupFilter, setGroupFilter] = useState<ModelGroup | "all">("all");
    const [language, setLanguage] = useState("");
    const [name, setName] = useState(DEFAULT_OLLAMA_MODEL);
    const [sample, setSample] = useState(ui("Hola, nos vemos mañana."));
    const [target, setTarget] = useState<DictationLanguage>("en");
    const [message, setMessage] = useState("");
    const [output, setOutput] = useState("");
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(false);
    const [confirm, setConfirm] = useState<ModelOperation>();
    const [failure, setFailure] = useState("");

    async function refresh() {
        setLoading(true);
        setFailure("");
        try {
            setLibrary(await VesktopNative.dictation.library());
        } catch {
            setFailure(ui("No se pudo cargar la biblioteca. Pulsa Actualizar para reintentar."));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void refresh();
        return VesktopNative.dictation.onModelProgress(setMessage);
    }, []);

    async function action(operation: ModelOperation) {
        setConfirm(undefined);
        setBusy(true);
        setOutput("");
        setMessage(ui("Iniciando…"));
        try {
            const reply = await VesktopNative.dictation.modelAction(operation);
            if (reply.error) setMessage(ui(reply.error));
            else if (operation.engine === "ollama" && operation.action === "test") {
                setOutput(reply.result ?? "");
                setMessage(ui("Traducción de prueba lista."));
            } else {
                setMessage(reply.result ?? "Listo.");
            }
            await refresh();
        } catch {
            setMessage(ui("La tarea no se pudo completar."));
        } finally {
            setBusy(false);
        }
    }

    function controls(engine: ModelOperation["engine"], model: string, owned: boolean, installed = owned) {
        const operate = (actionName: ModelOperation["action"]) => {
            const operation = { engine, action: actionName, model, sample, target };
            if (actionName === "delete") setConfirm(operation);
            else void action(operation);
        };
        return (
            <div className="transcord-settings-footer">
                {!installed && (
                    <button type="button" onClick={() => operate("pull")}>
                        {ui("Descargar")}
                    </button>
                )}
                {installed && (
                    <button type="button" onClick={() => operate("test")}>
                        {ui("Probar")}
                    </button>
                )}
                {owned && (
                    <button type="button" onClick={() => operate("delete")}>
                        {ui("Eliminar")}
                    </button>
                )}
            </div>
        );
    }

    const searchable = (value: string) =>
        value
            .normalize("NFD")
            .replace(/\p{Diacritic}/gu, "")
            .toLowerCase();
    const match = (value: string) => searchable(value).includes(searchable(filter.trim()));
    const filterLanguages = [
        ...new Set([
            ...Object.keys(LANGUAGES),
            ...(library?.hex.flatMap(model => model.languages.filter(code => code !== "*" && code !== "auto")) ?? [])
        ])
    ].sort((a, b) => languageLabel(a).localeCompare(languageLabel(b), "es"));
    const knownOllama = new Set([...(library?.ollama ?? []), ...(library?.detected ?? [])]);
    const items =
        kind === "hex"
            ? (library?.hex ?? [])
                  .filter(model => !language || supportsDictationLanguage(model, language))
                  .map(model => ({
                      id: model.id,
                      title: model.name,
                      group: hexModelGroup(model),
                      installed: model.installed || model.detected,
                      owned: !!model.owned,
                      size: model.size,
                      location: model.detected && !model.owned ? model.location : undefined,
                      languages: hexModelLanguages(model),
                      cache: model.installed && !model.owned && !model.detected
                  }))
            : [
                  ...(library?.ollama ?? []).map(id => ({ id, group: "ready" as const })),
                  ...(library?.detected ?? []).map(id => ({ id, group: "detected" as const })),
                  ...(library && !knownOllama.has(DEFAULT_OLLAMA_MODEL)
                      ? [{ id: DEFAULT_OLLAMA_MODEL, group: "available" as const }]
                      : [])
              ].map(({ id, group }) => ({
                  id,
                  title: id,
                  group,
                  installed: group !== "available",
                  owned: group === "ready",
                  size: "",
                  location: group === "detected" ? library?.detectedLocations?.[id] : undefined,
                  cache: false,
                  languages:
                      id === DEFAULT_OLLAMA_MODEL
                          ? ui("Multilingüe · incluye español, inglés y chino")
                          : ui("Idiomas no indicados por Ollama · usa Probar para comprobarlos")
              }));
    const results = items.filter(item => match(item.title + " " + item.id + " " + item.languages));
    const groups = modelGroups.filter(group => groupFilter === "all" || group.id === groupFilter);
    const visible = results.filter(item => groupFilter === "all" || item.group === groupFilter);
    return (
        <section className="transcord-settings">
            <p>
                {ui(
                    "Descarga y prueba modelos desde aquí. Solo puedes eliminar los modelos descargados por Transcord."
                )}
            </p>
            <fieldset disabled={busy || loading}>
                <legend>{ui("Biblioteca")}</legend>
                <label>
                    {ui("Motor")}
                    <select
                        value={kind}
                        onChange={event => {
                            setKind(event.currentTarget.value as typeof kind);
                            setFilter("");
                            setGroupFilter("all");
                            setLanguage("");
                            setConfirm(undefined);
                        }}
                    >
                        <option value="hex">{ui("Hex · dictado")}</option>
                        <option value="ollama">{ui("Ollama · traducción")}</option>
                    </select>
                </label>
                <div className="transcord-model-filters">
                    <label>
                        {ui("Buscar modelos")}
                        <input
                            value={filter}
                            onChange={event => setFilter(event.currentTarget.value)}
                            placeholder={ui("Nombre o idioma")}
                        />
                    </label>
                    <label>
                        {ui("Estado")}
                        <select
                            value={groupFilter}
                            onChange={event => setGroupFilter(event.currentTarget.value as typeof groupFilter)}
                        >
                            <option value="all">{ui("Todos los estados")}</option>
                            {modelGroups.map(group => (
                                <option key={group.id} value={group.id}>
                                    {ui(group.title)}
                                </option>
                            ))}
                        </select>
                    </label>
                    {kind === "hex" && (
                        <label>
                            {ui("Idioma compatible")}
                            <select value={language} onChange={event => setLanguage(event.currentTarget.value)}>
                                <option value="">{ui("Todos los idiomas")}</option>
                                {filterLanguages.map(code => (
                                    <option key={code} value={code}>
                                        {languageLabel(code)}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                </div>
                <button type="button" onClick={() => void refresh()}>
                    {loading ? ui("Actualizando…") : ui("Actualizar")}
                </button>
            </fieldset>

            {kind === "ollama" && (
                <details className="transcord-model-tools">
                    <summary>{ui("Descargar otro modelo o editar el texto de prueba")}</summary>
                    <fieldset disabled={busy || loading}>
                        <legend>{ui("Herramientas de Ollama")}</legend>
                        <label>
                            {ui("Nombre del modelo de Ollama")}
                            <input
                                value={name}
                                onChange={event => setName(event.currentTarget.value)}
                                placeholder={DEFAULT_OLLAMA_MODEL}
                                maxLength={180}
                            />
                        </label>
                        <p>
                            {ui(
                                "Escribe el nombre y la etiqueta de un modelo local del catálogo. HY‑MT2 es la opción inicial para traducción."
                            )}
                        </p>
                        <button
                            type="button"
                            disabled={!name.trim()}
                            onClick={() => void action({ engine: "ollama", action: "pull", model: name.trim() })}
                        >
                            {ui("Descargar modelo")}
                        </button>
                        <label>
                            {ui("Texto de prueba")}
                            <textarea
                                value={sample}
                                onChange={event => setSample(event.currentTarget.value)}
                                maxLength={1000}
                                rows={2}
                            />
                        </label>
                        <label>
                            {ui("Traducir la prueba a")}
                            <select
                                value={target}
                                onChange={event => setTarget(event.currentTarget.value as DictationLanguage)}
                            >
                                {Object.entries(LANGUAGES).map(([code, lang]) => (
                                    <option key={code} value={code}>
                                        {ui(lang.label)}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <p>{ui("Pulsa Probar junto al modelo instalado. La prueba no se envía a Discord.")}</p>
                    </fieldset>
                </details>
            )}

            <div className="transcord-settings-footer" role="status">
                {busy && (
                    <button type="button" onClick={() => void VesktopNative.dictation.cancelModelAction()}>
                        {ui("Cancelar tarea")}
                    </button>
                )}
                {message || failure || (loading ? ui("Cargando modelos…") : "")}
            </div>
            {library?.issues?.[kind] && (
                <p className="transcord-model-warning" role="status">
                    {library.issues[kind]}
                </p>
            )}
            {output && <output className="transcord-model-output">{output}</output>}
            {confirm && (
                <div className="transcord-settings-footer">
                    <span>
                        {ui("¿Eliminar")}
                        {confirm.model} de Transcord?
                    </span>
                    <button type="button" onClick={() => void action(confirm)}>
                        {ui("Sí, eliminar")}
                    </button>
                    <button type="button" onClick={() => setConfirm(undefined)}>
                        {ui("Cancelar")}
                    </button>
                </div>
            )}

            <fieldset disabled={busy || loading || !!confirm} className="transcord-library-results">
                <legend>{kind === "hex" ? ui("Catálogo de Hex") : ui("Biblioteca de Ollama")}</legend>
                {library && (
                    <p role="status">
                        {visible.length} {ui(visible.length === 1 ? "modelo" : "modelos")}
                    </p>
                )}
                {groups.map(group => {
                    const entries = visible.filter(item => item.group === group.id);
                    if (!entries.length) return null;
                    return (
                        <section className="transcord-model-group" key={group.id}>
                            <h3>
                                {ui(group.title)} <span>{entries.length}</span>
                            </h3>
                            <ul>
                                {entries.map(item => (
                                    <li className="transcord-model-row" key={item.id}>
                                        <div className="transcord-model-heading">
                                            <strong>{item.title}</strong>
                                            <span className={"transcord-model-badge transcord-model-badge-" + group.id}>
                                                {item.cache ? ui("En caché") : ui(group.badge)}
                                            </span>
                                        </div>
                                        {item.size && <p>{item.size}</p>}
                                        {item.location && (
                                            <code className="transcord-model-location" title={item.location}>
                                                {item.location}
                                            </code>
                                        )}
                                        <p className="transcord-model-languages">
                                            <b>{ui("Idiomas:")}</b> {item.languages}
                                        </p>
                                        {controls(kind, item.id, item.owned, item.installed)}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    );
                })}
                {library && !library.issues?.[kind] && !visible.length && (
                    <p>{ui("No hay modelos con esos filtros.")}</p>
                )}
            </fieldset>
        </section>
    );
}
