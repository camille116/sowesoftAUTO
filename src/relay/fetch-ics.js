/** Télécharge le texte iCal (utilisé par le relais ; séparé pour être remplaçable dans les tests). */
export async function fetchIcsText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'linked-relay/1.0' } });
  if (!res.ok) throw new Error(`ICS HTTP ${res.status}`);
  return res.text();
}
