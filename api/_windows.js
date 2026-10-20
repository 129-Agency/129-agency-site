// Fenetres de dates : Meta renvoie date_preset OU time_range, mais pour comparer
// une periode a la precedente il faut des bornes explicites.

const DAYS = { last_7d: 7, last_14d: 14, last_30d: 30, last_90d: 90 };

const iso = (d) => d.toISOString().split('T')[0];

export function windows(preset = 'last_30d') {
  const n = DAYS[preset];
  const until = new Date(); until.setDate(until.getDate() - 1); // hier : dernier jour complet
  if (!n) return { current: null, previous: null, label: 'maximum' }; // date_preset=maximum

  const since = new Date(until); since.setDate(since.getDate() - (n - 1));
  const prevUntil = new Date(since); prevUntil.setDate(prevUntil.getDate() - 1);
  const prevSince = new Date(prevUntil); prevSince.setDate(prevSince.getDate() - (n - 1));

  return {
    current: { since: iso(since), until: iso(until) },
    previous: { since: iso(prevSince), until: iso(prevUntil) },
    label: preset,
  };
}

export const PRESETS = ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'maximum'];
