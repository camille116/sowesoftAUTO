function stamp() {
  return new Date().toLocaleString('fr-FR');
}

export const log = {
  info: (...a) => console.log(`[${stamp()}] ℹ️ `, ...a),
  warn: (...a) => console.warn(`[${stamp()}] ⚠️ `, ...a),
  error: (...a) => console.error(`[${stamp()}] ❌`, ...a),
};
