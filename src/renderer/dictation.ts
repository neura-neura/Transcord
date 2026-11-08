/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { sendMessage } from "@vencord/types/utils";
import {
    ChannelStore,
    FluxDispatcher,
    GuildStore,
    RelationshipStore,
    SelectedChannelStore,
    UserStore
} from "@vencord/types/webpack/common";
import {
    DictationLanguage,
    DictationOptions,
    DictationPhase,
    encodeWav,
    IpcDictation,
    HudUpdate,
    PAUSES,
    MAX_TRANSCRIPT_LENGTH,
    discordMessageLimit,
    discordText,
    PhraseDetector
} from "shared/dictation";
import { createLiveTranscript } from "shared/liveTranscript";

import { onIpcCommand } from "./ipcCommands";
import { currentLocale, ui } from "./transcordLocale";

import "./dictation.css";

const composerSelector = '[data-slate-editor="true"][role="textbox"][contenteditable="true"]';

interface Capture {
    channel: string;
    account: string;
    label: string;
    pause: number;
    translationTarget?: DictationLanguage;
    translating?: boolean;
    floatingHud?: boolean;
    previewJob?: Promise<void>;
    previewAt?: number;
    sentAt?: number;
    incoming?: (event: IncomingEvent) => void;
    stream?: MediaStream;
    context?: AudioContext;
    processor?: ScriptProcessorNode;
    watcher?: number;
    queue: { wav?: Uint8Array; final: boolean }[];
    phraseParts: string[];
    busy: boolean;
    phase?: DictationPhase;
    pendingText?: string;
    rejectedText?: string;
    lastSent?: string;
}

let capture: Capture | undefined;
let panel: HTMLElement | undefined;
let indicator: HTMLElement | undefined;
let updateTranscript: ReturnType<typeof createLiveTranscript> | undefined;
interface IncomingEvent {
    message?: {
        channel_id?: string;
        content?: string;
        author?: { id: string; username?: string; global_name?: string };
    };
}

function hud(session: Capture, update: HudUpdate) {
    if (capture === session && session.floatingHud)
        void VesktopNative.dictation
            .hud({
                ...update,
                locale: currentLocale(),
                limit: discordMessageLimit(UserStore?.getCurrentUser()?.premiumType)
            })
            .catch(() => {});
}

function render(label: string, text: string, active: boolean, transcript?: string) {
    if (!panel) {
        panel = document.createElement("aside");
        panel.className = "transcord-dictation";
        const status = document.createElement("div");
        status.setAttribute("role", "status");
        status.className = "transcord-dictation-status";
        indicator = document.createElement("span");
        const stop = document.createElement("button");
        stop.type = "button";
        stop.textContent = ui("Detener");
        stop.onclick = () => end();
        status.append(indicator, stop);
        const preview = document.createElement("p");
        preview.hidden = true;
        updateTranscript = createLiveTranscript(preview);
        preview.dir = "auto";
        panel.append(status, preview);
        document.body.append(panel);
    }
    panel.hidden = false;
    panel.querySelector("button")!.hidden = !active;
    indicator!.textContent = label ? label + " · " + text : text;
    updateTranscript?.(transcript ?? "");
}

function report(session: Capture, phase: DictationPhase, text: string, transcript?: string) {
    const changed = session.phase !== phase;
    if (changed && phase === "speech") session.rejectedText = undefined;
    if ((changed || transcript) && !(phase === "listening" && session.rejectedText))
        render(session.label, text, true, transcript ?? (phase === "listening" ? session.lastSent : undefined));
    session.phase = phase;
    if (
        changed &&
        phase !== "idle" &&
        !(phase === "listening" && session.rejectedText) &&
        !(phase === "listening" && session.sentAt && Date.now() - session.sentAt < 1450)
    ) {
        hud(session, {
            phase,
            text: transcript ?? (phase === "transcribing" ? undefined : ""),
            estimated: Boolean(session.translationTarget)
        });
    }
    if (changed) {
        return VesktopNative.dictation.status({ phase, target: session.label });
    }
    return Promise.resolve();
}

function end(detail?: string, notifyMain = true) {
    const current = capture;
    capture = undefined;

    if (current) {
        clearInterval(current.watcher);
        if (current.incoming) {
            try {
                FluxDispatcher.unsubscribe("MESSAGE_CREATE", current.incoming);
            } catch {}
        }
        current.queue.length = 0;
        current.stream?.getTracks().forEach(track => track.stop());
        current.processor?.disconnect();
        if (current.context) void current.context.close().catch(() => {});
    }
    if (detail) render("", detail, false, current?.pendingText);
    else if (panel) {
        updateTranscript?.("");
        panel.hidden = true;
    }
    if (notifyMain) void VesktopNative.dictation.status({ phase: detail ? "error" : "idle", detail });
}

function openChannel() {
    const match = /^\/channels\/(?:@me|\d+)\/(\d+)(?:\/\d+)?\/?$/.exec(location.pathname);
    if (!match || SelectedChannelStore?.getChannelId() !== match[1]) return;
    return ChannelStore?.getChannel(match[1]);
}

function destinationLabel(channel: NonNullable<ReturnType<typeof openChannel>>, account: string) {
    const userLabel = (id: string, includeHandle = false) => {
        const user = UserStore?.getUser?.(id);
        const name = RelationshipStore?.getNickname?.(id)?.trim() || user?.globalName?.trim();
        const username = user?.username?.trim();
        if (name && name !== username) return includeHandle && username ? name + " · @" + username : name;
        return username ? "@" + username : undefined;
    };
    if (channel.isDM?.() || channel.type === 1) {
        const id = channel.getRecipientId?.() ?? channel.recipients?.find(id => id !== account);
        return (id && userLabel(id, true)) || channel.name || "@" + (id ?? channel.id);
    }
    if (channel.isGroupDM?.() || channel.type === 3) {
        const names = channel.recipients?.filter(id => id !== account).map(id => userLabel(id) ?? "@" + id);
        return channel.name?.trim() || names?.join(", ") || "#" + channel.id;
    }
    const guild = channel.guild_id && GuildStore?.getGuild?.(channel.guild_id);
    return "#" + (channel.name || channel.id) + (guild ? " · " + guild.name : "");
}

function composer() {
    return [...document.querySelectorAll(composerSelector)].find(editor => editor.closest("form"));
}

function showTranslation(text: string) {
    if (capture && stillOpen(capture)) render(capture.label, ui("Traduciendo…"), true, text);
}

VesktopNative.dictation.onTranslationProgress(partial => {
    if (capture?.translating && stillOpen(capture)) showTranslation(partial);
});

function stillOpen(session: Capture) {
    return openChannel()?.id === session.channel && UserStore?.getCurrentUser()?.id === session.account;
}

function rejectLongMessage(session: Capture, text: string, estimated: boolean) {
    session.rejectedText = text;
    render(session.label, ui("La frase es demasiado larga para Discord. Dicta frases más cortas."), true, text);
    hud(session, { phase: "over-limit", text, estimated });
}

async function drain(session: Capture) {
    if (session.busy) return;
    session.busy = true;
    try {
        while (capture === session && session.queue.length) {
            const part = session.queue.shift()!;
            if (part.final) await report(session, "transcribing", ui("Transcribiendo…"));
            else await report(session, "speech", ui("Dictando…"));
            await session.previewJob;
            if (capture !== session) return;
            const fragment = part.wav ? await VesktopNative.dictation.hex(part.wav, !part.final) : "";
            if (capture !== session) return;
            if (!stillOpen(session)) return end(ui("Cambió el chat. Se detuvo el dictado."));
            if (fragment) session.phraseParts.push(fragment);
            let text = session.phraseParts.join(" ");
            if (!part.final) {
                if (text) hud(session, { phase: "speech", text, estimated: Boolean(session.translationTarget) });
                continue;
            }
            session.phraseParts.length = 0;
            if (!text) continue;
            session.pendingText = text;
            if (!composer()) return end(ui("El chat ya no tiene un cuadro de mensaje disponible."));
            if (text.length > MAX_TRANSCRIPT_LENGTH) {
                rejectLongMessage(session, text, !!session.translationTarget);
                continue;
            }
            if (session.translationTarget) {
                session.translating = true;
                hud(session, { phase: "translating", text, estimated: true });
                render(session.label, ui("Traduciendo…"), true);
                showTranslation(ui("Traduciendo…"));
                try {
                    text = await VesktopNative.dictation.translate(text);
                } catch {
                    if (capture === session)
                        end(
                            ui(
                                "Ollama no pudo traducir. Comprueba el modelo en Ajustes → Biblioteca de modelos. No se envió la frase."
                            )
                        );
                    return;
                } finally {
                    session.translating = false;
                }
                if (capture !== session) return;
                if (!stillOpen(session)) return end(ui("Cambió el chat. Se detuvo el dictado."));
                session.pendingText = text;
                showTranslation(text);
                hud(session, { phase: "translating", text, estimated: false });
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            const content = discordText(text);
            if (content.length > discordMessageLimit(UserStore?.getCurrentUser()?.premiumType)) {
                rejectLongMessage(session, text, false);
                continue;
            }
            await report(session, "transcribing", ui("Enviando…"), text);
            hud(session, { phase: "sending", text, estimated: false });
            if (capture !== session) return;
            if (!stillOpen(session)) return end(ui("Cambió el chat. Se detuvo el dictado."));
            if (!composer()) return end(ui("El chat ya no tiene un cuadro de mensaje disponible."));
            // Use the client action with an explicit destination; don't touch the user's draft or the OS focus.
            const delivery = await sendMessage(session.channel, { content }, false, {
                allowedMentions: { parse: [], replied_user: false }
            });
            if (delivery?.ok === false || (typeof delivery?.status === "number" && delivery.status >= 400))
                throw new Error("Discord rejected the message");
            session.pendingText = undefined;
            session.lastSent = text;
            session.sentAt = Date.now();
            hud(session, { phase: "sent", text, estimated: false });
            const sentAt = session.sentAt;
            window.setTimeout(() => {
                if (session.sentAt === sentAt && session.phase === "listening" && !session.busy)
                    hud(session, { phase: "listening" });
            }, 1450);
        }
        if (capture === session && session.phase !== "speech") void report(session, "listening", ui("Escuchando"));
    } catch {
        if (capture === session) end(ui("No se pudo transcribir o enviar la frase. El dictado se detuvo."));
    } finally {
        session.busy = false;
    }
}

async function openMicrophone(session: Capture) {
    try {
        await report(session, "starting", ui("Preparando Hex…"));
        if (capture !== session) return;
        await VesktopNative.dictation.hex();
        if (capture !== session) return;
        if (!stillOpen(session)) return end(ui("Cambió el chat. Se detuvo el dictado."));
        if (!composer()) return end(ui("El chat ya no tiene un cuadro de mensaje disponible."));
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
            video: false
        });
        if (capture !== session) {
            stream.getTracks().forEach(track => track.stop());
            return;
        }
        session.stream = stream;
        if (!stillOpen(session) || !composer())
            return end(ui("Abre un chat donde puedas escribir y vuelve a activar el dictado."));
        const context = (session.context = new AudioContext());
        const processor = (session.processor = context.createScriptProcessor(2048, 1, 1));
        const detector = new PhraseDetector(context.sampleRate, session.pause);
        const mute = context.createGain();
        mute.gain.value = 0;
        processor.onaudioprocess = event => {
            if (capture !== session) return;
            const result = detector.push(event.inputBuffer.getChannelData(0));
            if (result.frames || result.final) {
                if (session.queue.length >= 3) return end(ui("Hex no está siguiendo el ritmo. El dictado se detuvo."));
                session.queue.push({
                    wav: result.frames && encodeWav(result.frames, context.sampleRate),
                    final: !!result.final
                });
                void drain(session);
            } else if (!session.busy && result.speech !== undefined) {
                void report(
                    session,
                    result.speech ? "speech" : "listening",
                    result.speech ? ui("Dictando…") : ui("Escuchando")
                );
                if (
                    result.speech &&
                    session.floatingHud &&
                    !document.hasFocus() &&
                    !session.previewJob &&
                    Date.now() - (session.previewAt ?? 0) >= 1600
                ) {
                    const frames = detector.snapshot();
                    if (frames) {
                        session.previewAt = Date.now();
                        const wav = encodeWav(frames, context.sampleRate);
                        session.previewJob = VesktopNative.dictation
                            .speechPreview(wav)
                            .then(
                                text => {
                                    if (capture === session && text && !session.busy && session.phase === "speech")
                                        hud(session, {
                                            phase: "speech",
                                            text: [...session.phraseParts, text].join(" "),
                                            estimated: Boolean(session.translationTarget)
                                        });
                                },
                                () => {}
                            )
                            .finally(() => {
                                session.previewJob = undefined;
                            });
                    }
                }
            }
        };
        context.createMediaStreamSource(stream).connect(processor).connect(mute).connect(context.destination);
        for (const track of stream.getTracks()) {
            track.addEventListener("ended", () => {
                if (capture === session) end(ui("El micrófono se desconectó."));
            });
        }
        await context.resume();
        if (capture === session && session.phase === "starting" && !session.busy) {
            void report(session, "listening", ui("Escuchando"));
        }
    } catch (error) {
        if (capture !== session) return;
        const storageMessage =
            error instanceof Error ? error.message.match(/Carpeta de modelos de Hex: [^\r\n]+/)?.[0] : undefined;
        const detail =
            storageMessage ??
            (error instanceof DOMException
                ? ui("No se pudo abrir el micrófono. Comprueba los permisos de Windows.")
                : ui("No se pudo preparar Hex. Comprueba la conexión y vuelve a intentarlo."));
        end(detail);
    }
}

onIpcCommand(IpcDictation.Start, (options: DictationOptions) => {
    if (capture) return;
    const channel = openChannel();
    const account = UserStore?.getCurrentUser()?.id;
    if (!channel || !account || !composer())
        return end(ui("Abre un chat donde puedas escribir y vuelve a activar el dictado."));
    const session: Capture = {
        channel: channel.id,
        account,
        label: destinationLabel(channel, account),
        pause: PAUSES.some(value => value === options.pause) ? options.pause : 1500,
        translationTarget: options.translationTarget,
        floatingHud: options.floatingHud,
        queue: [],
        phraseParts: [],
        busy: false
    };
    capture = session;
    if (options.floatingHud && options.hudIncoming) {
        session.incoming = ({ message }) => {
            if (
                !message?.content?.trim() ||
                message.channel_id !== session.channel ||
                !message.author ||
                message.author.id === session.account ||
                !stillOpen(session)
            )
                return;
            hud(session, {
                incoming: {
                    author: message.author.global_name || message.author.username || "Discord",
                    text: message.content
                }
            });
        };
        try {
            FluxDispatcher.subscribe("MESSAGE_CREATE", session.incoming);
        } catch {
            session.incoming = undefined;
        }
    }
    session.watcher = window.setInterval(() => {
        if (!stillOpen(session)) end(ui("Cambió el chat. Se detuvo el dictado."));
    }, 250);
    void openMicrophone(session);
});

onIpcCommand(IpcDictation.Stop, () => end(undefined, false));
window.addEventListener("pagehide", () => {
    if (capture) end();
});
