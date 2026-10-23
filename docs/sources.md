# Fuentes

Todo lo que usamos para decidir cómo construir, instalar y limpiar. Cuando algo no tiene fuente
pública, es una prueba hecha en la TV y así se marca en las otras docs.

## LG webOS TV (oficial)

- Portal de desarrolladores: https://webostv.developer.lge.com/
- Developer Mode (activación, Key Server, vencimiento de sesión):
  https://webostv.developer.lge.com/develop/getting-started/developer-mode-app
- Application Manager (`launch`, `getAppLoadStatus`):
  https://webostv.developer.lge.com/develop/references/application-manager
- Motor web por versión de webOS (Chromium 68 en webOS 5):
  https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine
- ACG (no aplica a webOS TV 25 ni anteriores):
  https://webostv.developer.lge.com/develop/guides/acg-guide
- CLI `@webos-tools/cli` 3.2.6 (`ares-setup-device`, `ares-novacom`, `ares-device`,
  `ares-package`, `ares-install`, `ares-launch`), usado vía `npm exec`.
- SDK `webOSTV.js` 1.2.13 (Apache-2.0): procedencia y licencia en `vendor/SOURCE.md` y
  `vendor/LICENSE-2.0.txt`.

## LG soporte

- Borrar apps desde Home:
  https://www.lg.com/au/support/product-support/troubleshoot/help-library/cs-CT52001891-20154523932778/
- Home Settings / Home Promotion:
  https://www.lg.com/sg/support/product-support/troubleshoot/help-library/cs-CT52001362-20153529303128LST/
- Quick Access:
  https://www.lg.com/es/soporte/guias-y-soluciones/television/webos-3-5-funcion-quick-access/
- Explicación de LG sobre ACR, voz, anuncios y consentimientos opcionales:
  https://www.lg.com/global/newsroom/news/statements/statement-understanding-privacy-on-lg-smart-tvs/
  Es la posición del fabricante; no reemplaza la lectura de los acuerdos de nuestra TV ni
  una medición independiente de tráfico. Los menús y acuerdos varían por mercado y firmware.

## Connect SDK y SSAP (inventario y YouTube)

- Registro `hello` / `register` del cliente SSAP:
  - https://github.com/ConnectSDK/Connect-SDK-Android-Core/blob/master/src/com/connectsdk/service/webos/WebOSTVServiceSocketClient.java#L222
  - https://github.com/ConnectSDK/Connect-SDK-Android-Core/blob/master/src/com/connectsdk/service/webos/WebOSTVServiceSocketClient.java#L478
  - https://github.com/ConnectSDK/Connect-SDK-Android-Core/blob/master/src/com/connectsdk/service/webos/WebOSTVServiceSocketClient.java#L629
- Permisos del manifiesto (`READ_INSTALLED_APPS`):
  https://github.com/ConnectSDK/Connect-SDK-Android-Core/blob/master/src/com/connectsdk/service/webos/WebOSTVDeviceService.java#L87
- Lanzamiento de YouTube con `contentId` (el formato que **no** abrió el episodio por Luna):
  https://github.com/ConnectSDK/Connect-SDK-Android-Core/blob/master/src/com/connectsdk/service/WebOSTVService.java#L537
- `lgtv2`, `contentTarget` con la URL del video (el formato que **sí** funcionó en la TV):
  - https://github.com/hobbyquaker/lgtv2/issues/41#issuecomment-5370241499
  - https://github.com/hobbyquaker/lgtv2#commands

## Clima

- Open-Meteo, API de pronóstico: https://open-meteo.com/en/docs (actual y máxima/mínima del día con
  `daily=temperature_2m_max,temperature_2m_min&forecast_days=1`)
- Logos de YouTube, Spotify, Netflix, Twitch y HBO Max: símbolos de Simple Icons 16.35 (CC0 1.0;
  las marcas siguen siendo de sus dueños), sobre el fondo de cada ícono. Disney+ y Flow son
  provisorios: en la TV se usa su ícono real. HDMI 1 y 2 y los íconos del clima (`assets/weather/`)
  son propios del rediseño `tele-rediseno/`.

## Fotos

- Fondos locales: licencia Unsplash, https://unsplash.com/license . Autores y enlaces de cada
  foto en `assets/wallpapers/CREDITS.md`.
- Fotos diarias (implementadas; evolución y pruebas en [rendimiento](performance.md)):
  - Categoría: https://commons.wikimedia.org/wiki/Category:Featured_pictures_of_landscapes
  - https://www.mediawiki.org/wiki/API:Categorymembers
  - https://www.mediawiki.org/wiki/API:Imageinfo
  - https://www.mediawiki.org/wiki/API:Cross-site_requests#Unauthenticated_CORS_Requests

## Transitions

- Ícono de Bedrock Records (desde 0.4.1): símbolo B extraído del SVG de https://bedrock.org.uk/.
  Se conserva su geometría y se centra y escala para el dock; la marca no está cubierta por la licencia MIT.
- Playlist oficial del canal de John Digweed (`UCXUO2biGVP7FKCqPEDwmt4w`):
  https://www.youtube.com/playlist?list=PLg-OduiozGBG0JCQlIMTv7Ipz2xZ74y0z

## Nuvio

- Release oficial 1.2.9 (IPK y SHA-256): https://github.com/NuvioMedia/NuvioTVSmart/releases/tag/1.2.9
- Manifiesto con el `appId`: https://github.com/NuvioMedia/NuvioTVSmart/blob/main/appinfo.json

## Root y reemplazo de Home

Fuentes fijadas, hallazgos y límites de la revisión: [root-and-home.md](root-and-home.md).
El estado desplegado y su reversión se documentan en [Home](home-takeover.md).

- Compatibilidad por modelo y firmware: https://cani.rootmy.tv/?q=49UN7310PSC+04.64.00
- SlopBro: https://github.com/throwaway96/slopbro
- Homebrew Channel (failsafe): https://github.com/webosbrew/webos-homebrew-channel
- webos-launch-home (requiere root):
  - https://github.com/gprot42/webos-launch-home#compatibility
  - https://github.com/gprot42/webos-launch-home/blob/main/src/js/luna.js

## Privacidad y herramientas Homebrew

Revisión de código del 21 de octubre de 2026, sin instalar el bloqueador ni cambiar servicios:
[Privacidad y limpieza](privacy-cleanup.md). El requisito de versión del catálogo no equivale
a una prueba en 49UN7310PSC con webOS 5.6.2.

- Catálogo central Homebrew, commit `291da2bce269fbc901a0716b645caf64f709e3dc`:
  https://github.com/webosbrew/apps-repo/blob/291da2bce269fbc901a0716b645caf64f709e3dc/packages/ooo.lew.lifesgoodwithoutspying.yml
- Life's Good Without Spying v0.6.0, commit `0d371db91eb5cc49c8fb645082b44780c644b815`:
  https://github.com/lewisdoesstuff/lifesgoodwithoutspying/tree/0d371db91eb5cc49c8fb645082b44780c644b815
- Objetivos, defaults, montajes, restauración y patrones de borrado:
  https://github.com/lewisdoesstuff/lifesgoodwithoutspying/blob/0d371db91eb5cc49c8fb645082b44780c644b815/app/init/nospy-lib.sh
- Aplicación y semántica especial de SDP:
  https://github.com/lewisdoesstuff/lifesgoodwithoutspying/blob/0d371db91eb5cc49c8fb645082b44780c644b815/app/init/nospy-apply.sh
- Controlador: cambiar un toggle ya ejecuta la aplicación del conjunto:
  https://github.com/lewisdoesstuff/lifesgoodwithoutspying/blob/0d371db91eb5cc49c8fb645082b44780c644b815/app/init/nospy-ctl.sh
- Deshacer montajes y reactivar servicios:
  https://github.com/lewisdoesstuff/lifesgoodwithoutspying/blob/0d371db91eb5cc49c8fb645082b44780c644b815/app/init/nospy-remove.sh
- Helper DNS opcional, implementación real del desvío IPv4 con `iptables`:
  https://github.com/lewisdoesstuff/lifesgoodwithoutspying/blob/0d371db91eb5cc49c8fb645082b44780c644b815/dns-filter/scripts/tv-handoff.sh
- Release y digest publicado del IPK; consultar metadata no prueba una compilación reproducible:
  https://github.com/lewisdoesstuff/lifesgoodwithoutspying/releases/tag/v0.6.0

## Permisos de reportes de diagnóstico

Implementación de referencia de LG/webOS OSE, commit
`4abd4093adcc0853ccd3de3882e4b98a9ee15c01`:
https://github.com/webosose/rdxd/blob/4abd4093adcc0853ccd3de3882e4b98a9ee15c01/src/rdxd/main.cpp

Se revisaron `getLogSettings`, `setLogSettings`, los permisos de reportes y la llamada
incondicional a `upload_overview()` al iniciar. El firmware de la TV no se considera
idéntico a OSE. Los métodos y la lectura de los dos permisos sí se probaron en la unidad.
[Aplicación, evidencia y límites](diagnostic-privacy.md).

## Marcas

Bedrock Records, YouTube, Spotify, Netflix, Disney+, Nuvio, LG y webOS son marcas de sus dueños. Este proyecto no
está afiliado a ninguno de ellos.
