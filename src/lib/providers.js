const { createGeminiProvider } = require('./gemini');
const { createDeepgramProvider } = require('./deepgram');

function createProvider(name) {
  switch (name) {
    case 'gemini':
      return createGeminiProvider();
    case 'deepgram':
      return createDeepgramProvider();
    default:
      throw new Error(`Provider "${name}" is not implemented yet. Supported providers: gemini, deepgram.`);
  }
}

module.exports = {
  createProvider,
};
