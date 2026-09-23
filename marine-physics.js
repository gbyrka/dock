/* Small, deterministic harbour dynamics shared by the game and its tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DockPhysics = factory();
})(globalThis, () => {
  'use strict';
  const STEP = 1 / 120;
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const smooth = (value, target, rate, dt) => value + (target - value) * (1 - Math.exp(-rate * dt));
  const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
  const MAIN = { mass: 5, inertia: 11000, ahead: 34, astern: 24, surge: .075, surgeQuadratic: .0045, sway: .75, swayQuadratic: .026, maxYaw: .34 };
  const TUG = { mass: 1, inertia: 340, ahead: 95, astern: 72, surge: .7, surgeQuadratic: .0025, sway: 1.8, swayQuadratic: .009, maxYaw: 1.1 };

  function components(body) {
    const fx = Math.sin(body.a), fy = -Math.cos(body.a), sx = Math.cos(body.a), sy = Math.sin(body.a);
    return { fx, fy, sx, sy, forward: body.vx * fx + body.vy * fy, lateral: body.vx * sx + body.vy * sy };
  }

  function advance(body, controls, dt, isTug = false) {
    const p = isTug ? TUG : MAIN;
    const { fx, fy, sx, sy, forward, lateral } = components(body);
    const desiredPower = Number(!!controls.ahead) - Number(!!controls.astern);
    const desiredRudder = Number(!!controls.right) - Number(!!controls.left);
    // The engine has a short spool-up, with a slightly quicker response to a
    // reversal order. Releasing the key returns the engine to neutral, not braking.
    body.throttle = smooth(body.throttle, desiredPower, isTug ? 4.5 : desiredPower * body.throttle < 0 ? 3 : 2, dt);
    body.rudder = smooth(body.rudder, desiredRudder, isTug ? 6 : 3.4, dt);
    if (Math.abs(body.throttle) < .0001 && desiredPower === 0) body.throttle = 0;
    if (Math.abs(body.rudder) < .0001 && desiredRudder === 0) body.rudder = 0;
    const thrust = body.throttle * (body.throttle >= 0 ? p.ahead : p.astern);
    const surgeDrag = forward * (p.surge + Math.abs(forward) * p.surgeQuadratic);
    const swayDrag = lateral * (p.sway + Math.abs(lateral) * p.swayQuadratic + (isTug ? 0 : Math.abs(forward) * .005));
    body.vx += (fx * (thrust - surgeDrag) - sx * swayDrag) * dt;
    body.vy += (fy * (thrust - surgeDrag) - sy * swayDrag) * dt;

    if (isTug) {
      const desiredJet = Number(!!controls.starboard) - Number(!!controls.port);
      body.jet = smooth(body.jet || 0, desiredJet, 7, dt);
      body.vx += sx * body.jet * 85 * dt;
      body.vy += sy * body.jet * 85 * dt;
      // Propeller wash grants some authority under power, but an idle rudder
      // cannot rotate a stationary tug indefinitely.
      const flow = forward / 25 + body.throttle * .36;
      body.omega += body.rudder * clamp(flow, -1.1, 1.1) * 2.6 * dt;
      body.omega *= Math.exp(-2.5 * dt);
    } else {
      // A stern-mounted rudder first pushes the stern outwards. Forward flow
      // and propeller wash provide authority; reverse flow reverses the turn.
      const wash = body.throttle >= 0 ? body.throttle * 850 : body.throttle * 180;
      // A small linear-flow component keeps low-speed harbour manoeuvres
      // responsive without granting any authority to a stopped, idle ship.
      const flow = forward * 24 + forward * Math.abs(forward) * .65 + wash;
      const rudderAcceleration = Math.sin(body.rudder * .58) * flow * .01;
      body.vx -= sx * rudderAcceleration * dt;
      body.vy -= sy * rudderAcceleration * dt;
      body.omega += rudderAcceleration * (body.h * .36) * p.mass / p.inertia * dt;
      body.omega *= Math.exp(-(.78 + Math.abs(forward) * .004 + Math.abs(body.omega) * 1.8) * dt);
    }
    body.omega = clamp(body.omega, -p.maxYaw, p.maxYaw);
    // A safety limit only; normal cruising speed is set by quadratic water drag.
    const speed = Math.hypot(body.vx, body.vy), maxSpeed = isTug ? 125 : 100;
    if (speed > maxSpeed) { body.vx *= maxSpeed / speed; body.vy *= maxSpeed / speed; }
    if (!desiredPower && Math.abs(body.throttle) < .01 && Math.hypot(body.vx, body.vy) < .015) { body.vx = 0; body.vy = 0; }
    if (Math.abs(body.omega) < .00001) body.omega = 0;
    body.x += body.vx * dt; body.y += body.vy * dt;
    body.a = wrap(body.a + body.omega * dt);
  }

  function corners(body) {
    const c = Math.cos(body.a), s = Math.sin(body.a);
    return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y]) => ({ x: body.x + x * body.w / 2 * c - y * body.h / 2 * s, y: body.y + x * body.w / 2 * s + y * body.h / 2 * c }));
  }

  function manifold(a, b) {
    let depth = Infinity, normal = null;
    for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length];
      const length = Math.hypot(q.x - p.x, q.y - p.y), nx = (p.y - q.y) / length, ny = (q.x - p.x) / length;
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const v of a) { const t = v.x * nx + v.y * ny; amin = Math.min(amin,t); amax = Math.max(amax,t); }
      for (const v of b) { const t = v.x * nx + v.y * ny; bmin = Math.min(bmin,t); bmax = Math.max(bmax,t); }
      if (amax <= bmin || bmax <= amin) return null;
      const negative = amax - bmin, positive = bmax - amin;
      const overlap = Math.min(negative, positive);
      if (overlap < depth) { depth = overlap; const sign = negative < positive ? -1 : 1; normal = { x: nx * sign, y: ny * sign }; }
    }
    // Average supporting vertices for a side contact; retain the corner for an
    // angled hit. The impulse then acts at the actual end of the hull involved.
    const distances = a.map(p => p.x * normal.x + p.y * normal.y);
    const min = Math.min(...distances), points = a.filter((_, i) => distances[i] < min + .5);
    const point = { x: points.reduce((n,p) => n+p.x, 0) / points.length, y: points.reduce((n,p) => n+p.y, 0) / points.length };
    return { depth, normal, point };
  }

  function resolveContact(body, old, contact, isTug = false) {
    const p = isTug ? TUG : MAIN, { normal: n, point } = contact;
    const rx = point.x - body.x, ry = point.y - body.y, arm = rx * n.y - ry * n.x;
    const closing = (body.vx - body.omega * ry) * n.x + (body.vy + body.omega * rx) * n.y;
    // Keep the last nonpenetrating pose, then remove inward velocity only.
    // Tangential motion is retained, so a grazing hull can slide along a quay.
    body.x = old.x; body.y = old.y; body.a = old.a;
    if (closing < 0) {
      const impulse = -closing / (1 / p.mass + arm * arm / p.inertia);
      body.vx += n.x * impulse / p.mass; body.vy += n.y * impulse / p.mass;
      body.omega += arm * impulse / p.inertia;
    }
    body.vx *= .985; body.vy *= .985; body.omega *= .88;
    return Math.max(0, -closing);
  }

  function stoppingDistance(body) {
    // Straight-line estimate for a full opposite-engine order. Excludes tug
    // assistance and turning, so the HUD labels this as an estimate.
    const speed = components(body).forward;
    if (Math.abs(speed) < .1) return 0;
    const sign = Math.sign(speed), target = -sign;
    let velocity = speed, power = body.throttle, distance = 0;
    for (let i = 0; i < 1200 && velocity * sign > 0; i++) {
      power = smooth(power, target, power * target < 0 ? 3 : 2, 1 / 60);
      const thrust = power * (power >= 0 ? MAIN.ahead : MAIN.astern);
      velocity += (thrust - velocity * (MAIN.surge + Math.abs(velocity) * MAIN.surgeQuadratic)) / 60;
      distance += Math.max(0, velocity * sign) / 60;
    }
    return distance;
  }

  function docking(body, berth, targetAngle) {
    const inside = corners(body).every(p => p.x > berth.x + 4 && p.x < berth.x + berth.w - 4 && p.y > berth.y + 4 && p.y < berth.y + berth.h - 4);
    const align = Math.min(Math.abs(wrap(body.a - targetAngle)), Math.abs(wrap(body.a - targetAngle - Math.PI)));
    const speed = Math.hypot(body.vx, body.vy), turn = Math.abs(body.omega);
    return {
      inside, align, speed, turn,
      aligned: align < 12 * Math.PI / 180,
      slow: speed < 8,
      settled: turn < .025,
      ready: inside && align < 12 * Math.PI / 180 && speed < 8 && turn < .025,
      centerDistance: Math.hypot(body.x - berth.x - berth.w / 2, body.y - berth.y - berth.h / 2),
      longHalf: Math.max(berth.w, berth.h) / 2,
    };
  }
  return { STEP, MAIN, TUG, components, advance, corners, manifold, resolveContact, stoppingDistance, docking };
});
