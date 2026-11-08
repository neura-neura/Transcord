/* SPDX-License-Identifier: GPL-3.0-or-later */

import { useEffect, useState } from "@vencord/types/webpack/common";
import { ui, useUiLocale } from "renderer/transcordLocale";
import { HexSetting } from "shared/dictation";

import "./dictationSettings.css";

export default function HexSettingsPanel() {
    useUiLocale();
    const [settings, setSettings] = useState<HexSetting[]>();
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState<HexSetting>();
    const [value, setValue] = useState("");
    const [message, setMessage] = useState("");
    const [saving, setSaving] = useState(false);

    async function reload() {
        try {
            setSettings(await VesktopNative.dictation.hexSettings());
        } catch {
            setMessage(ui("No se pudo cargar la configuración de Hex."));
        }
    }

    useEffect(() => {
        void reload();
    }, []);

    async function save() {
        if (!selected) return;
        setSaving(true);
        try {
            const parsed =
                selected.kind === "bool"
                    ? value === "true"
                    : selected.kind === "number"
                      ? Number(value)
                      : selected.kind === "json"
                        ? JSON.parse(value)
                        : value;
            if (selected.kind === "number" && (!value.trim() || !Number.isFinite(parsed)))
                throw new Error(ui("Escribe un número válido."));
            const error = await VesktopNative.dictation.saveHexSetting(selected.key, parsed);
            setMessage(error ? ui(error) : ui("Ajuste de Hex guardado."));
            if (!error) await reload();
        } catch (error) {
            setMessage((error as Error).message);
        } finally {
            setSaving(false);
        }
    }

    const visible = settings?.filter(item => (item.key + " " + item.about).toLowerCase().includes(query.toLowerCase()));
    return (
        <section className="transcord-settings">
            <p>{ui("Configuración avanzada que expone Hex 3.3.0 en Windows. Se guarda en el perfil de Transcord.")}</p>
            <p>
                {ui(
                    "Las opciones de la aplicación nativa de Hex (por ejemplo, su menú, la grabación de reuniones o sus atajos globales) no cambian el flujo de dictado en Discord. Para el atajo y los idiomas de Discord usa Dictado y traducción."
                )}
            </p>
            <fieldset disabled={saving}>
                <legend>{ui("Buscar y editar un ajuste")}</legend>
                <label>
                    {ui("Buscar por nombre o descripción")}
                    <input value={query} onChange={event => setQuery(event.currentTarget.value)} />
                </label>
                <label>
                    {ui("Ajuste de Hex")}
                    <select
                        value={selected?.key ?? ""}
                        onChange={event => {
                            const item = settings?.find(entry => entry.key === event.currentTarget.value);
                            setSelected(item);
                            setValue(
                                item?.kind === "json" ? JSON.stringify(item.value, null, 2) : String(item?.value ?? "")
                            );
                            setMessage("");
                        }}
                    >
                        <option value="">{ui("Elige un ajuste")}</option>
                        {selected &&
                            !visible?.includes(selected) &&
                            !visible?.some(item => item.key === selected.key) && (
                                <option value={selected.key}>{selected.key}</option>
                            )}
                        {visible?.map(item => (
                            <option key={item.key} value={item.key}>
                                {item.key}
                                {item.available ? "" : " · " + ui("No disponible en Windows")}
                            </option>
                        ))}
                    </select>
                </label>
                {selected && (
                    <>
                        <p>{selected.about}</p>
                        <label>
                            {ui("Valor")}
                            {selected.choices || selected.kind === "bool" ? (
                                <select
                                    disabled={!selected.writable || !selected.available}
                                    value={value}
                                    onChange={event => setValue(event.currentTarget.value)}
                                >
                                    {(selected.choices ?? ["true", "false"]).map(option => (
                                        <option key={option} value={option}>
                                            {option}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <textarea
                                    disabled={!selected.writable || !selected.available}
                                    rows={selected.kind === "json" ? 6 : 2}
                                    value={value}
                                    onChange={event => setValue(event.currentTarget.value)}
                                />
                            )}
                        </label>
                        <button
                            type="button"
                            disabled={!selected.writable || !selected.available}
                            onClick={() => void save()}
                        >
                            {ui("Guardar ajuste")}
                        </button>
                    </>
                )}
            </fieldset>
            <span role="status">{message || (!settings && ui("Cargando ajustes de Hex…"))}</span>
        </section>
    );
}
