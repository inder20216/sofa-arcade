/* A game registers itself with:
 *   { id, name, blurb, art(ctx, w, h), layout: {title, buttons: [A, B, X, Y], stick, mode, tilt}, create(api) }
 * mode: 'stick' springs to centre, 'pad' is absolute position, 'drag' is a pull from the touch point.
 * A 3D game also sets is3d: true and returns render(renderer, width, height, dt) and destroy().
 * create(api) returns { update(dt), draw(ctx), press(player, button), playersChanged(), plays(player) }.
 *
 * api: W, H, BTN, players(), held(player, btn), touching(player), note(player, text), buzz(player, pattern), sound(name, power, pan), say(text, urgent), engines(list, extra),
 *      finish({title, detail})
 * music names a loop in sound.js, crowd is a murmur level from 0 to 1.
 * The Y button always pauses, so press() only receives A, B and X.
 * Game code never touches the network. The screen is always 1280 x 720 units.
 */
window.Games = {
  list: [],
  register: function (game) { this.list.push(game); }
};
