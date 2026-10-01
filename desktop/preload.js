// Signale à l'interface qu'elle tourne dans l'app Mac (barre de titre intégrée, zones déplaçables).
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.shell = 'desktop';
});
