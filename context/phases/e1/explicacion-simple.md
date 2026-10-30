# Vertidos en el Suquía, contado fácil

> Versión para explicarle el proyecto a alguien que recién llega, sin fórmulas. La versión técnica está en
> [resumen-proyecto.md](resumen-proyecto.md). Estado al 30/10/2026.
>
> **Para los autores del informe de la UNC que se suman:** lo de ustedes está marcado con 🔵. Si están apurados,
> vayan directo a [Dónde entra el informe de la UNC](#dónde-entra-el-informe-de-la-unc).

## La idea en dos minutos

Imaginá que tirás un vaso de jugo en una pileta y después el mismo vaso en un balde. En la pileta no se nota; en el
balde, sí. Con un río pasa lo mismo: **el mismo vertido no hace el mismo daño todos los días**, depende de cuánta agua
trae el río ese día.

Hoy en Córdoba el permiso de vertido dice "tu efluente no puede tener más de tanto de esto". Mira cuán "sucia" sale
el agua de la planta, pero **no mira cuánta agua trae el río** para diluirla. Un día normal no pasa nada; en plena
seca, el mismo vertido puede dejar kilómetros de río casi sin oxígeno.

Lo que armamos es una página web que responde, para un punto de vertido y el caudal del río de hoy o de los próximos
días:

- **¿Hasta dónde llega la mancha?** Se ve pintada sobre el río, en el mapa.
- **¿Cuánto aguanta el río hoy?** Cuánta carga puede recibir sin pasarse de un umbral.
- **¿Cuánto habría que limpiar el efluente?** Un porcentaje.
- **¿Qué días conviene más verter?** Mirando el pronóstico (esto es un extra, si llegamos).

El caso principal es la planta de **Bajo Grande**, que vierte al Suquía aguas abajo de la ciudad. El caso secundario
es el **Embalse San Roque**, adonde llegan el Cosquín y el San Antonio cargados de fósforo, que es lo que alimenta a
las algas.

## Para quién es

Para quien controla los vertidos: APRHI o un municipio. La pregunta que le contestamos es: _"con el río como está hoy
y como va a estar esta semana, ¿este vertido está bien? ¿Qué le pido a la planta?"_.

## Cómo se usa

1. Entrás a la página de Córdoba y ves el mapa de los ríos.
2. Tocás un tramo del Suquía y elegís "Simular un vertido acá", o elegís directamente el caso cargado de Bajo Grande.
3. Ponés cuánto vierte la planta y qué tan cargada viene el agua. Si no sabés, arranca con lo máximo que permite el
   permiso.
4. Elegís qué río querés mirar: un día "normal" (el promedio de muchos años), **hoy**, o **un día del pronóstico**.
5. El mapa pinta de colores los tramos aguas abajo: dónde se pasa del umbral y hasta dónde.
6. Un panelito al costado te da tres números: cuántos km de mancha, cuánto oxígeno queda en el peor punto y cuánto
   aguantaría el río.
7. Si querés más, tocás **"Ver análisis completo"** y se abre otra página con gráficos: cómo baja y se recupera el
   oxígeno a lo largo del río, los escenarios lado a lado, la historia de otros años y qué días conviene verter.
8. El link se puede compartir y abre exactamente lo mismo que estabas viendo.

Separamos el mapa de los gráficos para que el mapa no quede lleno de cosas: en el mapa va lo que tiene que ver con
"dónde"; los gráficos van aparte.

## Qué pasa por adentro, sin fórmulas

1. **¿Cuánta agua trae el río hoy?** Usamos un pronóstico de caudal europeo gratuito (GloFAS, de Copernicus). Mira dos
   lugares: el Suquía en Centro Cívico y la entrada al San Roque. Comparamos el valor de hoy con el promedio de ese
   mismo lugar y aplicamos esa proporción a todo el río. Si hoy viene la mitad de lo normal, suponemos que cada tramo
   trae la mitad de lo normal.
2. **El efluente se mezcla con el río** en el punto de vertido.
3. **El agua viaja río abajo.** Recorremos el río tramo por tramo y calculamos qué tan rápido va el agua y qué tan
   profundo es el cauce. 🔵 Para eso hace falta saber **qué tan "rugoso" es el lecho**, y ese dato lo sacamos del
   informe de la UNC.
4. **En el camino:**
   - la materia orgánica se va comiendo el oxígeno del agua;
   - el río vuelve a tomar oxígeno del aire, más rápido si es poco profundo y corre;
   - las bacterias del efluente se van muriendo con el tiempo;
   - cada arroyo que se suma diluye todo.
5. **El resultado** es, para cada tramo, cuánto hay de cada cosa. Con eso sale el largo de la mancha, el peor punto de
   oxígeno y cuánta carga aguanta el río.

Todo corre en el navegador y es instantáneo: movés algo y el mapa cambia al toque.

Para el San Roque usamos una cuenta más simple y conocida, que trata al embalse como un tanque bien mezclado y estima
cuánto fósforo va a tener y si queda en estado "muy cargado de nutrientes" o no.

## Lo que ya sale (Bajo Grande, con el máximo del permiso)

- **Un día normal:** el río se la banca. Cumplir el permiso alcanza.
- **En una seca fuerte:** el oxígeno cae muy por debajo del umbral. Y lo curioso es que el problema no es tanto la
  materia orgánica, sino que el efluente llega **sin oxígeno**. La herramienta lo dice así, en lugar de pedir algo
  imposible como "sacá el 100 %".

Ese es el mensaje para el jurado: **un permiso fijo no sirve igual todos los días**.

## Dónde entra el informe de la UNC

🔵 El informe de Grosso Ribero, Olivieri y Viotti (UNC, agosto de 2026) sobre las curvas altura‑caudal del Suquía,
el Cosquín y el San Antonio entra en tres lugares. El primero ya está; los otros dos los armamos con ustedes.

### 1. Ya está adentro: qué tan rugoso es el lecho

- **Qué tomamos:** el rango del coeficiente de rugosidad (Manning) que sale del informe, de 0,03 a 0,05.
- **Para qué sirve:** con eso calculamos qué tan rápido corre el agua y qué tan profundo es cada tramo. De eso depende
  cuánto tarda la mancha en llegar a cada lugar y cuánto oxígeno recupera el río en el camino.
- **Cómo se ve en la app:** no se ve como un número suelto. Es parte de la "banda" de resultados: la app muestra un
  valor central y un rango, y la rugosidad es una de las cosas que mueve ese rango.
- **Qué falta:** que nos confirmen que está bien usarlo así y cómo quieren que los citemos. Hoy figura con la
  aclaración "cita pendiente de permiso".

### 2. Para el hackatón, si llegamos: "leí la escala, ¿cuánta agua es?"

El pronóstico europeo es un modelo global, con una grilla de unos 5 km: sirve para la tendencia, no reemplaza una
medición. Las curvas de ustedes permiten pasar de **la altura del agua en una escala** a **caudal**.

- **Qué agregaríamos:** en el panel, además de "promedio / hoy / pronóstico", una cuarta opción: **"Nivel medido"**.
  Escribís la altura que marca la escala en una estación y la app la convierte en caudal con su curva.
- **Para qué sirve:** que el regulador use un dato real del día en vez del pronóstico global, y que en la página de
  análisis se vea lado a lado "lo que dice el pronóstico" contra "lo que dice la escala".
- **Qué necesitamos de ustedes:**
  1. las estaciones con su ubicación y en qué tramo del río caen;
  2. los parámetros de cada curva y el rango de alturas donde vale (sus valores finales, con la incertidumbre si la
     tienen);
  3. hasta qué altura se puede confiar en cada curva, para que la app avise si alguien escribe un nivel fuera de rango.
- **Por qué es manual:** no hay forma pública de leer las escalas en tiempo real (Omixom no tiene una API abierta), así
  que por ahora el nivel se escribe a mano.

### 3. Después del hackatón: corregir el pronóstico

El paso siguiente que más suma es **corregir el pronóstico europeo con las mediciones locales**: comparar muchos días
de "lo que dijo GloFAS" con "lo que dio la curva" y aprender cuánto se equivoca y en qué condiciones. Ahí sí entra
aprendizaje automático con sentido, porque hay datos reales para aprender. Con eso, todo lo demás (la mancha, el
"cuánto aguanta", el "qué días verter") pasa a ser más confiable.

### Resumen para ustedes

| Qué                          | Estado               | Qué hace falta de ustedes                          |
| ---------------------------- | -------------------- | -------------------------------------------------- |
| Rugosidad del lecho          | Ya se usa            | OK para usarlo y forma de citarlo                  |
| "Nivel medido" → caudal      | Para el hackatón     | Estaciones, parámetros de las curvas, rango válido |
| Corregir el pronóstico       | Después del hackatón | Series de nivel o caudal medidos, si las tienen    |

## Lo que tenemos que decir de frente

- Es una herramienta para **comparar escenarios y ordenar prioridades**, no un estudio de calidad de agua calibrado.
- Los coeficientes salen de libros de referencia, no de mediciones en el Suquía. Por eso siempre mostramos un rango y
  no un único número.
- Córdoba no fija un mínimo de oxígeno para los ríos: usamos 5 mg/L y se puede cambiar.
- No hay datos públicos de lo que sale de Bajo Grande: arrancamos con el máximo que permite el permiso.
- "Qué días conviene verter" es el mismo modelo corrido muchas veces, no inteligencia artificial.

## Cómo vamos

- ✅ Datos del río y del pronóstico, listos.
- ✅ El "motor" que calcula todo, listo y probado.
- ⏳ Falta la parte que se ve: el mapa con la mancha, el panelito y la página de análisis. Objetivo: 8 de noviembre.
- ⏳ Extras si llegamos: historia de otros años, "qué días verter", San Roque y 🔵 el "nivel medido" con las curvas de
  la UNC.
- 📅 Hackatón: 12 y 13 de noviembre.

## Lo que falta averiguar

1. Los límites exactos de la norma para bacterias y fósforo (hay que leerlos en el PDF oficial, a mano).
2. Dónde está exactamente la salida de Bajo Grande al río (mirarlo en imagen satelital).
3. 🔵 Con los chicos de la UNC: el OK para citarlos y los datos de las curvas.
