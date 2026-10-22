# Root automático para la LG 49UN7310PSC

Estado al **2026-10-21**: hay un flujo experimental implementado en el asistente local.
**No se probó esta nueva cadena completa partiendo de una TV original.** La TV de desarrollo ya
tiene root y el programa lo detecta para omitir el exploit. No se la desrooteó ni se reinició para
simular una instalación nueva.

El único perfil aceptado es **49UN7310PSC**, firmware **04.64.00**, webOS **5.6.2-21**,
build `jhericurl-jimna`, board **K6LP_ATSC_BR**. No hay downgrade, flasheo ni soporte declarado
para otros modelos.

## Qué automatiza el código

1. Consulta por SSH root en **22** y por Developer Mode, usuario `prisoner`, en **9922**.
   Comprueba modelo, firmware, build y board mediante respuestas de la TV.
2. Si ya verifica root, **omite la cadena de root**. Una clave que entra como root puede no estar
   autorizada en Developer Mode: eso deja el login de 9922 «sin confirmar», no «apagado».
   La firma del script y el tipo del token también se comprueban desde la conexión root.
3. Para preparar una TV sin root confirmado, exige Developer Mode accesible, script firmado
   original y token regular. También exige ausencia comprobada de la app/servicio HBC y su startup.
   Un timeout por sí solo no identifica una TV original. Los restos de root llevan a recuperación.
4. Fija las fuentes de SlopBro y HBC por commit y SHA-256, y el IPK de HBC 0.7.3 por SHA-256.
   Deriva la **clave pública** con `ssh-keygen -y`; el código no abre ni guarda los bytes de la
   clave privada. OpenSSH puede usarla para autenticar. Una clave cifrada que necesite interacción
   queda bloqueada; no se pide ni se guarda su contraseña.
5. Arma un bundle privado con una variante del cliente/página de SlopBro. Usa únicamente el
   overlay `com.webos.app.voiceweb`, que fue el que funcionó en esta unidad. **No descarga ni
   ejecuta el `autoroot.sh` upstream.** Incluye el original, los archivos transformados, sus hashes
   y `COPYING` de AGPL-3.0-or-later para poder revisar la derivación.
6. El bootstrap propio comprueba nuevamente el perfil, firma, token y ausencia de HBC antes de
   modificar acceso. Respalda `authorized_keys` si existe y el script de Developer Mode, agrega
   la clave pública y abre SSH temporal **2222**, por clave y sin contraseña. No abre Telnet.
7. Comprueba SSH temporal antes de provisionar HBC. Si hay un `start-devmode.sh.backup` original,
   la reparación exige **su firma LG y el hash stock exacto**, respalda el estado previo y recién
   entonces restaura el script. Conserva el token; no lo lee ni lo reemplaza.
8. Respalda archivos LS2 y startup, instala el IPK fijado, vuelve a leer la versión, comprueba los
   binarios instalados y ejecuta la elevación de HBC. Comprueba su actividad persistente y prepara
   un startup propio con SSH por clave y los hooks de HBC.
9. Verifica por separado root en 22 y Developer Mode en 9922. Aunque ambas consultas pasen,
   devuelve un resultado **parcial con arranque físico pendiente**. No reinicia la TV para fabricar
   esa confirmación.

Mientras se provisiona HBC, un `provisioning.hold` privado evita que su actividad de boot arranque
el startup antes de tiempo. El asistente retira ese hold únicamente después de comprobar ambos
accesos SSH desde la computadora. Si algo queda incierto, lo conserva y registra recuperación.

El plan dura cinco minutos, se consume una sola vez y se vuelve a comprobar antes de aplicarlo.
Los pasos de preparación no rootéan la TV. La ejecución experimental requiere **Python 3.8+**
además de los requisitos del [asistente local](local-installer.md); no agrega dependencias npm.
Durante el emparejamiento puede aparecer una solicitud que hay que aceptar en la TV.

## Qué se corrigió respecto del procedimiento anterior

El autoroot upstream reemplaza `/var/luna/preferences/devmode_enabled` por un directorio y puede
renombrar `start-devmode.sh` cuando la firma no verifica. En esta TV hubo que recuperar el script
stock y recrear el token de sesión manualmente. Esa combinación rompía Developer Mode.

La variante nueva **conserva el token regular y el script firmado**, sin llamar a ese tramo del
autoroot. Si encuentra el token como directorio, no inventa una sesión ni transforma el directorio
en un token vacío: se detiene con `DEVMODE_TOKEN_INVALID`. Si falta un backup de script original
verificable, la reparación se detiene con `SIGNED_BACKUP_REQUIRED`.

Hash del script stock observado en esta unidad:

```text
18b6b7cce77d640fef78d9d247d6fc672b0850bd728dd2a3c44105a485abc846
```

El startup propio no modifica contraseñas, no habilita Telnet y no monta bloqueos sobre archivos
del sistema. La optimización de Home, privacidad y apps sigue siendo un plan separado del asistente.

## Las huellas SSH siguen siendo necesarias

La identidad del cliente y la identidad del servidor son cosas distintas. El archivo elegido en
el asistente es la **clave privada de la computadora para entrar a la TV**. La huella SSH identifica
al servidor de la TV y se valida con `known_hosts`.

El flujo conserva `StrictHostKeyChecking=yes`. El servidor root temporal de 2222 y el de 22 pueden
presentar una clave distinta de la de Developer Mode 9922. El programa **no acepta esa huella a
ciegas ni modifica el `known_hosts` global**. Si falta esa confianza, la cadena se detiene con el
journal y los respaldos conservados. Falta integrar una confirmación de huella vinculada al canal
de Developer Mode ya verificado para que una instalación original pueda completar todo desde la UI.

El bootstrap todavía usa HTTP en la LAN y el cliente SSAP de SlopBro acepta el certificado local
de la TV sin validación pública. Los hashes fijan las descargas de origen; **no convierten ese primer
salto HTTP en un canal autenticado**. Es un límite real del transporte experimental.

## Si queda parcial

Los journals están en `~/.mi-pantalla-installer/root-runs/ID/`. Guardan destino y ruta local de la
identidad, fases y hashes; no guardan la clave privada. El bundle incluye la clave **pública**.
En Windows la protección de la carpeta depende también de las ACL del perfil.

Antes de empezar una cadena, el programa crea una reserva exclusiva por IP en el directorio
privado de journals. El nombre contiene un hash del destino; la creación es atómica y el archivo
se sincroniza. Después vuelve a leer recuperación y estado dentro de esa reserva. Así dos
instancias no pueden entregar el mismo bootstrap en paralelo. Una ejecución incierta conserva la
reserva para revisión; no se recicla por antigüedad ni al cerrar el programa. Sólo se retira tras
finalizar y confirmar el flujo, o si se detuvo antes de modificar la TV. Esto no acredita tolerancia
ante pérdida de alimentación; en Windows no se sincroniza el directorio con una API POSIX.

Los respaldos remotos quedan bajo `/var/lib/mipantalla-maintenance/` en `root-bootstrap/ID`,
`root-recovery/ID` y `root-provision/ID`, según la etapa alcanzada. Conservan el material previo
a los cambios realizados por el helper; no son una copia completa de la TV.

Ante una respuesta incierta, el siguiente plan queda bloqueado como `ROOT_RECOVERY_PENDING`.
El bloqueo se conserva para esa IP aunque cambies la ruta de la clave, para que corregir la
identidad no vuelva a ejecutar por accidente una cadena de root que quedó a mitad de camino.
**Revisar estado no repite el exploit.** El ID de recuperación de root pertenece a esta cadena:
no es un respaldo del plan normal de limpieza y no debe pasarse al botón de restauración de ese plan.
No hay un unroot ni una reversión transaccional completa implementados.

## Evidencia y límites

La suite local cubre el orden de las etapas, root ya presente, perfil distinto, planes vencidos,
estado cambiado, hashes incorrectos, respuesta incierta y preservación del token. El cuerpo de
reparación se ejecuta contra un filesystem simulado: valida firma/hash del backup, respalda antes
del reemplazo y puede recuperar un script ausente. También se generó un bundle con las fuentes
locales fijadas y se comprobó sintaxis de Python y de los programas Node; no se ejecutó su cliente
contra la TV.

Eso no acredita una instalación original, la primera confianza de host SSH, la actividad de boot
en este flujo nuevo, el vencimiento de la sesión de Developer Mode ni persistencia tras un corte de
alimentación. La [bitácora histórica de root](root-and-home.md) describe lo que sí se verificó
físicamente con el procedimiento anterior.

Fuentes fijadas:

- [SlopBro 21023d56](https://github.com/throwaway96/slopbro/tree/21023d56ca424607bb03d2939609cc658c655fc7).
- [Homebrew Channel 92fcf9fe](https://github.com/webosbrew/webos-homebrew-channel/tree/92fcf9fef7ce08dbeae3b0616df8d0c75c11f0b3).
- [IPK HBC 0.7.3](https://github.com/webosbrew/webos-homebrew-channel/releases/tag/v0.7.3), SHA-256
  `d10bf3c753551d7c72fb7a92b20fcd2317e502a220ac668ba8e76f6ea78b363c`.
