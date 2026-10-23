# Redesign option A ("Reloj protagonista")
Objective: implement option A from `tele-rediseno/` on the real launcher. Branch: `feat/redesign-option-a`.
Delivery: work-unit commits on the branch (push/PR are the user's call). Runner: `npm test` (node --test).

## Specs
- S1. Home layout follows `tele-rediseno/opcion-a.html` / `capturas/opcion-a.png`: big clock + date top-left; weather card top-right with Personalizar / Luces / Fondo buttons below; "Apps" and "Entradas" glass panels at the bottom with 144px tiles, visible labels and brand-colored focus halo; footer with weather status (dot) on the left and photo credit on the right. Existing features (wallpaper-only mode, lights, sources, catalog apps, dock scroll, TV fast focus path) keep working. Target is Chromium 68 (webOS 5), not 79 as the design notes assume.
- S2. "utilices los logos que te dio": use `tele-rediseno/logos/*.svg` for the built-in apps and inputs.
- S3. "que los logos de Diseny+ y Flow utilices los reales que estan en la TV": Disney+ and Flow show the icon the TV declares (copied by the lights service into `assets/app-icons/`); the provisional SVG stays as fallback.
- S4. "con los nombres de los iconos del clima haz que coincidan": weather.js icon names are the redesign file names (`despejado-dia`, `despejado-noche`, `parcial`, `nublado`, `niebla`, `llovizna`, `lluvia`, `nieve`, `tormenta`, `desconocido`) and the icons are the redesign SVGs. Assumption: partly cloudy at night gets an added `parcial-noche` (the given `parcial` has a sun).
- S5. Personalizar panel follows `tele-rediseno/personalizar.html`: index, logo, name, up/down round buttons, "Visible/Oculta" + switch. Catalog refresh, Fuentes and Restablecer stay.
- S6. "que funcione todo correctamente": full suite green except the pre-existing `native-home-guard` failure (fails on main before this work).

## Tasks
- T1 S2,S4 assets + weather names/max-min — inline — done
- T2 S3 TV icons for Disney+/Flow (catalog + app.js) — inline — done
- T3 S1,S5 markup + CSS + manager restyle + frost per panel — inline — done
- T4 S6 tests/docs updated, suite run — inline — done

## Log
- L1 (2026-10-23) "Quiero implementar la opcion A, quiero que utilices los logos que te dio y que los logos de Diseny+ y Flow utilices los reales que estan en la TV. con los nombres de los iconos del clima haz que coincidan y que funcione todo correctamente"
- L2 Baseline on main: 723 tests, 722 pass; `native-home-guard.test.cjs:92` already fails.
- L3 Final suite: 730 tests, 728 pass. Failing: `native-home-guard` (pre-existing on main) and `WiZ discovery` in lights-transport (timing flake under full-suite load; passes in isolation; untouched code).
- L4 Visual check at 1920×1080 in the browser and in the forced-fallback (Chromium 68) preview: matches `capturas/opcion-a.png`; frost canvas painted on both panels.
