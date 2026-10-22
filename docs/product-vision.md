# Qué haría que Mi pantalla valga la pena todos los días

La prioridad es abrir lo que usamos, controlar el living y saber qué está haciendo la TV.
Cada función nueva tiene que conservar la respuesta del control y funcionar sin una cuenta
propia. Lo siguiente es una propuesta de producto: no describe funciones ya implementadas.

## Punto de partida comprobado

- La 0.7.4 tiene fondo local inmediato, fotos con fundido, clima, favoritos ordenables y Luces.
  El dueño la probó y dijo que anda bastante bien.
- Home y el encendido directo quedaron confirmados por el dueño en los casos documentados.
  La muestra de navegación de 0.7.4 dio unos 59,4 FPS; no garantiza ese resultado en todo uso.
- WiZ permite control manual y acompañar el fondo. En 0.7.6 el dueño confirmó colores de
  YouTube en seis lámparas y se verificó su restauración 6/6, incluidas dos en escena 6.
  Persistencia de captura tras reinicio, HDMI y contenido protegido siguen pendientes.
- Se retiraron tres apps LG removibles y se comprobaron preferencias de promociones apagadas.
  Eso no demuestra que la TV haya dejado de enviar datos ni elimina los anuncios de otras apps.
- Un acceso configurado no prueba que su app esté instalada. Nuvio 1.2.9 se reinstaló el 22 de octubre de 2026 y figura
  en el inventario; login y reproducción no se verificaron. PicCap 0.5.3 e HyperHDR 22.0.1 se reinstalaron y su pipeline
  se recuperó y probó con YouTube en 0.7.6. [Estado de captura](screen-sync.md).

Fuentes del estado: [rendimiento](performance.md), [Luces](lights.md),
[limpieza](cleaning.md) y [Home](home-takeover.md).

## 1. Un dock que siempre abra algo útil

**Beneficio:** encontrás lo que usás y volvés a la última app sin recorrer menús. Los favoritos
siguen primero; los recientes aparecen sólo si los activás. Homebrew Channel queda accesible
desde el inicio para instalar herramientas de la comunidad.

El inventario tiene que distinguir instalada, ausente y sin confirmar. Una app ausente no se
borra de tus preferencias: Personalizar permite conservarla, ocultarla o volver a comprobarla.
Los recientes de la primera versión guardarían únicamente aperturas hechas desde Mi pantalla;
no se presentarían como un historial completo de todo lo abierto en la TV.

**Requisitos:** consulta de inventario compatible con el modelo, IDs reales y conservación del
orden guardado. «Volver a la última app» significa abrirla; retomar un video en el segundo exacto
requiere soporte de esa app. No hay un mecanismo universal confirmado para Netflix, Disney+ o HDMI.

**CPU, RAM y privacidad:** logos locales, hasta diez IDs recientes y sin portadas descargadas ni
lecturas de pantalla. Inventario al pedirlo en Personalizar, fuera de la navegación del dock;
sin un proceso nuevo que vigile todas las apps. Historial local, apagable y borrable.

**Aceptación mínima:**

- Una actualización conserva favoritos, orden y ocultos; Homebrew abre el ID validado en esa TV.
- La consulta lenta o fallida deja seguir usando el dock y muestra «sin confirmar».
- Un reciente desaparece al borrar el historial; desactivarlo impide registrar nuevas aperturas.
- Ocho accesos entran a 1080p y 720p; flechas, Home y Atrás mantienen su comportamiento.

## 2. Escenas WiZ para Cine, Música y Noche

**Beneficio:** una acción prepara las lámparas elegidas sin tener que ajustar seis una por una.
Cada escena guarda brillo, blanco o color elegidos por vos. Son ajustes propios del living;
los nombres no implican una integración nueva con la nube WiZ.

Primero ofrecería guardar la escena actual y aplicarla desde Luces. Después se podría asociar
una escena a un acceso del dock, siempre como opción explícita y desactivada inicialmente.
Así podés abrir YouTube y preparar el ambiente sin cambiar luces cada vez que movés el foco.

**Requisitos:** identidad y respuesta de cada lámpara, lectura del estado antes de escribir y
gestión de resultados parciales. Si Pantalla completa está activa, hay que detener y confirmar
su restauración antes de aplicar una escena. Acompañar fondo conserva su alcance actual.

**CPU, RAM y privacidad:** unas pocas escenas locales y órdenes por acción; sin animaciones de
color permanentes ni búsquedas de red en segundo plano. Se conserva la selección explícita del
living. No se mandan escenas, imágenes ni estados de lámparas a un servidor del proyecto.

**Aceptación mínima:**

- Guardar, enfocar o abrir el panel no modifica las luces; aplicar requiere OK.
- Cada lámpara confirma su resultado. Una que no responde se muestra sin confirmar, nunca apagada.
- «Deshacer» intenta restaurar el estado previo y conserva visible cualquier recuperación pendiente.
- Con la TV o una lámpara sin red, el launcher sigue respondiendo y no repite órdenes sin límite.

## 3. Un panel de estado, privacidad y vuelta atrás

**Beneficio:** podés ver qué cambiamos y recuperar el funcionamiento anterior sin recordar
comandos root. El panel mostraría Home actual, versión, preferencias verificadas, apps retiradas,
estado de Luces y última comprobación. Cada dato distingue valor leído, pendiente y error.

La parte de privacidad mostraría los ajustes que realmente se puedan leer y las conexiones
necesarias para nuestras funciones. Ofrecería un modo local que pause pedidos de clima y fotos
diarias y conserve fondos incluidos y WiZ. Esto requiere implementar esos controles: hoy quitar
los archivos de configuración ya evita los pedidos correspondientes, pero no hay ese interruptor.

**Requisitos:** inventario vigente, respaldo previo y operaciones acotadas por categoría y clave.
Para restaurar ajustes privilegiados hace falta un servicio con permisos precisos y destinos
permitidos; no exponer una consola root ni un método de shell genérico al frontend.
Restaurar Home tiene que preservar los demás defaults y comprobarse antes de desinstalar la app.

**CPU, RAM y privacidad:** diagnóstico al abrir o pulsar Actualizar, sin gráficos ni muestreo
permanentes. Respaldos privados en la TV; exportación pública sin IP, MAC, tokens ni credenciales.
No declarar «cero espionaje»: apagar preferencias y verificar tráfico son evidencias distintas.
Un bloqueo de dominios necesitaría su propia prueba de reproducción, login y reversión.

**Aceptación mínima:**

- Ninguna lectura fallida se presenta como «privacidad activada» ni «todo deshabilitado».
- Cada cambio muestra alcance, respaldo y resultado leído después; falla sin aplicar otros cambios.
- La reversión de Home se prueba físicamente con la app presente antes de ofrecer desinstalación.
- El modo local no solicita clima ni fotos nuevas; no promete aislar YouTube, LG u otras apps.

## Orden de trabajo y presupuesto de rendimiento

1. **Dock e inventario:** beneficio inmediato y poco trabajo residente. Revalidar Homebrew y
   apps ausentes antes de sumar accesos que no abran nada.
2. **Estado y recuperación:** primero diagnóstico de sólo lectura; después cambios y reversión
   acotados. Esto permite continuar la limpieza con evidencia y recuperar cada modificación.
3. **Escenas WiZ:** reutilizan el servicio local existente y aportan algo que el Home de LG
   no resuelve en nuestro flujo actual. Las asociaciones automáticas quedarían para otra etapa.

«Full performance» requiere medir, no borrar paquetes por su nombre. Para cada entrega se
comparan la misma TV y recorrido: primer pintado, reapertura, navegación, CPU y memoria en
reposo y con Luces abierto. No hay todavía un presupuesto de RAM medido para estas propuestas.
Primero se toma la base y se informa el costo adicional; los 59,4 FPS previos no se trasladan
a otra versión sin volver a medir.

La condición de entrada es no agregar polling para estas tres funciones, no hacer red al
mover el foco y no ejecutar escenas o diagnósticos pesados al cargar el inicio. La salida exige
pruebas con el control físico, 1080p/720p, error de red y retorno desde YouTube. El arranque en
frío se mide por separado de una recarga del navegador. Si una función empeora esos recorridos,
se difiere o simplifica antes de publicarla.
