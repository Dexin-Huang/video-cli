const { createGeminiProvider } = require('./gemini');
const { createDeepgramProvider } = require('./deepgram');
const { createElevenLabsProvider } = require('./elevenlabs');

function createProvider(name) {
  switch (name) {
    case 'gemini':
      return createGeminiProvider();
    case 'deepgram':
      return createDeepgramProvider();
    case 'elevenlabs':
      return createElevenLabsProvider();
    default:
      throw new Error(`Provider "${name}" is not implemented yet. Supported providers: gemini, deepgram, elevenlabs.`);
  }
}

module.exports = { createProvider };
