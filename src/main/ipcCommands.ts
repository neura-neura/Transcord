/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { randomUUID } from "crypto";

import { ipcMain } from "electron";
import { IpcEvents } from "shared/IpcEvents";

import { mainWin } from "./mainWindow";

const resolvers = new Map<string, Record<"resolve" | "reject", (data: any) => void>>();

export interface IpcMessage {
    nonce: string;
    message: string;
    data?: any;
}

export interface IpcResponse {
    nonce: string;
    ok: boolean;
    data?: any;
}

/**
 * Sends a message to the renderer process and waits for a response.
 * `data` must be serializable as it will be sent over IPC.
 *
 * You must add a handler for the message in the renderer process.
 */
export function sendRendererCommand<T = any>(message: string, data?: any, timeout?: number) {
    if (mainWin.isDestroyed()) {
        console.warn("Main window is destroyed, cannot send IPC command:", message);
        return Promise.reject(new Error("Main window is destroyed"));
    }

    const nonce = randomUUID();

    const promise = new Promise<T>((resolve, reject) => {
        const timer =
            timeout === undefined
                ? undefined
                : setTimeout(() => {
                      resolvers.delete(nonce);
                      reject(new Error("Renderer command timed out"));
                  }, timeout);
        resolvers.set(nonce, {
            resolve(data) {
                clearTimeout(timer);
                resolve(data);
            },
            reject(data) {
                clearTimeout(timer);
                reject(data);
            }
        });
    });

    mainWin.webContents.send(IpcEvents.IPC_COMMAND, { nonce, message, data });

    return promise;
}

ipcMain.on(IpcEvents.IPC_COMMAND, (event, { nonce, ok, data }: IpcResponse) => {
    if (event.sender !== mainWin?.webContents || event.senderFrame !== event.sender.mainFrame) return;
    const resolver = resolvers.get(nonce);
    if (!resolver) return;

    if (ok) {
        resolver.resolve(data);
    } else {
        resolver.reject(data);
    }

    resolvers.delete(nonce);
});
