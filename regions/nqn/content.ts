import type { RegionContent } from "../content";

/** Río Negro basin (Limay, Neuquén, Negro): what the app shows that isn't a UI string. */
export const nqnContent: RegionContent = {
  featuredRivers: [
    { id: "limay", name: "Limay" },
    { id: "neuquen", name: "Neuquén" },
    { id: "negro", name: "Río Negro" },
  ],
  landingSample: { river: "limay", subbasin: "neuquen" },
  ogSubtitle: "Limay · Neuquén · Río Negro",
  llm: {
    place: "the Río Negro basin (Patagonia, Argentina)",
    withinExample: '"in the Limay basin", "de la cuenca del Neuquén"',
    examples: `"Show me the Limay" -> {"action":"select_river","kind":null,"slug":"limay","slugs":null,"metric":null,"order":null,"scope":null,"query":null,"filters":null}
"cuenca del Neuquén" -> {"action":"select_subbasin","kind":null,"slug":"neuquen","slugs":null,"metric":null,"order":null,"scope":null,"query":null,"filters":null}
"¿Qué río es más largo, Caleufú o Agrio?" -> {"action":"compare","kind":"river","slug":null,"slugs":["caleufu","agrio"],"metric":"length","order":"max","scope":null,"query":null,"filters":null}
"¿cuál es más corto, el Caleufú o el Agrio?" -> {"action":"compare","kind":"river","slug":null,"slugs":["caleufu","agrio"],"metric":"length","order":"min","scope":null,"query":null,"filters":null}
"the longest tributary of the Limay" -> {"action":"rank","kind":"river","slug":"limay","slugs":null,"metric":"length","order":"max","scope":"tributaries","query":null,"filters":null}
"el afluente más largo del Limay" -> {"action":"rank","kind":"river","slug":"limay","slugs":null,"metric":"length","order":"max","scope":"tributaries","query":null,"filters":null}
"the biggest tributary of the Limay" -> {"action":"rank","kind":"river","slug":"limay","slugs":null,"metric":"upstreamArea","order":"max","scope":"tributaries","query":null,"filters":null}
"la subcuenca más grande" -> {"action":"rank","kind":"subbasin","slug":null,"slugs":null,"metric":"area","order":"max","scope":"all","query":null,"filters":null}
"how much water does the Neuquén carry" -> {"action":"fact","kind":"river","slug":"neuquen","slugs":null,"metric":"discharge","order":null,"scope":null,"query":null,"filters":null}
"caudal del Neuquén" -> {"action":"fact","kind":"river","slug":"neuquen","slugs":null,"metric":"discharge","order":null,"scope":null,"query":null,"filters":null}
"how many people live in the Limay basin" -> {"action":"fact","kind":"subbasin","slug":"limay","slugs":null,"metric":"population","order":null,"scope":null,"query":null,"filters":null}
"temperatura del Limay" -> {"action":"unsupported","kind":null,"slug":null,"slugs":null,"metric":null,"order":null,"scope":null,"query":null,"filters":null}
"el río permanente más corto" -> {"action":"rank","kind":"river","slug":null,"slugs":null,"metric":"length","order":"min","scope":"all","query":null,"filters":[{"type":"regime","value":"perennial","slug":null,"metric":null,"op":null,"number":null}]}
"which intermittent river is longest" -> {"action":"rank","kind":"river","slug":null,"slugs":null,"metric":"length","order":"max","scope":"all","query":null,"filters":[{"type":"regime","value":"nonPerennial","slug":null,"metric":null,"op":null,"number":null}]}
"ríos con represas" -> {"action":"rank","kind":"river","slug":null,"slugs":null,"metric":"length","order":"max","scope":"all","query":null,"filters":[{"type":"regulated","value":"yes","slug":null,"metric":null,"op":null,"number":null}]}
"¿qué ríos son intermitentes?" -> {"action":"rank","kind":"river","slug":null,"slugs":null,"metric":"length","order":"max","scope":"all","query":null,"filters":[{"type":"regime","value":"nonPerennial","slug":null,"metric":null,"op":null,"number":null}]}
"ríos de la cuenca del Limay de más de 100 km" -> {"action":"rank","kind":"river","slug":null,"slugs":null,"metric":"length","order":"max","scope":"all","query":null,"filters":[{"type":"within","value":null,"slug":"limay","metric":null,"op":null,"number":null},{"type":"threshold","value":null,"slug":null,"metric":"length","op":"gt","number":100}]}
"rivers shorter than 50 km without dams" -> {"action":"rank","kind":"river","slug":null,"slugs":null,"metric":"length","order":"max","scope":"all","query":null,"filters":[{"type":"threshold","value":null,"slug":null,"metric":"length","op":"lt","number":50},{"type":"regulated","value":"no","slug":null,"metric":null,"op":null,"number":null}]}
"ríos de más de 100 millas" -> {"action":"unsupported","kind":null,"slug":null,"slugs":null,"metric":null,"order":null,"scope":null,"query":null,"filters":null}
"ríos de la provincia de Neuquén" -> {"action":"unsupported","kind":null,"slug":null,"slugs":null,"metric":null,"order":null,"scope":null,"query":null,"filters":null}
"arroyo Foo" (not in the lists) -> {"action":"search","kind":null,"slug":null,"slugs":null,"metric":null,"order":null,"scope":null,"query":"arroyo Foo","filters":null}`,
  },
};

export default nqnContent;
