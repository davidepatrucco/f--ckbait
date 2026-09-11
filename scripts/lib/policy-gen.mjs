// Genera il file di soglie incluso nel pacchetto dell'estensione a partire dalla
// FONTE UNICA (backend/src/policy.mjs). Il browser non ridichiara nessun numero:
// senza questa generazione, una soglia cambiata sul backend resterebbe diversa nel
// pacchetto, che è esattamente il tipo di divergenza emerso dall'audit.
import { publicLimits } from '../../backend/src/policy.mjs';

export function generatePolicyJs() {
    const limits = publicLimits();
    return `// GENERATO da scripts/lib/policy-gen.mjs a partire da backend/src/policy.mjs.
// Non modificare a mano: le soglie hanno una sola fonte, condivisa con il backend.
globalThis.RI_POLICY = ${JSON.stringify(limits, null, 4)};
`;
}
