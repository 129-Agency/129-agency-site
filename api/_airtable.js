// Acces Airtable (base « Clients » de 129) pour l'onboarding et le generator.
//
// Env vars Vercel :
//   AIRTABLE_TOKEN     - Personal Access Token Airtable, scopes data.records:read +
//                        data.records:write, limite a la seule base Clients.
//   AIRTABLE_BASE_ID   - optionnel, defaut appZkmKmtuYYq2lgG (base Clients).
//
// On ecrit par ID de champ, jamais par nom : les noms changent, les IDs non.

export const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appZkmKmtuYYq2lgG';

export const T = {
  comptes: 'tblndA3q8annHNdb6',
  campagnes: 'tbl3dqIAgInVFTiwM',
  tracks: 'tbl8Zzd82BNwfbKoC',
  adAccounts: 'tblzEKqroa0U39fU3',
  contacts: 'tblspUGl1hm776Lte',
};

export const F = {
  compte: {
    name: 'fldk00XHfsGv3JREH',
    token: 'fldV2NTEWDVh5qRh5',          // Token dashboard (UUID)
    slug: 'fld53WPtsjr3QVXXD',           // Slug dashboard
    defaultAdAccount: 'fldUy5DMci5cDd8CG',
    onboardingStatus: 'fldy82WNBKB10eHxy',
    feeDefault: 'fldYrE5IGhbQVnf8T',
    currency: 'fld6uAJVSVz7UOAWY',
  },
  track: {
    title: 'fldI8DeuYSNfnk1UR',
    artist: 'fldjArSvVWX742MUn',
    featuring: 'fldhmuENSh4gOhPpS',
    compte: 'fldx3FGyae7md76TH',
    releaseType: 'fldiFU2jqJ0daaKwF',
    releaseDate: 'fldq6zMjWWcibZE3m',
    isrc: 'fldB5d3005olGegC2',
    upc: 'fldon73v2hBjbt3Ja',
    spotifyUrl: 'fldlctmSaGpfLRtY2',
    spotifyId: 'fldiik46KEGVCChwD',
    appleUrl: 'fldJ9kUwCwju1dMq5',
    deezerUrl: 'fld5bxokY3IIHSzQr',
    amazonUrl: 'fldRYAaH0ZkAzPGDN',
    youtubeUrl: 'fld9eyiWZQhCliIq7',
    otherDsp: 'fldJveKBBXvz59v7s',
    dspStatus: 'fld0zuPAczNcM8Tpc',
    genre: 'fldMzNzIYLOLUxfje',
    language: 'fldXEE2oaM3Sp0UIo',
    distributor: 'fldrZ4wdCazY7SE5V',
    discoveryMode: 'fld0Hgifp6XAyR8il',
    artwork: 'fldH9qqP8ytqlxTj6',
    key: 'fldDAgcCNuFRMkWCX',
  },
  campagne: {
    name: 'fldhIpiplWBe2gVOK',
    compte: 'fldg2lhWS7VRHckcI',
    status: 'fldHvYHVkIHI3l3L1',
    context: 'fldkhxNKRqlBobxHU',
    type: 'fldbF9PCWXtsePav8',
    artist: 'fldMdLrd9TGQiEMW0',
    trackName: 'fldsTdQnF5T5EHxpU',
    spotifyUrl: 'fldsGgSzVNutMjG2n',
    fanlinkUrl: 'fldnjyabwWBUKsaC9',
    startDate: 'fld3V07woA4j90rj4',
    endDate: 'fldOonML1la8TY8jK',
    currency: 'fldfYiDglwRfzYRka',
    budgetRequested: 'fld2dPEK3yxG8kXJ6',
    objective: 'fldlzn4fYE0CPgJRk',
    notes: 'fldOsFHoNiHztGUBA',
    metaAccount: 'fldL23Ykfasogngrq',
    campaignIdExplore: 'fld9hNFefcn74TEJD',
    campaignIdScale: 'fldVHZvmPx3HBKjyl',
    releaseDate: 'fldYbY2r0NH5j6PFK',
    pageIgFb: 'fld443uc64lrRDJ5v',
    artwork: 'fldosHCAYgQebaANV',
    track: 'fld8dKD2VmJfW5hgc',
    adAccount: 'fldIqmo589EsBWD25',
    territories: 'fldeVyxgeuLlqeOw2',
    parallelActions: 'fldQomonNN2gheLDl',
    driveFolder: 'flduEmLrCq22h1ScK',
    moodTags: 'fldONT7D8nbTd2S9K',
    trackingMeta: 'fldsyxj62dGvzghXW',
    slug: 'fld388hkR2wv31lLL',
    fanlinkStatus: 'fldqGlrFpPBqMf2hF',
    metaStatus: 'fldRWB8c1dWwBD6iA',
    submittedBy: 'fldLCLKf8IFdN8wVf',
    declaredIdentity: 'fldzcMlYdQ7w2D91G',
    clientFilesLink: 'fldaHlg7koK3TWTg9',
  },
  contact: {
    name: 'fldBqZjkgn9SnqBDQ',
    email: 'fldCZTt0B8MwSw1lT',
    compte: 'fldzgWevxoo7qQHfk',
  },
  adAccount: {
    name: 'fldYT1TATC3euYTGM',
    metaId: 'fldCXX77Sdm5neXkr',
    currency: 'flddhOVhLpoHibONA',
    timezone: 'fldik6T1mIswGg2wX',
    pixelId: 'fldYTjnI3lbaMcZm5',
    slugPrefix: 'fldDh9866pWBhKgY7',
    conversionEvent: 'fldR6hZ77tH5l5N3L',
    status: 'fldyP92q0c8GG4S5G',
    notes: 'fldwpVGZ7AW6R79BT',
  },
};

// filterByFormula se lit par NOM de champ : on centralise les noms utilises dans
// les formules ici, pour n'avoir qu'un endroit a corriger si un champ est renomme.
export const FN = {
  compteToken: '{Token dashboard}',
  trackIsrc: '{ISRC}',
  campTrack: '{Track}',
  campFanlinkStatus: '{Statut fanlink}',
  campMetaStatus: '{Statut Meta}',
  compteStatut: '{Statut compte}',
  contactEmail: '{Email}',
};

function token() {
  const t = process.env.AIRTABLE_TOKEN;
  if (!t) throw new Error('AIRTABLE_TOKEN absent des variables Vercel.');
  return t;
}

async function call(method, path, body) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = d?.error?.message || d?.error?.type || d?.error || r.statusText;
    throw new Error(`[Airtable ${r.status}] ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return d;
}

// Echappe une valeur pour une formule Airtable entre guillemets doubles.
export function q(v) {
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

export async function find(table, formula, { maxRecords = 100, fields } = {}) {
  const params = new URLSearchParams({ filterByFormula: formula, maxRecords: String(maxRecords), returnFieldsByFieldId: 'true' });
  if (fields) fields.forEach(f => params.append('fields[]', f));
  const d = await call('GET', `${table}?${params}`);
  return d.records || [];
}

export async function get(table, id) {
  return call('GET', `${table}/${id}?returnFieldsByFieldId=true`);
}

export async function create(table, fields) {
  const d = await call('POST', table, { records: [{ fields }], returnFieldsByFieldId: true });
  return d.records[0];
}

export async function update(table, id, fields) {
  const d = await call('PATCH', table, { records: [{ id, fields }], returnFieldsByFieldId: true });
  return d.records[0];
}

// Upload direct d'une piece jointe (<= 5 Mo, limite de l'API Airtable).
export async function uploadAttachment(recordId, fieldId, { contentType, filename, base64 }) {
  const r = await fetch(`https://content.airtable.com/v0/${BASE_ID}/${recordId}/${fieldId}/uploadAttachment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType, filename, file: base64 }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(`[Airtable upload ${r.status}] ${d?.error?.message || r.statusText}`);
  }
  return r.json();
}

export function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
