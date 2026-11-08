/* SPDX-License-Identifier: GPL-3.0-or-later */

import { randomUUID } from "crypto";
import { mkdir, open, statfs, unlink } from "fs/promises";
import { join } from "path";

export class ModelStorageError extends Error {
    constructor(engine: string, folder: string, reason: string) {
        super("Carpeta de modelos de " + engine + ": " + reason + " (" + folder + ")");
    }
}

export function modelStorageFailure(engine: string, folder: string, error: unknown) {
    if (error instanceof ModelStorageError) return error;
    switch ((error as NodeJS.ErrnoException)?.code) {
        case "EACCES":
        case "EPERM":
        case "EROFS":
            return new ModelStorageError(
                engine,
                folder,
                "Windows no permite escribir en esta ruta. Revisa los permisos."
            );
        case "ENOSPC":
        case "EDQUOT":
            return new ModelStorageError(
                engine,
                folder,
                "No hay espacio suficiente. Libera espacio y vuelve a intentar."
            );
        case "EEXIST":
        case "ENOTDIR":
        case "EISDIR":
            return new ModelStorageError(engine, folder, "Hay un archivo o carpeta inesperados en esta ruta.");
        case "ENOENT":
        case "ENODEV":
        case "EIO":
            return new ModelStorageError(engine, folder, "La ruta o la unidad no está disponible.");
        default:
            return undefined;
    }
}

export async function ensureModelFolder(engine: string, folder: string, requiredBytes = 0) {
    try {
        await mkdir(folder, { recursive: true });
        // Actually create an entry: access(W_OK) does not check the Windows ACL.
        const probe = join(folder, ".transcord-write-" + randomUUID());
        const handle = await open(probe, "wx");
        try {
            await handle.write("0");
        } finally {
            try {
                await handle.close();
            } finally {
                await unlink(probe);
            }
        }
        if (requiredBytes > 0) {
            const { bavail, bsize } = await statfs(folder, { bigint: true });
            if (bavail * bsize < BigInt(requiredBytes)) {
                throw new ModelStorageError(
                    engine,
                    folder,
                    "No hay espacio para el modelo. Libera al menos " +
                        Math.ceil(requiredBytes / 1e6) +
                        " MB para esta operación."
                );
            }
        }
    } catch (error) {
        throw (
            modelStorageFailure(engine, folder, error) ??
            new ModelStorageError(engine, folder, "No se pudo crear o verificar la ruta.")
        );
    }
}

export function downloadFailure(engine: string, detail: string) {
    if (/no space left|disk (?:is )?full|not enough space|os error 112|ENOSPC|quota exceeded/i.test(detail))
        return engine + " no pudo guardar el modelo: libera espacio en la unidad y vuelve a intentar.";
    if (/permission denied|access is denied|os error 5\b|read-only|EACCES/i.test(detail))
        return engine + " no pudo escribir en la carpeta de modelos. Revisa sus permisos.";
    if (/not a directory|file already exists|cannot find the path|ENOTDIR/i.test(detail))
        return engine + " encontró una ruta de almacenamiento bloqueada. Revisa las carpetas de modelos.";
    if (/404|not.found|file does not exist|manifest unknown/i.test(detail))
        return "El modelo o su archivo ya no está disponible en el catálogo de " + engine + ". Prueba otro modelo.";
    if (/network|timeout|timed out|connection|certificate|resolve|dns|request|download|fetch/i.test(detail))
        return "No se pudo completar la descarga de " + engine + ". Revisa la conexión y vuelve a intentar.";
    return undefined;
}
