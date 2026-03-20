function createProvider(name) {
  switch (name) {
    case 'gemini':
      return require('./gemini').createGeminiProvider();
    case 'elevenlabs':
      return require('./elevenlabs').createElevenLabsProvider();
    case 'deepgram':
      return require('./deepgram').createDeepgramProvider();
    default:
      throw new Error(`Provider "${name}" is not implemented yet. Supported providers: gemini, elevenlabs, deepgram.`);
  }
}

module.exports = { createProvider };
