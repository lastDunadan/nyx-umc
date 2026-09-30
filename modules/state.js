// Pamięć tylko na czas działania procesu. Po restarcie mapy są puste.
module.exports = {
  conversations: new Map(),
  relationships: new Map(),
  lastSpontaneousReply: new Map(),
  humorChecksInFlight: new Set(),
  scoldChecksInFlight: new Set(),
  lastScoldCheck: new Map(),
  lastOffendedReply: new Map(),
};
