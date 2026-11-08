/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow } from "electron";

import { showDictationMainWindow } from "../dictationHud";

export function showWindow(win: BrowserWindow) {
    if (win.isMinimized()) win.restore();
    showDictationMainWindow(win);
    win.show();
}
