// Construction de l'entree `releases` (src/config/releases.ts du projet Lovable
// « Fanlinkhub ») et des prompts Lovable. Format calque sur les entrees existantes
// (lu dans le projet le 20/10/2026) : slug a prefixe, UTM fanlinkhub, regles geo V4.

const LOGOS = {
  spotify: 'https://cdn.jsdelivr.net/npm/simple-icons@14/icons/spotify.svg',
  apple_music: 'https://cdn.jsdelivr.net/npm/simple-icons@14/icons/applemusic.svg',
  deezer: '/icons/deezer.webp',
  amazon_music: 'https://cdn.jsdelivr.net/npm/simple-icons@14/icons/amazonmusic.svg',
  youtube: 'https://cdn.jsdelivr.net/npm/simple-icons@14/icons/youtube.svg',
  beatport: 'https://cdn.jsdelivr.net/npm/simple-icons@14/icons/beatport.svg',
};

// Regles geo V4 : Spotify + Apple partout ; Deezer France ; Amazon hors Europe ;
// YouTube reste du monde, jamais tracke ; Beatport = store, jamais tracke.
export const DSP_DEFS = [
  { key: 'spotify', name: 'Spotify' },
  { key: 'apple_music', name: 'Apple Music' },
  { key: 'deezer', name: 'Deezer', geo: 'countries: ["FR"]' },
  { key: 'amazon_music', name: 'Amazon Music', geo: 'excludeCountries: [...EUROPE_COUNTRIES]' },
  { key: 'youtube', name: 'YouTube', geo: 'countries: [...REST_OF_WORLD_COUNTRIES]', neverTracked: true },
  { key: 'beatport', name: 'Beatport', neverTracked: true },
];

export const MOODS = ['chill', 'drive', 'focus', 'late_night', 'party', 'running', 'sport', 'sunset', 'training'];

export function normalizeDspUrl(key, raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (key === 'spotify') {
    const m = s.match(/^spotify:(track|album):([A-Za-z0-9]{22})$/);
    if (m) s = `https://open.spotify.com/${m[1]}/${m[2]}`;
  }
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  u.protocol = 'https:';
  if (key === 'apple_music') {
    // Lien geo : sans segment pays, pour que chaque visiteur tombe sur son store.
    if (u.hostname === 'music.apple.com' || u.hostname === 'geo.music.apple.com') {
      u.hostname = 'geo.music.apple.com';
      u.pathname = u.pathname.replace(/^\/[a-z]{2}(?=\/)/, '');
    }
    const i = u.searchParams.get('i');
    u.search = i ? `?i=${i}` : '';
  } else if (key === 'youtube') {
    const v = u.searchParams.get('v');
    u.search = v ? `?v=${v}` : '';
  } else {
    u.search = '';
  }
  u.hash = '';
  return u.toString();
}

export function withUtm(url, slug, key) {
  const u = new URL(url);
  u.searchParams.set('utm_source', 'fanlinkhub');
  u.searchParams.set('utm_medium', 'referral');
  u.searchParams.set('utm_campaign', slug);
  u.searchParams.set('utm_content', key);
  // URLSearchParams encode le « / » du slug : les entrees existantes le gardent en clair.
  return u.toString().replace(/utm_campaign=([^&]*)/, (_, v) => 'utm_campaign=' + decodeURIComponent(v));
}

const js = (s) => JSON.stringify(String(s));

// Rend l'objet ReleaseConfig en TypeScript, au format exact des entrees existantes
// (les tableaux geo restent des spreads de constantes, pas des listes recopiees).
export function renderRelease(r) {
  const dsps = r.dsps.map(d => {
    const lines = [
      `        name: ${js(d.name)},`,
      `        logo: ${js(d.logo)},`,
      `        url: ${js(d.url)},`,
    ];
    if (d.geo) lines.push(`        ${d.geo},`);
    if (d.tracked === false) lines.push('        tracked: false,');
    return `      {\n${lines.join('\n')}\n      }`;
  }).join(',\n');
  const opt = [];
  if (r.genrePrimary) opt.push(`    genrePrimary: ${js(r.genrePrimary)},`);
  if (r.label) opt.push(`    label: ${js(r.label)},`);
  if (r.releaseDate) opt.push(`    releaseDate: ${js(r.releaseDate)},`);
  if (r.moodTags?.length) opt.push(`    moodTags: [${r.moodTags.map(js).join(', ')}],`);
  if (r.trackLanguage) opt.push(`    trackLanguage: ${js(r.trackLanguage)},`);
  return [
    '  {',
    `    slug: ${js(r.slug)},`,
    `    artist: ${js(r.artist)},`,
    `    title: ${js(r.title)},`,
    `    releaseType: ${js(r.releaseType)},`,
    `    artworkUrl: ${js(r.artworkUrl)},`,
    `    ogTitle: ${js(r.ogTitle)},`,
    `    ogDescription:\n      ${js(r.ogDescription)},`,
    '    dsps: [',
    dsps + ',',
    '    ],',
    ...opt,
    '  },',
  ].join('\n');
}

// input : { slug, artist, featuring, title, releaseType, releaseDate, genre, language,
//           moodTags[], label, artworkExt, trackingMeta, dsps: [{key, url, enabled}] }
export function buildRelease(input) {
  const errors = [];
  const slug = String(input.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(slug)) errors.push('Slug invalide : format attendu prefixe/artiste-titre.');
  const artist = [input.artist, input.featuring].map(s => String(s || '').trim()).filter(Boolean).join(', ');
  const title = String(input.title || '').trim();
  if (!artist || !title) errors.push('Artiste et titre requis.');
  const ext = ['webp', 'jpg', 'png'].includes(input.artworkExt) ? input.artworkExt : 'webp';
  const fileBase = slug.split('/').pop();

  const dsps = [];
  for (const def of DSP_DEFS) {
    const row = (input.dsps || []).find(d => d.key === def.key);
    if (!row || row.enabled === false) continue;
    const clean = normalizeDspUrl(def.key, row.url);
    if (!clean) { if (row.url) errors.push(`Lien ${def.name} invalide.`); continue; }
    const tracked = !(def.neverTracked || input.trackingMeta === false);
    dsps.push({ name: def.name, logo: LOGOS[def.key], url: withUtm(clean, slug, def.key), geo: def.geo, tracked: tracked ? undefined : false });
  }
  if (!dsps.some(d => d.name === 'Spotify')) errors.push('Spotify est obligatoire sur un fanlink.');

  const release = {
    slug, artist, title,
    releaseType: input.releaseType,
    artworkUrl: `/artworks/${fileBase}.${ext}`,
    ogTitle: `${artist} - ${title}`,
    ogDescription: `Listen to ${title} by ${artist}, out now on all platforms.`,
    dsps,
    genrePrimary: input.genre || undefined,
    label: input.label || undefined,
    releaseDate: input.releaseDate || undefined,
    moodTags: (input.moodTags || []).filter(m => MOODS.includes(m)),
    trackLanguage: input.language || undefined,
  };
  return { release, errors, artworkFile: `${fileBase}.${ext}` };
}

export function releasePrompt({ release, artworkFile, prefix, pixelId, adAccountName }) {
  return `Add ONE release to the fanlinks. Change nothing else in the project.

1. In src/config/releases.ts, insert the object below as the FIRST element of the \`releases\` array. Keep every existing entry exactly as it is.

\`\`\`ts
${renderRelease(release)}
\`\`\`

2. Save the attached artwork image as public/artworks/${artworkFile} (convert it to that format if needed, keep it square). If no image is attached to this message, stop and ask me for it.

3. Before publishing, check that PIXEL_LABELS in src/lib/labels.ts contains an entry with slug_prefix "${prefix}" and pixel_id "${pixelId}" (${adAccountName}). If it does not, STOP and tell me: without it, this page would send its events to the ERA Music pixel.

4. Do not modify labels.ts, tracking.ts, the Supabase functions, the database, or any other release.

Expected URL once published: https://fanlinkhub.com/${release.slug}`;
}

// Prompt a passer UNE FOIS par ad account avant son premier fanlink.
export function setupPrompt({ name, prefix, pixelId }) {
  const secret = `META_CAPIG_TOKEN_${prefix.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  return `Register a new label for the fanlinks: "${name}", URL slug prefix "${prefix}", Meta pixel ${pixelId}.

1. src/lib/labels.ts — add { name: "${name}", slug_prefix: "${prefix}", pixel_id: "${pixelId}" } to PIXEL_LABELS. Do not change DEFAULT_PIXEL_ID or the existing entries.

2. Database — insert one row into public.labels: name "${name}", slug_prefix "${prefix}", pixel_id "${pixelId}", capi_secret_name "${secret}". Leave existing rows untouched. If the table has other required columns, ask me before inventing values.

3. supabase/functions/track-meta/index.ts — today, when a label row matches the URL prefix but its CAPI token secret is missing, the function falls back to the default ERA Music pixel and token. Change only that behaviour: if a label row matches the prefix and Deno.env.get(label.capi_secret_name) is empty, send NOTHING to Meta, log a warning, and return HTTP 200 with {"success": false, "skipped": "missing_label_token", "label": <name>}. The ERA default must only apply to URLs whose prefix matches no label row. Keep validation, geo enrichment, logging and the selftest route identical.

4. Redeploy track-meta, then call it with ?selftest=1&label=${encodeURIComponent(name)} and show me the JSON response.

Do not touch src/config/releases.ts. The CAPI secret ${secret} will be added later; until then this label runs on the browser pixel only.`;
}
