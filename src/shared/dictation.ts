/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const DICTATION_RATE = 16_000;
export const LANGUAGES = {
    es: { label: "Español", english: "Spanish" },
    en: { label: "Inglés", english: "English" },
    fr: { label: "Francés", english: "French" },
    pt: { label: "Portugués", english: "Portuguese" },
    de: { label: "Alemán", english: "German" },
    it: { label: "Italiano", english: "Italian" },
    zh: { label: "Chino mandarín · 中文", english: "Chinese" }
} as const;
export type DictationLanguage = keyof typeof LANGUAGES;
export interface DictationOptions {
    pause: number;
    source: DictationLanguage;
    translationTarget?: DictationLanguage;
    floatingHud?: boolean;
    hudMotion?: boolean;
    hudIncoming?: boolean;
}
export interface DictationPreferences extends DictationOptions {
    hexModel: string;
    ollamaModel: string;
    accelerator: string;
}
export interface HexModel {
    id: string;
    name: string;
    installed: boolean;
    selected: boolean;
    languages: string[];
    size: string;
    downloadBytes?: number;
    owned?: boolean;
    detected?: boolean;
    location?: string;
}
export function supportsDictationLanguage(model: Pick<HexModel, "languages">, language: string) {
    return language !== "auto" && (model.languages.includes(language) || model.languages.includes("*"));
}
export interface HexSetting {
    key: string;
    value: unknown;
    kind: string;
    choices?: string[];
    writable: boolean;
    available: boolean;
    about: string;
}
export interface ModelLibrary {
    hex: HexModel[];
    ollama: string[];
    detected: string[];
    detectedLocations?: Record<string, string>;
    issues?: Partial<Record<"hex" | "ollama", string>>;
}
export interface ModelOperation {
    engine: "hex" | "ollama";
    action: "pull" | "delete" | "test";
    model: string;
    sample?: string;
    target?: DictationLanguage;
}
export const DEFAULT_SHORTCUT = "Control+Shift+F9";
export const DEFAULT_OLLAMA_MODEL = "kaelri/hy-mt2:1.8b-q8_0";

export const MAX_TRANSCRIPT_LENGTH = 12_000;
export const STANDARD_MESSAGE_LIMIT = 2000;
export const NITRO_MESSAGE_LIMIT = 4000;
export function discordMessageLimit(premiumType?: number) {
    return premiumType === 2 ? NITRO_MESSAGE_LIMIT : STANDARD_MESSAGE_LIMIT;
}

export function discordText(text: string) {
    return text.replace(/@(?=everyone\b|here\b)/gi, "@\u200b");
}

export const PAUSES = [1000, 1500, 2300] as const;
export type DictationPhase = "idle" | "starting" | "listening" | "speech" | "transcribing" | "error";
export type HudPhase =
    | "starting"
    | "listening"
    | "speech"
    | "transcribing"
    | "translating"
    | "sending"
    | "sent"
    | "over-limit"
    | "error";
export interface HudUpdate {
    phase?: HudPhase;
    locale?: string;
    text?: string;
    limit?: number;
    estimated?: boolean;
    incoming?: { author: string; text: string };
}
export interface HudState extends HudUpdate {
    used?: number;
    target?: string;
    motion?: boolean;
}
export interface DictationStatus {
    phase: DictationPhase;
    target?: string;
    detail?: string;
}

export function encodeWav(frames: Float32Array[], inputRate: number) {
    const input = new Float32Array(frames.reduce((sum, frame) => sum + frame.length, 0));
    let offset = 0;
    for (const frame of frames) {
        input.set(frame, offset);
        offset += frame.length;
    }
    const ratio = inputRate / DICTATION_RATE;
    const length = Math.floor(input.length / ratio);
    const wav = new Uint8Array(44 + length * 2);
    const view = new DataView(wav.buffer);
    wav.set([82, 73, 70, 70], 0);
    wav.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
    wav.set([100, 97, 116, 97], 36);
    view.setUint32(4, wav.length - 8, true);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, DICTATION_RATE, true);
    view.setUint32(28, DICTATION_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(40, length * 2, true);
    for (let i = 0; i < length; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
        let sum = 0;
        for (let j = start; j < end; j++) sum += input[j];
        view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sum / (end - start))) * 32767, true);
    }
    return wav;
}

export interface PhraseResult {
    speech?: boolean;
    frames?: Float32Array[];
    // Intermediate audio can be transcribed while speaking. Only a final part may be sent.
    final?: boolean;
}

export class PhraseDetector {
    private preroll: Float32Array[] = [];
    private phrase: Float32Array[] = [];
    private samples = 0;
    private voiced = 0;
    private quiet = 0;
    private noise = 0.003;
    private continued = false;
    private breakAt = 0;
    private breakSamples = 0;
    private readonly pauseSamples: number;

    constructor(
        private rate: number,
        pause: number
    ) {
        this.pauseSamples = Math.ceil((rate * pause) / 1000);
    }

    snapshot() {
        return this.voiced >= this.rate * 0.6 ? this.phrase.slice() : undefined;
    }

    push(frame: Float32Array): PhraseResult {
        let energy = 0;
        for (const sample of frame) energy += sample * sample;
        const rms = Math.sqrt(energy / frame.length);
        const active = this.phrase.length > 0 || this.continued;
        // Once a phrase starts, quieter syllables still count as speech and reset the silence.
        const threshold = active
            ? Math.max(0.004, Math.min(0.026, this.noise * 1.8))
            : Math.max(0.007, Math.min(0.05, this.noise * 3));
        const speech = rms > threshold;
        if (!active && !speech) this.noise = 0.97 * this.noise + 0.03 * rms;
        const copy = new Float32Array(frame);
        if (!active) {
            if (!speech) {
                this.preroll.push(copy);
                if (this.preroll.length > Math.ceil((this.rate * 0.22) / frame.length)) this.preroll.shift();
                return {};
            }
            this.phrase = this.preroll;
            this.preroll = [];
            this.samples = this.phrase.length * frame.length;
        }
        if (speech && this.quiet >= this.rate * 0.1) {
            this.breakAt = this.phrase.length;
            this.breakSamples = this.samples;
        }
        this.phrase.push(copy);
        this.samples += frame.length;
        this.voiced += speech ? frame.length : 0;
        this.quiet = speech ? 0 : this.quiet + frame.length;

        if (this.quiet >= this.pauseSamples) {
            const trim = Math.max(0, Math.floor((this.quiet - this.rate * 0.18) / frame.length));
            const frames =
                this.voiced >= this.rate * (this.continued ? 0.07 : 0.28)
                    ? this.phrase.slice(0, this.phrase.length - trim)
                    : undefined;
            const final = this.continued || !!frames;
            this.phrase = [];
            this.samples = this.voiced = this.quiet = this.breakAt = this.breakSamples = 0;
            this.continued = false;
            return { frames, final, speech: false };
        }

        // Bound each Hex request, without treating this as the end of the phrase.
        if (speech && this.samples >= this.rate * 20) {
            const useBreak = this.breakAt > 0 && this.samples - this.breakSamples <= this.rate * 3;
            const frames = useBreak ? this.phrase.slice(0, this.breakAt) : this.phrase;
            this.phrase = useBreak ? this.phrase.slice(this.breakAt) : [];
            this.samples = useBreak ? this.samples - this.breakSamples : 0;
            this.voiced = useBreak ? Math.min(this.voiced, this.samples) : 0;
            this.breakAt = this.breakSamples = 0;
            this.continued = true;
            return { frames, final: false, speech: true };
        }
        return { speech: this.continued || this.voiced >= this.rate * 0.2 };
    }
}

export const enum IpcDictation {
    Start = "transcord:dictation-start",
    Stop = "transcord:dictation-stop",
    Status = "transcord:dictation-status",
    Hex = "transcord:dictation-hex",
    Translate = "transcord:translate",
    TranslationProgress = "transcord:translation-progress",
    GetPreferences = "transcord:get-dictation-preferences",
    SavePreferences = "transcord:save-dictation-preferences",
    Models = "transcord:dictation-models",
    Library = "transcord:model-library",
    ModelAction = "transcord:model-action",
    ModelProgress = "transcord:model-progress",
    ModelCancel = "transcord:model-cancel",
    HexSettings = "transcord:hex-settings",
    HexSettingSave = "transcord:hex-setting-save",
    HudUpdate = "transcord:hud-update",
    HudState = "transcord:hud-state",
    HudStop = "transcord:hud-stop",
    SpeechPreview = "transcord:speech-preview"
}
