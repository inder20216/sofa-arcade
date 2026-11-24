/* A game registers itself with:
 *   { id, name, blurb, art(ctx, w, h), layout: {title, buttons: [A, B, X, Y], stick}, create(api) }
 * create(api) returns { update(dt), draw(ctx), press(player, button), playersChanged(), plays(player) }.
 *
 * api: W, H, BTN, players(), held(player, btn), buzz(player, pattern), sound(name, power),
 *      finish({title, detail})
 * The Y button always pauses, so press() only receives A, B and X.
 * Game code never touches the network. The screen is always 1280 x 720 units.
 */
window.Games = {
  list: [],
  register: function (game) { this.list.push(game); }
};
