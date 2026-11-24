/* Helpers for 3D games. THREE is loaded on demand, so use it only inside functions. */
(function () {
  function dummy() { return new THREE.Object3D(); }

  // parts: {shape: 'box'|'cyl'|'cone', size: [..], at: [x,y,z], rot: [x,y,z], color}
  // Returns one geometry with vertex colours, so a whole vehicle is a single draw call.
  function merge(parts) {
    var pos = [], nor = [], col = [], o = dummy(), v = new THREE.Vector3(), c = new THREE.Color();
    parts.forEach(function (p) {
      var s = p.size, g;
      if (p.shape === 'cyl') g = new THREE.CylinderGeometry(s[0], s[1], s[2], s[3] || 12);
      else if (p.shape === 'cone') g = new THREE.ConeGeometry(s[0], s[1], s[2] || 7);
      else g = new THREE.BoxGeometry(s[0], s[1], s[2]);
      g = g.toNonIndexed();
      o.position.fromArray(p.at || [0, 0, 0]);
      o.rotation.set.apply(o.rotation, p.rot || [0, 0, 0]);
      o.updateMatrix();
      var a = g.attributes.position, n = g.attributes.normal;
      c.set(p.color);
      for (var i = 0; i < a.count; i++) {
        v.fromBufferAttribute(a, i).applyMatrix4(o.matrix); pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(n, i).transformDirection(o.matrix); nor.push(v.x, v.y, v.z);
        col.push(c.r, c.g, c.b);
      }
      g.dispose();
    });
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return out;
  }
  function dispose(scene) {
    scene.traverse(function (n) {
      if (n.geometry) n.geometry.dispose();
      if (n.material) { if (n.material.map) n.material.map.dispose(); n.material.dispose(); }
      if (n.isInstancedMesh && n.dispose) n.dispose();
    });
  }
  function random(seed) {           // repeatable, so every race has the same scenery
    return function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }
  window.Kit3D = { merge: merge, dispose: dispose, random: random, dummy: dummy };
})();
