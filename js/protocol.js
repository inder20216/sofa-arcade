/* Shared by the TV and the phone. Knows nothing about any game.
 *
 * Two channels run between a phone and the TV:
 *   1. Reliable (PeerJS, JSON objects): joining, names, layouts, vibration, leaving.
 *   2. Fast (unordered, no resends, short strings): stick and button state, pings.
 *
 * Fast messages
 *   "i,seq,x,y,mask,cA,cB,cX,cY"  phone -> TV  full controller state
 *                                 mask bits 0-3 are A B X Y, bit 4 is "thumb is down"
 *   "p,n"                         TV -> phone  ping
 *   "q,n"                         phone -> TV  ping reply
 *
 * Every input packet carries the whole state plus a running press count per
 * button, so a lost packet never loses a tap: the next packet includes it.
 */
(function () {
  var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
  var CODE_LENGTH = 6;

  function makeCode() {
    var out = '';
    var limit = 256 - (256 % ALPHABET.length);
    var buf = new Uint8Array(1);
    while (out.length < CODE_LENGTH) {
      crypto.getRandomValues(buf);
      if (buf[0] < limit) out += ALPHABET[buf[0] % ALPHABET.length];
    }
    return out;
  }

  function cleanCode(text) {
    var up = String(text || '').toUpperCase();
    var out = '';
    for (var i = 0; i < up.length && out.length < CODE_LENGTH; i++) {
      if (ALPHABET.indexOf(up[i]) >= 0) out += up[i];
    }
    return out;
  }

  function cleanName(text) {
    return String(text || '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/\s+/g, ' ').trim().slice(0, 12);
  }

  function encodeInput(s) {
    return 'i,' + s.seq + ',' + s.x.toFixed(3) + ',' + s.y.toFixed(3) + ',' + s.mask + ',' + s.counts.join(',');
  }

  // Returns null for anything malformed. The TV treats all phone data as untrusted.
  function decodeInput(str) {
    if (typeof str !== 'string' || str.length > 64) return null;
    var p = str.split(',');
    if (p.length !== 9 || p[0] !== 'i') return null;
    var n = p.slice(1).map(Number);
    for (var i = 0; i < n.length; i++) if (!isFinite(n[i])) return null;
    var x = Math.max(-1, Math.min(1, n[1]));
    var y = Math.max(-1, Math.min(1, n[2]));
    return {
      seq: n[0] >>> 0, x: x, y: y, mask: n[3] & 31,
      counts: [n[4] & 255, n[5] & 255, n[6] & 255, n[7] & 255]
    };
  }

  window.SA = {
    VERSION: 2,
    PEER_PREFIX: 'sofa-arcade-v1-',
    CODE_LENGTH: CODE_LENGTH,
    BTN: { A: 0, B: 1, X: 2, Y: 3 },
    TOUCH: 16,
    BTN_NAMES: ['A', 'B', 'X', 'Y'],
    FAST: { negotiated: true, id: 50, ordered: false, maxRetransmits: 0 },
    COLORS: ['#d63c48', '#2470d0', '#f0a61c', '#24834f'],
    INKS: ['#ffffff', '#ffffff', '#2a1c00', '#ffffff'],
    makeCode: makeCode, cleanCode: cleanCode, cleanName: cleanName,
    encodeInput: encodeInput, decodeInput: decodeInput
  };
})();
