# Plan: asistente, root y sincronización de video

**Goal:** Mejorar el asistente de este modelo, simplificar la identidad SSH, automatizar los tramos
comprobables de root y recuperar la sincronización de las seis WiZ con control de encendido/parada.

**Architecture:** Conservar el compañero Node/OpenSSH en loopback. El frontend obtiene identidades
locales sin leer claves y llama acciones fijas. Root y captura usan adaptadores separados, modelo
y firmware exactos, paquetes fijados y estados verificables. Captura reutiliza la sesión de luces
existente para guardar y restaurar las lámparas. No repetir root sobre la TV que ya lo tiene.

**Tech Stack:** Node incorporado y OpenSSH; UI sin dependencias; servicio TV ES5 y Node 8.

### Task 1: Diagnóstico y diseño

- Leer inventario y configuración actuales de TV; localizar paquetes y backups de captura previos.
- Revisar la causa de la firma/token de Developer Mode en la ruta upstream de root.
- Mantener dirección visual Apple TV, con jerarquía clara y ayudas de identidad en el propio campo.

### Task 2: Identidad e interfaz

Files: `installer/identities.cjs`, `installer/ui/`, `tests/installer-identities.test.cjs`, `tests/installer-ui.test.cjs`.

1. Probar descubrimiento limitado a claves webOS y último destino del journal, sin leer claves.
2. Explicar ruta local, diferencia con PIN, búsqueda y selección explícita.
3. Agregar diagnóstico/preparar/activar/desactivar captura, con errores e incertidumbre visibles.

### Task 3: Root específico

Files: `installer/root-*.cjs`, `tests/installer-root*.test.cjs`, `docs/root-automation.md`.

1. Identificar código y paquetes exactos, precondiciones y backups de firma/token.
2. Implementar detección root existente y tramos automatizables con verificación y recuperación.
3. No atribuir validación desde una TV original a un test simulado o al root existente.

### Task 4: Captura y control

Files: `installer/screen-*.cjs`, pruebas focales y `installer/engine.cjs` / `installer/server.cjs`.

1. Reutilizar la configuración privada comprobada, instalando sólo componentes ausentes verificados.
2. Diagnosticar frames frescos; no convertir un ACK o un puerto abierto en video confirmado.
3. Activar mediante la sesión del servicio y detener restaurando el baseline de lámparas.
4. Probar en TV desde el asistente; confirmar por lecturas independientes y separar validación visual.

### Cierre

Revisión independiente, pruebas apropiadas, Brave y TV. Publicar sólo fuentes/configuración de ejemplo;
tokens, claves, IPs del hogar y respaldos quedan privados. Registrar límites de root y contenido protegido.

## Resultado del 2026-10-21

La 0.7.6 quedó instalada. El asistente busca claves conocidas por metadatos, explica su uso
y mantiene los controles de captura separados del plan de Home/privacidad. Se comprobó en
Brave, también a 390 px sin desbordes. La TV actual ya tiene root y omite esa cadena.

PicCap volvió a capturar UI y video a aproximadamente 28–30 FPS. El dueño confirmó que las
seis WiZ siguen YouTube. Activar/Desactivar funcionó desde el asistente; una lectura
independiente confirmó la restauración de las seis lámparas, incluidas dos escenas WiZ.
El servicio conserva `sceneId` como alternativa a RGB o temperatura y verifica su lectura
antes de confirmar la restauración. La suite completa pasó 541 pruebas.

La automatización de root desde una TV original sigue siendo experimental. No se acreditan
captura tras reinicio, HDMI ni contenido protegido. Los detalles están en
[root automático](../root-automation.md) y [sincronización de video](../screen-sync.md).

## Corrección 0.7.7

El usuario reportó que activar Pantalla completa desde la TV apagaba las luces. Se encontró una
carrera: el ACK de HyperHDR confirma que encoló la orden, pero LEDDEVICE puede seguir apagado
en la lectura inmediata. El backend ahora espera el estado efectivo, con plazo acotado, y el
panel consulta una sola vez el estado después de cambiar el modo. La fachada sólo informa
activo con sesión active, selección exacta, salida encendida y cuadros frescos.

La 0.7.7 se instaló y se restauró su configuración privada. El diagnóstico real confirmó
captura fresca alrededor de 30 FPS, seis lámparas configuradas, modo Manual y ninguna
recuperación pendiente. Pasaron 555/555 pruebas y revisiones independientes del backend y de
la UI. La confirmación física del botón de la TV sigue pendiente; no se reemplaza por la
prueba histórica desde PC ni por estos tests.
