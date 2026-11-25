/* Settings you may want to change. */
window.SA_CONFIG = {
  // Pairing server. Empty = the free public PeerJS server (no uptime guarantee).
  // It only introduces the phone to the TV; controls then go phone-to-TV directly
  // where the network allows it. To run your own:
  //   peer: { host: 'pair.example.com', port: 443, path: '/', secure: true }
  peer: {},
  // Road Trip uses free public map services. For real live traffic, put a TomTom key here
  // (restrict the key to your website's address, because this file is public).
  tomtomKey: '',
  holdSeatSeconds: 30,                     // keep a dropped player's seat this long
  latencyTarget: { median: 20, p95: 50 }   // milliseconds, TV to phone and back
};
