# Vertidos en la cuenca del Suquía: resumen del proyecto

> Documento para el equipo y para preparar el pitch de **Hack to the Future** (Córdoba Cluster, 12 y 13 de noviembre
> de 2026). Lo técnico en detalle está en [e1-effluents.md](../e1-effluents.md) y en
> [DECISSIONS.md](../../DECISSIONS.md#phase-e1-effluent-impact-2026-10-29).
> Estado al 29/10/2026: modelo y datos listos (E1.0–E1.2); falta la interfaz.

## En una frase

Una herramienta en el mapa que, dado un punto de vertido y el caudal del río **hoy o en los próximos días**, muestra
**hasta dónde llega la contaminación**, **cuánta carga puede recibir el río con ese caudal** y **cuánto habría que
tratar el efluente** para no superar los límites.

## El problema

- En Córdoba los permisos de vertido fijan **concentraciones** (por ejemplo, DBO₅ ≤ 40 mg/L según el Decreto 847/16).
  No miran cuánto caudal trae el río ese día.
- Pero el río no es siempre el mismo: con caudal medio diluye y se recupera; en estiaje, el mismo vertido puede dejar
  kilómetros de río sin oxígeno.
- El caso más conocido es el de la planta de **Bajo Grande**, que vierte al Suquía aguas abajo de la ciudad. El otro
  es la carga de **fósforo** que llega al **Embalse San Roque** por el Cosquín y el San Antonio, que alimenta las
  cianobacterias.

## Para quién es

Para el **regulador**: APRHI o un municipio. La pregunta que le resolvemos es _"con el caudal de hoy y el que viene,
¿este vertido está bien o no, y qué le pido a la planta?"_.

## Qué responde

| Pregunta                  | Qué muestra la app                                                    |
| ------------------------- | --------------------------------------------------------------------- |
| ¿Hasta dónde llega?       | Largo de la "pluma" en km por encima del umbral, coloreada en el mapa |
| ¿Cuánto oxígeno queda?    | Oxígeno disuelto mínimo y en qué kilómetro ocurre                     |
| ¿Cuánto aguanta el río?   | Concentración admisible del efluente para ese caudal                  |
| ¿Qué hay que hacer?       | Porcentaje de remoción necesario                                      |
| ¿Qué tan seguros estamos? | Una banda de incertidumbre (9 combinaciones de coeficientes)          |
| ¿Y el lago?               | Fósforo esperado en San Roque y su estado trófico (extra)             |

## Cómo funciona, sin vueltas

1. **Caudal.** Tomamos el pronóstico de caudal de **GloFAS** (servicio europeo Copernicus, vía Open‑Meteo) en dos
   puntos: Centro Cívico (Suquía) y la entrada al San Roque. Lo comparamos con el promedio histórico de ese mismo punto
   y aplicamos esa proporción a cada tramo del río. Si hoy el Suquía trae la mitad de lo normal, cada tramo también.
2. **Mezcla.** En el punto de vertido, el efluente se mezcla con el río según los caudales de ambos.
3. **Viaje aguas abajo.** Recorremos la red de ríos tramo por tramo (223 tramos en la cuenca del Suquía). En cada uno
   calculamos velocidad y profundidad con la pendiente real del cauce (fórmula de Manning) y, con eso, cuánto tarda el
   agua en recorrerlo.
4. **Lo que pasa en el camino.**
   - La materia orgánica (DBO) se degrada y consume oxígeno.
   - El río recupera oxígeno del aire (reaireación).
   - El balance entre las dos cosas es el clásico modelo de **Streeter‑Phelps**.
   - Los coliformes mueren con el tiempo.
   - Cada afluente que entra diluye todo.
5. **Resultado.** Para cada tramo sabemos la concentración, y con eso el largo de la pluma, el mínimo de oxígeno y la
   carga admisible. La respuesta es lineal en la carga, así que el admisible sale directo, sin prueba y error.
6. **Embalse (extra).** San Roque se trata como un tanque bien mezclado con el modelo **OECD/Vollenweider** para el
   fósforo.

Todo el cálculo corre **en el navegador** y tarda milisegundos, así que al mover un control el mapa cambia al
instante.

## Flujo de datos

> Las imágenes se generan desde el código Mermaid de cada bloque desplegable. Si cambiás un diagrama, regenerá su SVG
> en `img/`.

![Flujo de datos](img/flujo-datos.svg)

<details>
<summary>Código Mermaid (para editar el diagrama)</summary>

```mermaid
flowchart LR
  subgraph Fuentes
    HR["HydroRIVERS / RiverATLAS<br/>red de ríos, caudal medio, pendiente"]
    GF["GloFAS v4 (Open-Meteo)<br/>caudal histórico y pronóstico"]
    CFG["effluent.config.json<br/>vertidos, umbrales, coeficientes<br/>(cada número con su fuente)"]
  end

  subgraph Pipeline["Pipeline (se corre una vez)"]
    STEP["pipeline:effluent-net<br/>recorta la cuenca del Suquía<br/>y calcula el promedio GloFAS"]
    NET["effluent-net.json<br/>223 tramos · 2 puntos de aforo · 14 KB"]
  end

  subgraph App["App (Next.js)"]
    API["/cordoba/api/discharge<br/>pronóstico del día (E1.3)"]
    MODEL["lib/effluent<br/>modelo de calidad"]
    UI["Mapa + panel de vertidos<br/>(E1.4 y E1.5)"]
  end

  HR --> STEP
  GF -- "1997–2022" --> STEP
  CFG --> STEP
  STEP --> NET
  NET --> MODEL
  CFG --> MODEL
  GF -- "hoy + 30 días" --> API
  API --> MODEL
  MODEL --> UI
```

</details>

## Flujo del usuario

![Flujo del usuario](img/flujo-usuario.svg)

<details>
<summary>Código Mermaid (para editar el diagrama)</summary>

```mermaid
flowchart TD
  A["Abre /cordoba"] --> B{"¿Cómo empieza?"}
  B -- "Toca un tramo del río" --> C["Panel del tramo:<br/>'Simular un vertido acá'"]
  B -- "Elige un caso cargado" --> D["Preset: EDAR Bajo Grande"]
  C --> E["Modo vertidos"]
  D --> E
  E --> F["Carga caudal y concentraciones del efluente<br/>(por defecto: el límite del permiso)"]
  F --> G["Elige escenario:<br/>promedio histórico · hoy · pronóstico día N"]
  G --> H["El modelo corre en el navegador"]
  H --> I["Mapa: tramos coloreados aguas abajo"]
  H --> J["Panel: pluma en km, oxígeno mínimo,<br/>admisible, remoción necesaria, incertidumbre"]
  J --> K{"¿Supera el umbral?"}
  K -- "Sí" --> L["Mueve el control de remoción<br/>o cambia de escenario"]
  L --> H
  K -- "No" --> M["Comparte el link (?ef=...)<br/>con el mismo escenario"]
```

</details>

## Diagrama de clases (módulo `lib/effluent`)

Lo que ya existe está en `lib/effluent/`. Los componentes marcados como `planned` son de E1.3–E1.5.

![Diagrama de clases de lib/effluent](img/clases.svg)

<details>
<summary>Código Mermaid (para editar el diagrama)</summary>

```mermaid
classDiagram
  direction LR

  class EffluentConfig {
    mouthReach: number
    gauges: Gauge[]
    gaugeSplit
    lake: LakeConfig
    outfalls: OutfallConfig[]
    thresholds
    coefficients
    background
  }
  class EffluentNet {
    reaches: NetReach[]
    gauges: NetGauge[]
    lake: LakeConfig
    outfalls
  }
  class NetReach {
    id: number
    nextDown: number
    lengthKm: number
    dischargeM3s: number
    gradientMPerKm: number
    uplandKm2: number
    gauge: string
  }
  class NetGauge {
    id: string
    cell: lat/lon
    climatology: meanM3s, days, from, to
  }
  class LakeConfig {
    inReaches: number[]
    outReach: number
    volumeHm3
    tpLoadTPerYr
    residenceYr: low/high
  }

  class ModelParams {
    kdPerDay, kbPerDay
    thetas
    hydraulics: HydraulicsParams
    tempC, elevationM
    bodBottleRatePerDay
    background
  }
  class Effluent {
    reachId: number
    flowM3s: number
    bodMgL: number
    doMgL: number
    coliformsPer100mL: number?
    tpMgL: number?
  }
  class Thresholds {
    doMinMgL: number
    bodMgL: number?
    coliformsPer100mL: number?
    tpMgL: number?
  }
  class Scenario {
    gaugeId → m3/s
  }
  class SimulationInput {
    net: EffluentNet
    params: ModelParams
    effluent: Effluent
    scenario: Scenario
    thresholds: Thresholds
  }
  class SimulationResult {
    path: ReachResult[]
    summary: minDo, peak, plume, totalKm, entersLake
    flags
    doSaturationMgL
  }
  class ReachResult {
    id, kmStart, kmEnd
    qM3s, velocityMs, depthM
    kaPerDay, kdPerDay, travelDays
    valores al final, doMinMgL, doMinKm
    samples: Sample[]
  }
  class Admissible {
    admissible: number?
    units: BOD5 | per100mL
    baseViolates: boolean
    cause: effluentDo | background
    binding: km, reachId
    requiredRemovalPct: number?
  }
  class UncertaintyBand {
    min / central / max
    9 corridas
  }
  class OecdResult {
    residenceYr
    pInUgL
    pLakeUgL
    trophic: TrophicClass
  }

  class river {
    <<module>>
    simulate(input) SimulationResult
    admissibleLoad(input) AdmissibleLoad
    uncertaintyBand(input) UncertaintyBand
    paramsFromConfig(config, levels)
    effluentFromConfig(config, id)
    thresholdsFromConfig(config)
    longTermMeanScenario(net)
  }
  class hydraulics {
    <<module>>
    reachFlow()
    reachHydraulics()
    reaeration20()
    temperatureCorrect()
    doSaturation()
  }
  class reservoir {
    <<module>>
    oecdLake(input) OecdResult
    lakeBand()
    trophicClass()
  }
  class schema {
    <<module>>
    parseEffluentConfig()
    parseEffluentNet()
  }

  class DischargeRoute {
    <<planned E1.3>>
    GET /cordoba/api/discharge
  }
  class EffluentController {
    <<planned E1.4>>
    capa del mapa por id de tramo
  }
  class EffluentPanel {
    <<planned E1.5>>
    entradas, resultados, supuestos
  }

  EffluentNet "1" *-- "many" NetReach
  EffluentNet "1" *-- "2" NetGauge
  EffluentNet --> LakeConfig
  EffluentConfig --> LakeConfig
  schema ..> EffluentConfig : valida
  schema ..> EffluentNet : valida
  river ..> hydraulics : usa
  river ..> SimulationInput : recibe
  river ..> SimulationResult : devuelve
  river ..> Admissible : devuelve
  river ..> UncertaintyBand : devuelve
  SimulationInput --> EffluentNet
  SimulationInput --> ModelParams
  SimulationInput --> Effluent
  SimulationInput --> Scenario
  SimulationInput --> Thresholds
  SimulationResult "1" *-- "many" ReachResult
  reservoir ..> OecdResult : devuelve
  DischargeRoute ..> Scenario : arma
  EffluentPanel ..> river : llama
  EffluentController ..> SimulationResult : pinta
```

</details>

## Primeros resultados (Bajo Grande, efluente al límite del permiso)

| Escenario                       | Oxígeno mínimo                 | DBO₅ admisible                         | Remoción necesaria |
| ------------------------------- | ------------------------------ | -------------------------------------- | ------------------ |
| Caudal medio histórico          | 6,24 mg/L, justo en el vertido | 414 mg/L (banda 130–2.448)             | 0 %                |
| Muy seco (5 % del caudal medio) | 1,29 mg/L                      | no hay: el límite se rompe aun sin DBO | no calculable      |

Cómo leerlo:

- **Con caudal normal**, cumplir el permiso alcanza: el río se banca la carga.
- **En estiaje**, lo que rompe el umbral no es la DBO sino que el efluente llega **sin oxígeno**. El modelo lo dice
  ("causa: oxígeno del efluente") en lugar de pedir "sacá el 100 % de la DBO".
- Ese contraste es el corazón del pitch: **un permiso fijo no sirve igual todos los días**.

## Supuestos y límites (lo que tenemos que decir de frente)

- Es un **modelo de cribado** (_screening_), no uno calibrado. Sirve para comparar escenarios y ordenar prioridades;
  no reemplaza un estudio de calidad de agua.
- Los coeficientes son **rangos de bibliografía** (Chapra 1997, Bowie et al. 1985), no medidos en el Suquía. Por eso
  mostramos siempre una banda.
- **GloFAS es un modelo global** de unos 5 km de grilla. Sirve como tendencia, no como aforo.
- Córdoba **no fija un mínimo de oxígeno** para ríos: usamos 5 mg/L como supuesto editable.
- No hay datos públicos del efluente de Bajo Grande: por defecto usamos el **límite del permiso** (escenario de
  cumplimiento) y suponemos que llega sin oxígeno.
- El modelo de río **no cruza el embalse**: San Roque va con su propio modelo anual.
- No hay niveles en tiempo real: Omixom no tiene API pública. Las curvas altura‑caudal del informe de la UNC (Grosso
  Ribero, Olivieri y Viotti) pueden entrar como dato manual si sus autores lo autorizan.

## Estado

- [x] **E1.0** Documentación, decisiones y fuentes
- [x] **E1.1** Datos: red del Suquía y promedios GloFAS (`pipeline:effluent-net`)
- [x] **E1.2** Modelo de calidad con tests, revisado
- [ ] **E1.3** Ruta de pronóstico de caudal
- [ ] **E1.4** Modo vertidos en el mapa
- [ ] **E1.5** Panel con entradas, resultados y supuestos (español e inglés)
- [ ] Extras: panel de San Roque (E1.6), "cuándo verter" con corridas históricas (E1.H), curvas de la UNC (E1.R),
      partículas de flujo coloreadas (E1.F)

Rama `phase-e1-effluents`, subida a GitHub, sin PR todavía.

## Pendientes del equipo (antes de mostrarlo)

1. **Límites normativos**: leer en el navegador el límite de coliformes del Decreto 847/16 (Anexo I) y los valores de
   fósforo y amonio de la Res. APRHI 3/2025. Los PDF oficiales no se dejan leer por scripts.
2. **Punto de vertido de Bajo Grande**: ubicarlo en imagen satelital y confirmar el tramo 61477479.
3. **Permiso de los autores del informe de la UNC** para citar y usar sus curvas.
4. **Inscripción** al hackatón antes del 31/10 y revisar las instrucciones del 2/11.

## Después del hackatón (hoja de ruta)

En el orden en que suma valor:

1. Corregir el sesgo de GloFAS con aforos locales y las curvas de la UNC.
2. Calibrar los coeficientes cuando haya datos de monitoreo (INA‑CIRSA, CEQUIMAP).
3. Recién ahí, aprendizaje automático: una política de "cuándo y cuánto verter" (almacenamiento y descarga
   programada) optimizada sobre corridas históricas y de pronóstico.

Sin datos de monitoreo, un modelo de ML solo aprendería de vuelta nuestro propio modelo. Por eso queda para después.
