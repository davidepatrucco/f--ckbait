// Corpus di misura per gli unit economics. Testi coerenti, di dominio diverso
// (tech / salute / finanza), usati IDENTICI per tutti i brand: così le differenze
// di costo per summary riflettono il prompt profile + output schema del brand,
// non il contenuto. Le classi di dimensione approssimano short/medium/long article.

const TECH = `Il consorzio che sviluppa lo standard ha pubblicato la revisione annuale delle specifiche, introducendo un meccanismo di negoziazione delle capacità tra client e server. Nelle versioni precedenti il client dichiarava un insieme fisso di funzionalità al momento della connessione; ora la negoziazione avviene in modo incrementale, riducendo la latenza iniziale nei dispositivi con banda limitata. I fornitori di browser hanno accolto la modifica con prudenza: due implementazioni sperimentali sono già disponibili dietro flag, mentre gli altri attendono la stabilizzazione dei test di conformità. Gli sviluppatori applicativi non dovranno modificare il codice esistente, perché il livello di compatibilità mantiene il comportamento legacy quando la controparte non supporta la negoziazione. Il gruppo di lavoro ha inoltre chiarito la gestione degli errori in caso di downgrade forzato, un punto che in passato aveva generato interpretazioni divergenti. La revisione entra in vigore dopo un periodo di commento pubblico di novanta giorni.`;

const HEALTH = `Uno studio osservazionale condotto su una coorte ampia ha esaminato la relazione tra ore di sonno regolari e marcatori metabolici. I partecipanti che mantenevano orari di riposo costanti mostravano valori più stabili indipendentemente dalla durata totale del sonno, suggerendo che la regolarità possa contare quanto la quantità. Gli autori sottolineano i limiti del disegno osservazionale: non è possibile stabilire un rapporto causale, e fattori come attività fisica e alimentazione potrebbero spiegare parte dell'associazione. I dati sono stati raccolti tramite dispositivi indossabili, che offrono misurazioni continue ma con margini di errore noti rispetto alla polisonnografia clinica. La comunità scientifica invita a interpretare i risultati come ipotesi da verificare con trial controllati. Nel frattempo, le indicazioni di sanità pubblica restano invariate: orari coerenti, esposizione alla luce naturale al mattino e riduzione degli schermi prima di coricarsi.`;

const FINANCE = `La banca centrale ha lasciato invariati i tassi di riferimento, ma il comunicato ha modificato il linguaggio sulle prospettive, rimuovendo il riferimento a ulteriori strette. Gli operatori hanno letto la modifica come un segnale di pausa prolungata, e i rendimenti dei titoli a breve sono scesi. L'istituto ha ribadito che le decisioni future dipenderanno dai dati, in particolare dall'andamento dei prezzi dei servizi, considerati più persistenti rispetto ai beni. Alcuni membri del consiglio avrebbero preferito un tono più cauto, temendo che i mercati anticipino tagli non ancora giustificati dai fondamentali. Il cambio ha reagito con un moderato indebolimento, mentre gli indici azionari hanno chiuso in rialzo contenuto. Gli analisti restano divisi sulla tempistica del primo allentamento, con stime che oscillano di diversi mesi a seconda dello scenario sull'occupazione.`;

function words(s) { return s.trim().split(/\s+/).length; }
function scale(base, targetWords) {
    // Concatena paragrafi coerenti finché raggiunge la lunghezza target.
    let out = base;
    let i = 0;
    const parts = [TECH, HEALTH, FINANCE];
    while (words(out) < targetWords) { out += '\n\n' + parts[i % parts.length]; i++; }
    return out;
}

export const CORPUS = [
    { id: 'tech-short', domain: 'tech', sizeClass: 'short', text: TECH },
    { id: 'health-short', domain: 'health', sizeClass: 'short', text: HEALTH },
    { id: 'finance-medium', domain: 'finance', sizeClass: 'medium', text: scale(FINANCE, 450) },
    { id: 'tech-medium', domain: 'tech', sizeClass: 'medium', text: scale(TECH, 450) },
    { id: 'mixed-long', domain: 'mixed', sizeClass: 'long', text: scale(HEALTH, 1200) },
].map(x => ({ ...x, words: words(x.text) }));
