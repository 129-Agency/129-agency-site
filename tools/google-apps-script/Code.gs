/**
 * 129 Onboarding Drive
 *
 * Donne au site 129agency.com de quoi déposer les fichiers clients dans Google Drive,
 * sans projet Google Cloud ni compte de service :
 *   - un jeton Drive (scope drive : nécessaire pour écrire dans un dossier existant, ROOT_ID),
 *   - l'ID du dossier racine « 129 — Onboarding », créé dans le Drive du propriétaire du script.
 *
 * Mise en place : lancer setup() une fois, puis Déployer > Application web
 * (Exécuter en tant que : moi ; Qui a accès : tout le monde).
 */

const ROOT_NAME = '129 — Onboarding';
// Dossier de destination choisi par Antoine (26/10/2026). Vide = dossier créé par setup().
const ROOT_ID = '1Gtp-TLl_xJV7SlbV99v8xGGXxVaOUUe-';

function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) {
    props.setProperty('SECRET', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  }
  const root = rootFolder_();
  Logger.log('GOOGLE_APPS_SCRIPT_SECRET = ' + props.getProperty('SECRET'));
  Logger.log('Dossier racine : https://drive.google.com/drive/folders/' + root);
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || body.secret !== secret) return json_({ error: 'forbidden' });
  return json_({ token: ScriptApp.getOAuthToken(), rootId: rootFolder_(), expiresIn: 1200 });
}

function doGet() {
  return json_({ ok: true, service: '129 Onboarding Drive' });
}

function rootFolder_() {
  if (ROOT_ID) return ROOT_ID;
  const props = PropertiesService.getScriptProperties();
  const known = props.getProperty('ROOT_ID');
  if (known) return known;
  const res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ name: ROOT_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const id = JSON.parse(res.getContentText()).id;
  props.setProperty('ROOT_ID', id);
  return id;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
