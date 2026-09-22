const STORAGE_KEY = 'parle-traduis:last';
const listenButton = document.getElementById('listenButton');
const buttonLabel = document.getElementById('buttonLabel');
const hintText = document.getElementById('hintText');
const statusBox = document.getElementById('status');
const results = document.getElementById('results');
const emptyState = document.getElementById('emptyState');
const transcript = document.getElementById('transcript');
const translation = document.getElementById('translation');
const againButton = document.getElementById('againButton');
const targetLanguage = document.getElementById('targetLanguage');
const targetCode = document.getElementById('targetCode');
const cardTargetCode = document.getElementById('cardTargetCode');
let listening = false;

const languages = {
  en: { name: 'anglais', code: 'EN' },
  wo: { name: 'wolof', code: 'WO' },
  es: { name: 'espagnol', code: 'ES' },
  ro: { name: 'roumain', code: 'RO' },
  pl: { name: 'polonais', code: 'PL' }
};
function selectedLanguage() { return languages[targetLanguage.value] || languages.en; }
function updateLanguageLabels() {
  const language = selectedLanguage();
  targetCode.textContent = language.code;
  cardTargetCode.textContent = language.code;
}
function readSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (error) { return null; }
}
function saveResult(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (error) { /* storage unavailable */ }
}
function setStatus(message, error = false) {
  statusBox.hidden = !message;
  statusBox.textContent = message || '';
  statusBox.classList.toggle('error', error);
}
function showTranslation(text) {
  translation.textContent = text;
}
function showResult(data) {
  if (data.language && languages[data.language]) targetLanguage.value = data.language;
  updateLanguageLabels();
  transcript.textContent = data.transcript;
  showTranslation(data.translation);
  results.hidden = false;
  emptyState.hidden = true;
}
function resetForNewPhrase() {
  results.hidden = true;
  emptyState.hidden = false;
  setStatus('');
  transcript.textContent = '';
  translation.textContent = '';
  listenButton.focus();
}
function readableError(reason, action) {
  const value = String(reason || 'operation_failed');
  if (value === 'not_granted') return `L’accès à ${action} n’est pas autorisé sur cet appareil.`;
  if (value === 'budget_exhausted') return 'La limite quotidienne de traduction est atteinte. Réessayez demain.';
  if (value === 'malformed_parameters') return 'La demande n’a pas pu être envoyée. Réessayez.';
  if (value === 'operation_failed') return `Impossible de ${action} pour le moment. Vérifiez puis réessayez.`;
  return `Impossible de ${action} (${value}).`;
}
function answerText(answer) {
  if (!answer) return '';
  if (Array.isArray(answer.content)) return answer.content.map(part => part && part.text ? part.text : '').filter(Boolean).join('\n');
  return answer.text || '';
}
async function listenOnce() {
  if (listening) return;
  listening = true;
  listenButton.classList.add('is-listening');
  listenButton.setAttribute('aria-busy', 'true');
  buttonLabel.textContent = 'Écoute en cours…';
  hintText.textContent = 'Parlez naturellement, puis laissez l’écoute se terminer.';
  setStatus('Je vous écoute…');
  try {
    const said = await creativeBoard.speech.listen({ locale: 'fr-FR' });
    if (!said || !said.text || !said.text.trim()) {
      setStatus('Aucune phrase détectée. Appuyez à nouveau pour recommencer.', true);
      return;
    }
    const words = said.text.trim();
    const language = selectedLanguage();
    setStatus('Écoute terminée. Traduction en cours…');
    transcript.textContent = words;
    results.hidden = false;
    emptyState.hidden = true;
    const response = await creativeBoard.llm.ask({
      prompt: `Traduis en ${language.name} naturel le texte français ci-dessous. Réponds uniquement avec la traduction, sans guillemets ni explication.\n\n${words}`,
      system: `Tu es un traducteur français-${language.name} précis. Préserve le sens, le ton et les noms propres.`
    });
    const answer = response && response.answer ? response.answer : response;
    if (answer && answer.isError) {
      const reason = answerText(answer) || 'operation_failed';
      setStatus(`La transcription est prête, mais la traduction a échoué : ${reason}`, true);
      translation.textContent = 'Traduction indisponible.';
      saveResult({ transcript: words, translation: 'Traduction indisponible.', language: targetLanguage.value });
      return;
    }
    const translated = answerText(answer).trim();
    if (!translated) throw new Error('operation_failed');
    showResult({ transcript: words, translation: translated, language: targetLanguage.value });
    saveResult({ transcript: words, translation: translated, language: targetLanguage.value });
    setStatus('Écoute terminée · traduction prête.');
  } catch (error) {
    const reason = error && error.message ? error.message : error;
    setStatus(readableError(reason, reason === 'budget_exhausted' ? 'traduire' : 'lancer la traduction'), true);
    if (transcript.textContent && !translation.textContent) translation.textContent = 'Traduction indisponible.';
  } finally {
    listening = false;
    listenButton.classList.remove('is-listening');
    listenButton.removeAttribute('aria-busy');
    buttonLabel.textContent = 'Appuyer pour parler';
    hintText.textContent = 'L’écoute s’arrête automatiquement après un silence.';
  }
}
listenButton.addEventListener('click', listenOnce);
againButton.addEventListener('click', resetForNewPhrase);
targetLanguage.addEventListener('change', updateLanguageLabels);

const saved = readSaved();
if (saved && saved.transcript && saved.translation) {
  showResult(saved);
  setStatus('Votre dernière phrase est prête à relire.');
} else {
  updateLanguageLabels();
}
