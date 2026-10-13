import type { RegionContent } from "../content";

/**
 * Basins of Córdoba (APRHI's six interprovincial basins, R3): what the app shows that isn't a
 * UI string. River picks span three basins (Carcarañá, Mar Chiquita, Río Quinto); every slug
 * exists in data/out/cba (tests check it).
 */
export const cbaContent: RegionContent = {
  featuredRivers: [
    { id: "tercero", name: "Río Tercero" },
    { id: "dulce", name: "Río Dulce" },
    { id: "quinto", name: "Río Quinto" },
  ],
  landingSample: { river: "tercero", subbasin: "mar-chiquita" },
  ogSubtitle: "Primero · Segundo · Tercero · Cuarto · Quinto · Mar Chiquita",
  llm: {
    place:
      "the basins of Córdoba (Argentina): Mar Chiquita, Salinas Grandes, the Carcarañá and the Río Quinto",
    withinExample: '"in the Mar Chiquita basin", "de la cuenca del Carcarañá"',
    examples: `"Show me the Tercero" -> {"action":"select_river","kind":null,"slug":"tercero","slugs":null,"metric":null,"order":null,"scope":null,"query":null,"filters":null}
"cuenca de Mar Chiquita" -> {"action":"select_subbasin","kind":null,"slug":"mar-chiquita","slugs":null,"metric":null,"order":null,"scope":null,"query":null,"filters":null}
"¿Qué río es más largo, Primero o Segundo?" -> {"action":"compare","kind":"river","slug":null,"slugs":["primero","segundo"],"metric":"length","order":"max","scope":null,"query":null,"filters":null}
"¿cuál es más corto, el Primero o el Segundo?" -> {"action":"compare","kind":"river","slug":null,"slugs":["primero","segundo"],"metric":"length","order":"min","scope":null,"query":null,"filters":null}
"the longest tributary of the Carcarañá" -> {"action":"rank","kind":"river","slug":"carcarana","slugs":null,"metric":"length","order":"max","scope":"tributaries","query":null,"filters":null}
"el afluente más largo del Carcarañá" -> {"action":"rank","kind":"river","slug":"carcarana","slugs":null,"metric":"length","order":"max","scope":"tributaries","query":null,"filters":null}
"the biggest tributary of the Carcarañá" -> {"action":"rank","kind":"river","slug":"carcarana","slugs":null,"metric":"upstreamArea","order":"max","scope":"tributaries","query":null,"filters":null}
"la subcuenca más grande" -> {"action":"rank","kind":"subbasin","slug":null,"slugs":null,"metric":"area","order":"max","scope":"all","query":null,"filters":null}
"how much water does the Dulce carry" -> {"action":"fact","kind":"river","slug":"dulce","slugs":null,"metric":"discharge","order":null,"scope":null,"query":null,"filters":null}
"caudal del Dulce" -> {"action":"fact","kind":"river","slug":"dulce","slugs":null,"metric":"discharge","order":null,"scope":null,"query":null,"filters":null}
"how many people live in the Mar Chiquita basin" -> {"action":"fact","kind":"subbasin","slug":"mar-chiquita","slugs":null,"metric":"population","order":null,"scope":null,"query":null,"filters":null}
"temperatura del Tercero" -> {"action":"unsupported","kind":null,"slug":null,"slugs":null,"metric":null,"order":null,"scope":null,"query":null,"filters":null}
"el río permanente más corto" -> {"action":"rank","kind":"river","slug":null,"slugs":null,"metric":"length","order":"min","scope":"all","query":null,"filters":[{"type":"regime","value":"perennial","slug":null,"metric":null,"op":null,"number":null}]}
"which intermittent river is longest" -> {"action":"rank","kind":"river","slug":null,"slugs":null,"metric":"length","order":"max","scope":"all","query":null,"filters":[{"type":"regime","value":"nonPerennial","slug":null,"metric":null,"op":null,"number":null}]}
"ríos con represas" -> {"action":"rank","kind":"river","slug":null,"slugs":null,"metric":"length","order":"max","scope":"all","query":null,"filters":[{"type":"regulated","value":"yes","slug":null,"metric":null,"op":null,"number":null}]}
"¿qué ríos son intermitentes?" -> {"action":"rank","kind":"river","slug":null,"slugs":null,"metric":"length","order":"max","scope":"all","query":null,"filters":[{"type":"regime","value":"nonPerennial","slug":null,"metric":null,"op":null,"number":null}]}
"ríos de la cuenca de Mar Chiquita de más de 100 km" -> {"action":"rank","kind":"river","slug":null,"slugs":null,"metric":"length","order":"max","scope":"all","query":null,"filters":[{"type":"within","value":null,"slug":"mar-chiquita","metric":null,"op":null,"number":null},{"type":"threshold","value":null,"slug":null,"metric":"length","op":"gt","number":100}]}
"rivers shorter than 50 km without dams" -> {"action":"rank","kind":"river","slug":null,"slugs":null,"metric":"length","order":"max","scope":"all","query":null,"filters":[{"type":"threshold","value":null,"slug":null,"metric":"length","op":"lt","number":50},{"type":"regulated","value":"no","slug":null,"metric":null,"op":null,"number":null}]}
"ríos de más de 100 millas" -> {"action":"unsupported","kind":null,"slug":null,"slugs":null,"metric":null,"order":null,"scope":null,"query":null,"filters":null}
"ríos del departamento Calamuchita" -> {"action":"unsupported","kind":null,"slug":null,"slugs":null,"metric":null,"order":null,"scope":null,"query":null,"filters":null}
"arroyo Foo" (not in the lists) -> {"action":"search","kind":null,"slug":null,"slugs":null,"metric":null,"order":null,"scope":null,"query":"arroyo Foo","filters":null}`,
  },
};

export default cbaContent;
