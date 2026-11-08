# Transcord para Windows x64

Transcord combina [Vesktop](https://github.com/Vencord/Vesktop), sus plugins de Vencord, el motor local de [Hex 3.3.0](https://github.com/anomalyco/hex/releases/tag/v3.3.0) y el motor local de [Ollama 0.40.14](https://github.com/ollama/ollama/releases/tag/v0.40.14). El instalador incluye ambos motores; no necesitas instalar sus aplicaciones. Ollama incluido ejecuta la traducción con CPU. Puedes reutilizar los modelos detectados o descargar los que falten.

## Primer uso

1. Instala Transcord, ábrelo e inicia sesión en Discord. El primer arranque descarga Vencord.
2. En **Ajustes de usuario → Biblioteca de modelos**, puedes descargar, probar o eliminar modelos propios. Los modelos detectados en Hex u Ollama están listos para seleccionar y se usan en su ubicación original, sin duplicar sus archivos.
3. En **Dictado y traducción**, elige los modelos, los idiomas (incluido chino mandarín), la pausa y el atajo. Guarda los cambios. La traducción viene apagada por defecto.
4. Deja abierto el chat y pulsa el atajo global (por defecto, **Ctrl + Mayús + F9**) para iniciar o detener el dictado, incluso desde otra aplicación. Después de toda la pausa configurada, el mensaje se termina de transcribir y se envía; con traducción, se muestra una vista previa junto al borrador y se envía el resultado completo. Cambiar de chat, detener el micrófono o suspender el equipo cancela el envío pendiente.

Hex puede descargar automáticamente el modelo compatible al activar el dictado. Para traducción, selecciona un modelo de Ollama detectado o descarga uno, como `kaelri/hy-mt2:1.8b-q8_0`. También puedes escribir el nombre y la etiqueta de otro modelo local del catálogo de Ollama en el panel. Las pruebas de traducción del panel no envían mensajes a Discord.

## Hex avanzado

El panel **Hex avanzado** expone el registro de 86 ajustes de Hex 3.3.0. Puedes buscar por nombre o descripción, y el CLI incluido valida y guarda los valores editables dentro de Transcord. Las opciones no disponibles en Windows aparecen como tales. Este panel no convierte funciones del cliente nativo, como reuniones, anotaciones o pegado global, en funciones de Discord. Los controles de **Dictado y traducción** gobiernan el flujo de chat.

## Almacenamiento y compilación

La instalación predeterminada usa `%LOCALAPPDATA%\Programs\transcord`. La sesión, la configuración y los modelos propios se guardan en `%APPDATA%\Transcord`. Los perfiles de Vesktop, Hex y Ollama quedan separados.

Para compilar instala Node.js 22 o posterior y ejecuta `powershell -ExecutionPolicy Bypass -File scripts/build-transcord.ps1`. El script verifica las descargas oficiales por SHA-256 y empaqueta el motor CPU de Ollama. El instalador se genera en `dist/transcord`. Las licencias de los motores se incluyen en `resources/hex` y `resources/ollama`. El instalador no está firmado.

Discord [prohíbe la automatización de cuentas normales](https://support.discord.com/hc/en-us/articles/115002192352-Automated-User-Accounts-Self-Bots). El envío automático usa la acción del cliente de Discord bajo tu cuenta.

En **Dictado y traducción**, los modelos de Hex se filtran por idioma y aparecen agrupados por estado. Al cambiar de idioma, Transcord conserva el modelo si es compatible y, si no, vuelve a **Automático**. Guardar también comprueba la compatibilidad. En **Biblioteca de modelos**, puedes filtrar por estado e idioma, y consultar los idiomas que admite cada modelo de Hex. Ollama no proporciona una lista fiable de idiomas por modelo; usa **Probar** para comprobar una traducción.

Transcord crea las carpetas de modelos que faltan y comprueba que pueda escribir antes de descargar modelos. La Biblioteca muestra los problemas de almacenamiento por motor; una ruta dañada de Hex no impide consultar Ollama. Si un archivo bloquea una carpeta, Transcord indica la ruta y conserva el archivo.

### Ventana flotante

En **Ajustes de usuario → Dictado y traducción → Ventana flotante**, activa la burbuja y guarda los cambios. Aparece durante el dictado cuando trabajas fuera de Transcord. Muestra el estado, resultados provisionales de voz y la traducción mientras se genera. La opción independiente **Mostrar mensajes nuevos del chat fijado** añade una vista previa de mensajes entrantes de ese chat durante la sesión. La burbuja se puede mover arrastrando su cabecera.

El HUD usa una ventana superior de Windows que no toma el foco. Puede quedar debajo de juegos que usan pantalla completa exclusiva o de pantallas protegidas de Windows. La transcripción provisional se actualiza por fragmentos y no se envía; solo se envía la frase definitiva.

Los paneles de Transcord y el HUD toman el idioma de Discord mediante el mismo almacén que expone Vencord. Los textos propios se empaquetan con Transcord, con inglés como respaldo para variantes que no tengan traducción directa.

La vista de dictado empieza compacta y abre el área de lectura cuando llega texto. Conserva las palabras que no han cambiado, resalta suavemente las nuevas y mantiene el bloque lleno un instante para terminar de leerlo y pasa al siguiente con un fundido suave. Usa la rueda del ratón sobre el texto para volver a un bloque anterior; baja al último bloque para reanudar el seguimiento automático.

Si hablas durante mucho tiempo, Transcord transcribe fragmentos en segundo plano y conserva el texto. Solo empieza a traducir o enviar cuando detecta toda la pausa elegida; una interrupción breve no cierra la frase.
