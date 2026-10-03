# Río Negro Basin Explorer

[English](#english) · [Español](#español)

Live: https://rionegrobasinexplorer.vercel.app/

---

## English

An interactive satellite explorer of the Río Negro basin in northern Patagonia (Limay, Neuquén
and Río Negro). The map shows only the river system and a strip of land around it. Click a river,
a reach or a sub-basin to open a panel with its metrics. The UI is in English and Spanish.
Inspired by Amazon Basin Explorer.

### Features

- Rivers from HydroRIVERS: smaller streams appear as you zoom in. Perennial and non-perennial
  streams (GIRES) can be shown or hidden separately.
- **Visible Land** slider: six levels of land around the rivers, from 4.6% to 100% of the basin.
- Panels for named rivers, unnamed reaches and sub-basins: length, elevation, gradient, Strahler
  order, discharge, flooded area, lakes, population and dam regulation.
- Sub-basin hierarchy (levels 1–4) with a tree selector and breadcrumbs.
- IGN names and detail lines, lakes and reservoirs, dams, and OSM localities.
- Search by name, or by a HydroRIVERS `HYRIV_ID`. Every view can be shared by its URL.
- km/mi toggle, dark/light theme, minimap, PNG snapshot export, mobile bottom sheet.

> **Modeled data.** HydroATLAS values are modeled estimates, each for its own period. Discharge is
> a natural long-term average for 1971–2000 and does not reflect today's dam regulation.
> Population is a 2010 estimate (GPWv4). Flooded area comes from 1993–2004 satellite data
> (GIEMS-D15). Dam regulation is based on GRanD v1.1. The app states this wherever these values
> appear.

### Architecture

```
Sources (HydroSHEDS, HydroLAKES, GIRES, IGN, OSM)
   │  pipeline/  — TS steps running DuckDB + tippecanoe, each writes a report.json
   ▼
public/tiles/*.pmtiles (geometry)      data/out/*.ndjson → npm run seed → MongoDB Atlas (metadata)
   │ HTTP Range                                                           │
   ▼                                                                      ▼
MapLibre GL in the browser ── click → feature id → /api/* route handlers (CDN-cached)
```

- **Geometry and metadata live apart.** Geometry ships as static PMTiles vector tiles. Every
  tile feature carries an id that matches a MongoDB document, so a click on the map fetches that
  feature's panel data.
- **No separate backend.** MongoDB is read only from Next.js Server Components and Route Handlers.
  The app's database user is read-only.
- **State:** Zustand, kept in sync with the URL (`?r=<river>`, `?reach=<HYRIV_ID>`, `?s=<subbasin>`).
- **i18n:** next-intl. The locale is stored in a cookie, so URLs carry no locale prefix.

### Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · MapLibre GL + PMTiles ·
Zustand · next-intl · MongoDB Atlas · zod · DuckDB · tippecanoe · Vitest · Playwright · Vercel

### Getting started

Requires Node 24.

```bash
npm ci
cp .env.example .env.local   # fill in MONGODB_URI, MONGODB_DB and the imagery variables
npm run seed                 # loads data/out/*.ndjson into MongoDB (idempotent)
npm run dev
```

| Command                   | What it does                                      |
| ------------------------- | ------------------------------------------------- |
| `npm run dev`             | Development server                                |
| `npm run check`           | Typecheck, lint, format check and unit tests      |
| `npm run test:e2e`        | Playwright screenshot tests                       |
| `npm run pipeline:<step>` | One data pipeline step (see `pipeline/README.md`) |
| `npm run seed`            | Upserts the NDJSON outputs into MongoDB           |
| `npm run atlas:check`     | Verifies that the app's Mongo user can only read  |

Rebuilding the data needs tippecanoe on your `PATH`. DuckDB is installed by `npm ci`. The full
pipeline order and its prerequisites are in [pipeline/README.md](pipeline/README.md).

### Repository layout

```
app/          pages, /attributions, /api/{rivers,reaches,subbasins,search,health}
components/   map, panels, controls, search, mobile sheet
lib/          mongo.ts, data/ (schemas, queries), map/ (style, mask, minimap), store.ts, url-state.ts
messages/     en.json, es.json
pipeline/     data pipeline steps, configs, SOURCES.md
scripts/      seed, Atlas check, OG shapes
public/tiles/ PMTiles archives (committed)
```

Project docs: [PLAN.md](PLAN.md) (phases and status) and [DECISSIONS.md](DECISSIONS.md) (dated
decisions).

### Data and licenses

Data comes from HydroSHEDS (HydroRIVERS, RiverATLAS, HydroBASINS), HydroLAKES, GIRES, IGN
(Argentina) and OpenStreetMap. Satellite imagery is EOxCloudless 2024 (CC BY-NC-SA 4.0), so the
site is **non-commercial**. Full licenses and citations are in
[pipeline/SOURCES.md](pipeline/SOURCES.md) and on the app's `/attributions` page.

---

## Español

Un explorador satelital interactivo de la cuenca del Río Negro, en el norte de la Patagonia
(Limay, Neuquén y Río Negro). El mapa muestra solo la red de ríos y una franja de tierra a su
alrededor. Al hacer clic en un río, un tramo o una subcuenca se abre un panel con sus métricas. La
interfaz está en español e inglés. Inspirado en Amazon Basin Explorer.

### Funcionalidades

- Ríos de HydroRIVERS: los cursos más chicos aparecen a medida que se hace zoom. Los cursos
  permanentes y no permanentes (GIRES) se pueden mostrar u ocultar por separado.
- Slider **Visible Land**: seis niveles de tierra alrededor de los ríos, del 4,6% al 100% de la
  cuenca.
- Paneles de ríos con nombre, tramos sin nombre y subcuencas: longitud, altitud, pendiente, orden
  de Strahler, caudal, área inundable, lagos, población y regulación por represas.
- Jerarquía de subcuencas (niveles 1 a 4), con selector en árbol y breadcrumb.
- Nombres y líneas de detalle del IGN, lagos y embalses, represas y localidades de OSM.
- Búsqueda por nombre o por `HYRIV_ID` de HydroRIVERS. Cada vista se puede compartir con su URL.
- Unidades km/mi, tema oscuro/claro, minimapa, exportación a PNG y panel inferior en móvil.

> **Datos modelados.** Los valores de HydroATLAS son estimaciones modeladas, cada una de su propio
> período. El caudal es un promedio natural de largo plazo de 1971–2000 y no refleja la regulación
> actual de las represas. La población es una estimación de 2010 (GPWv4). El área inundable viene
> de datos satelitales de 1993–2004 (GIEMS-D15). La regulación por represas se basa en GRanD v1.1.
> La app lo indica en cada lugar donde aparecen estos valores.

### Arquitectura

```
Fuentes (HydroSHEDS, HydroLAKES, GIRES, IGN, OSM)
   │  pipeline/  — pasos en TS con DuckDB + tippecanoe; cada uno escribe un report.json
   ▼
public/tiles/*.pmtiles (geometría)     data/out/*.ndjson → npm run seed → MongoDB Atlas (metadatos)
   │ HTTP Range                                                           │
   ▼                                                                      ▼
MapLibre GL en el navegador ── clic → id del feature → route handlers /api/* (con caché de CDN)
```

- **La geometría y los metadatos están separados.** La geometría se sirve como tiles vectoriales
  PMTiles estáticos. Cada feature lleva un id que coincide con un documento de MongoDB, así que un
  clic en el mapa pide los datos del panel de ese feature.
- **Sin backend aparte.** MongoDB se lee solo desde Server Components y Route Handlers de Next.js.
  El usuario de base de datos de la app es de solo lectura.
- **Estado:** Zustand, sincronizado con la URL (`?r=<río>`, `?reach=<HYRIV_ID>`, `?s=<subcuenca>`).
- **i18n:** next-intl. El idioma se guarda en una cookie, así que las URLs no llevan prefijo de
  idioma.

### Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · MapLibre GL + PMTiles ·
Zustand · next-intl · MongoDB Atlas · zod · DuckDB · tippecanoe · Vitest · Playwright · Vercel

### Cómo empezar

Requiere Node 24.

```bash
npm ci
cp .env.example .env.local   # completar MONGODB_URI, MONGODB_DB y las variables de imágenes
npm run seed                 # carga data/out/*.ndjson en MongoDB (idempotente)
npm run dev
```

| Comando                   | Qué hace                                                 |
| ------------------------- | -------------------------------------------------------- |
| `npm run dev`             | Servidor de desarrollo                                   |
| `npm run check`           | Typecheck, lint, chequeo de formato y tests unitarios    |
| `npm run test:e2e`        | Tests de capturas con Playwright                         |
| `npm run pipeline:<step>` | Un paso del pipeline de datos (ver `pipeline/README.md`) |
| `npm run seed`            | Hace upsert de los NDJSON en MongoDB                     |
| `npm run atlas:check`     | Verifica que el usuario de Mongo de la app solo lea      |

Para regenerar los datos hace falta tener tippecanoe en el `PATH`. DuckDB se instala con `npm ci`.
El orden completo del pipeline y sus requisitos están en [pipeline/README.md](pipeline/README.md).

### Estructura del repositorio

```
app/          páginas, /attributions, /api/{rivers,reaches,subbasins,search,health}
components/   mapa, paneles, controles, búsqueda, panel móvil
lib/          mongo.ts, data/ (esquemas, consultas), map/ (estilo, máscara, minimapa), store.ts, url-state.ts
messages/     en.json, es.json
pipeline/     pasos del pipeline de datos, configuración, SOURCES.md
scripts/      seed, chequeo de Atlas, formas para la imagen OG
public/tiles/ archivos PMTiles (commiteados)
```

Documentación del proyecto: [PLAN.md](PLAN.md) (fases y estado) y [DECISSIONS.md](DECISSIONS.md)
(decisiones fechadas).

### Datos y licencias

Los datos vienen de HydroSHEDS (HydroRIVERS, RiverATLAS, HydroBASINS), HydroLAKES, GIRES, IGN
(Argentina) y OpenStreetMap. Las imágenes satelitales son EOxCloudless 2024 (CC BY-NC-SA 4.0), por
lo que el sitio es **no comercial**. Las licencias y citas completas están en
[pipeline/SOURCES.md](pipeline/SOURCES.md) y en la página `/attributions` de la app.
