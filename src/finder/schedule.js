// Timed drive: walk a rover route hour by hour against the Sun and Earth masks. Pure: no DOM.

export const maskBit = (mask, stride, step, cell) => (mask[step * stride + (cell >> 3)] >> (cell & 7)) & 1;

export const STATE = Object.freeze({ PARKED: 0, DRIVING: 1, WAIT_SUN: 2, WAIT_EARTH: 3, ARRIVED: 4, LOST: 5 });

function cumulativeDistances(result, path) {
  const { n, cellM, elevation } = result;
  const cum = new Float64Array(path.length);
  for (let p = 1; p < path.length; p++) {
    const i = path[p];
    const a = path[p - 1];
    const dr = Math.abs(((i / n) | 0) - ((a / n) | 0));
    const dc = Math.abs((i % n) - (a % n));
    const horizontal = dr && dc ? cellM * Math.SQRT2 : cellM;
    const dz = elevation[i] - elevation[a];
    cum[p] = cum[p - 1] + Math.sqrt(horizontal * horizontal + dz * dz);
  }
  return cum;
}

export function simulateDrive(result, path, { departHours = 0, speedMPerHour, maxDarknessHours, needSunToDrive = true, needEarthToDrive = false }) {
  const { steps, stepHours, windowHours, maskStride, sunMask, earthMask } = result;
  const cum = cumulativeDistances(result, path);
  const distanceM = path.length ? cum[path.length - 1] : 0;
  const timeline = new Uint8Array(steps);
  const positionM = new Float32Array(steps);
  const lit = new Uint8Array(steps);
  const earth = new Uint8Array(steps);
  const departStep = Math.max(0, Math.ceil(departHours / stepHours - 1e-9));
  const stepM = speedMPerHour * stepHours;

  let pos = 0;
  let idx = 0; // index into path of the last cell reached
  let arrived = path.length <= 1;
  let arrivalHours = arrived ? departHours : null;
  let drivingSteps = 0;
  let waitingSteps = 0;
  let darkRun = 0;
  let longestDarkH = 0;
  let lostAtHours = null;
  let survived = true;

  for (let s = 0; s < steps; s++) {
    let state;
    if (s < departStep) state = STATE.PARKED;
    else if (arrived && arrivalHours !== null && idx === path.length - 1 && (path.length <= 1 || pos >= distanceM) && arrivalHours <= s * stepHours + 1e-9) state = STATE.ARRIVED;
    else {
      const here = path[idx];
      const sunOk = !needSunToDrive || maskBit(sunMask, maskStride, s, here) === 1;
      const earthOk = !needEarthToDrive || maskBit(earthMask, maskStride, s, here) === 1;
      if (sunOk && earthOk) {
        state = STATE.DRIVING;
        drivingSteps++;
        pos = Math.min(distanceM, pos + stepM);
        while (idx < path.length - 1 && cum[idx + 1] <= pos + 1e-6) idx++;
        if (idx === path.length - 1) {
          arrived = true;
          arrivalHours = Math.min((s + 1) * stepHours, windowHours);
        }
      } else {
        state = sunOk ? STATE.WAIT_EARTH : STATE.WAIT_SUN;
        waitingSteps++;
      }
    }
    const cell = path[idx];
    const isLit = maskBit(sunMask, maskStride, s, cell);
    lit[s] = isLit;
    earth[s] = maskBit(earthMask, maskStride, s, cell);
    positionM[s] = pos;
    timeline[s] = state;
    if (isLit) darkRun = 0;
    else darkRun++;
    longestDarkH = Math.max(longestDarkH, darkRun * stepHours);
    if (darkRun * stepHours > maxDarknessHours + 1e-9) {
      survived = false;
      lostAtHours = s * stepHours;
      if (state === STATE.DRIVING) drivingSteps--; // the dark step killed it before it moved on
      timeline.fill(STATE.LOST, s);
      positionM.fill(pos, s);
      for (let t = s + 1; t < steps; t++) {
        lit[t] = maskBit(sunMask, maskStride, t, cell);
        earth[t] = maskBit(earthMask, maskStride, t, cell);
      }
      break;
    }
  }
  return {
    arrived,
    survived,
    departHours,
    arrivalHours,
    drivingHours: drivingSteps * stepHours,
    waitingHours: waitingSteps * stepHours,
    longestDarkH,
    lostAtHours,
    distanceM,
    timeline,
    positionM,
    lit,
    earth,
  };
}

export function bestDeparture(result, path, options) {
  let best = null;
  let workable = 0;
  for (let s = 0; s < result.steps; s++) {
    const run = simulateDrive(result, path, { ...options, departHours: s * result.stepHours });
    if (!run.arrived || !run.survived) continue;
    workable++;
    if (!best || run.arrivalHours < best.arrivalHours || (run.arrivalHours === best.arrivalHours && run.departHours > best.departHours)) best = run;
  }
  return { best, tried: result.steps, workable };
}
